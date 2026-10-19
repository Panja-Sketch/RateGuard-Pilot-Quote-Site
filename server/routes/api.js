import express from 'express';
import { requires, can, DEMO_USERS } from '../auth.js';
import { HttpError, isPlainObject, clone, hashOf } from '../engine/util.js';
import { toJsonSchema } from '../engine/inputs.js';
import { DEMO_STATES, STATE_INFO } from '../engine/geo.js';
import { applyRateChange, applySilentDefect, applyStructuralDefect, RATE_CHANGE_NOTE } from '../seed/defects.js';
import { DISCLAIMER } from '../services/quote.js';
import { resetData } from '../context.js';
import { FEEDBACK_TYPES } from '../services/feedback.js';
import { ENGINE_INFO } from '../engine/rate.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const today = (ctx) => ctx.clock().toISOString().slice(0, 10);

export function buildApi(ctx, auth, config) {
  const api = express.Router();
  const need = requires;

  // ---------- public ----------
  api.get('/meta', (_req, res) => res.json({
    name: 'RateGuard Pilot Quote Site (synthetic)', apiVersion: 'v1', authMode: auth.mode, engine: ENGINE_INFO, disclaimer: DISCLAIMER,
    states: DEMO_STATES.map((s) => ({ code: s, name: STATE_INFO[s].name, sampleZip: STATE_INFO[s].sampleZip })),
    separation: 'Standalone synthetic pilot. Not integrated with RateGuard Enhanced; RateGuard v3 does not exist yet.',
    demoPasswordHint: auth.usingDefaultPassword && auth.mode === 'demo' ? 'Default demo password is documented in the README.' : undefined,
  }));
  api.get('/auth/demo-users', (_req, res) => res.json({ users: auth.mode === 'demo' ? auth.publicUsers() : [] }));
  api.post('/auth/login', wrap(async (req, res) => {
    if (auth.mode !== 'demo') throw new HttpError(400, 'NOT_AVAILABLE', 'Password sign-in is disabled; use Firebase Authentication.');
    const { username, password } = req.body || {};
    const out = auth.login(username, password, req.ip);
    await ctx.audit.record({ id: out.user.id, role: out.user.role }, 'LOGIN', { type: 'user', id: out.user.id }, `${out.user.id} signed in`, {});
    res.json(out);
  }));

  // everything below requires a signed-in user
  api.use(auth.middleware());
  api.get('/auth/me', (req, res) => res.json({ user: req.user, permissions: Object.keys(PERMS_FOR(req.user)) }));

  // ---------- discovery ----------
  api.get('/products', wrap(async (_req, res) => {
    const products = await ctx.store.list('products');
    const out = [];
    for (const p of products) {
      const pv = await ctx.versions.resolveProduct(p.id, today(ctx));
      out.push({ ...p, productVersion: pv ? { id: pv.id, versionNumber: pv.versionNumber, effectiveFrom: pv.effectiveFrom } : null });
    }
    res.json({ products: out });
  }));
  api.get('/products/:id', wrap(async (req, res) => {
    const p = await ctx.store.get('products', req.params.id);
    if (!p) throw new HttpError(404, 'UNKNOWN_PRODUCT', 'Unknown product.');
    const versions = (await ctx.versions.list({ productId: p.id })).map((v) => ctx.versions.summary(v));
    res.json({ product: p, versions });
  }));
  api.get('/products/:id/schema', wrap(async (req, res) => {
    const p = await ctx.store.get('products', req.params.id);
    if (!p) throw new HttpError(404, 'UNKNOWN_PRODUCT', 'Unknown product.');
    const date = req.query.date || today(ctx);
    const doc = await ctx.versions.resolveProduct(p.id, date, req.query.versionId);
    if (!doc) throw new HttpError(404, 'NO_PRODUCT_VERSION', `No active product version for ${p.id} on ${date}.`);
    res.json({ productId: p.id, lineOfBusiness: p.lob, productVersion: { id: doc.id, versionNumber: doc.versionNumber, status: doc.status, effectiveFrom: doc.effectiveFrom, contentHash: doc.contentHash || hashOf(doc.content) }, states: doc.content.states, termMonths: doc.content.termMonths, transactionTypes: ['NEW_BUSINESS', 'RENEWAL', 'ENDORSEMENT'], sections: doc.content.sections, crossChecks: doc.content.crossChecks, jsonSchema: toJsonSchema(doc.content), requestEnvelope: {
      scenarioId: 'string (optional, echoed back)', productId: p.id, state: 'one of states', transactionType: 'NEW_BUSINESS | RENEWAL | ENDORSEMENT', effectiveDate: 'YYYY-MM-DD', policyEffectiveDate: 'YYYY-MM-DD (ENDORSEMENT)', risk: 'object (jsonSchema.properties.risk)', coverages: 'object (jsonSchema.properties.coverages)',
      endorsement: '{priorRisk, priorCoverages?} (ENDORSEMENT only)', priorTermPremium: 'number (RENEWAL, optional)', ratingVersionIds: '{national?, state?} (pricing/API roles only)', options: '{trace?: boolean}',
    } });
  }));
  api.get('/jurisdictions', (_req, res) => res.json({ note: 'Configurable synthetic demo set; not a claim about real insurer footprints.', states: DEMO_STATES.map((s) => ({ code: s, name: STATE_INFO[s].name, zip3Ranges: STATE_INFO[s].zip3 })) }));

  const versionRoutes = (prefix, kind) => {
    api.get(`/${prefix}`, need('config:read'), wrap(async (req, res) => {
      const { productId, state, status, scope } = req.query;
      const list = await ctx.versions.list({ kind, productId, state, status, scope });
      res.json({ versions: list.map((v) => ctx.versions.summary(v)) });
    }));
    if (kind === 'rating') {
      api.get('/rating-versions/resolve', need('config:read'), wrap(async (req, res) => {
        const { productId, state } = req.query; const date = req.query.date || today(ctx);
        if (!productId || !state) throw new HttpError(400, 'BAD_REQUEST', 'productId and state are required.');
        const pv = await ctx.versions.resolveProduct(productId, date);
        const { national, state: st } = await ctx.versions.resolveRating(productId, state, date);
        const merged = national ? ctx.versions.merged(national, st) : null;
        const s = (d) => d && ctx.versions.summary(d);
        res.json({ productId, state, date, productVersion: s(pv), national: s(national), stateOverride: s(st), effectiveConfigHash: merged?.hash ?? null, explanation: st ? `${national?.id} (national) with ${st.id} (${state} override), both effective on or before ${date}.` : `${national?.id ?? 'none'} (national only; no ${state} override in force on ${date}).` });
      }));
      api.post('/rating-versions/validate', need('config:validate'), wrap(async (req, res) => {
        const doc = req.body;
        if (!isPlainObject(doc) || !isPlainObject(doc.content) || typeof doc.productId !== 'string') throw new HttpError(400, 'BAD_REQUEST', 'Body must be a rating-version document with productId, scope, effectiveFrom and content.');
        const candidate = { id: 'candidate', kind: 'rating', status: 'draft', versionNumber: 0, ...clone(doc), scope: doc.scope || { level: 'national' }, effectiveFrom: doc.effectiveFrom || today(ctx) };
        const report = await ctx.versions.validateDocument(candidate);
        res.json({ candidateHash: hashOf(candidate.content), ...report, note: 'The candidate was validated but not stored.' });
      }));
    }
    api.get(`/${prefix}/:id`, need('config:read'), wrap(async (req, res) => {
      const d = await ctx.versions.mustGet(req.params.id);
      if (d.kind !== kind) throw new HttpError(404, 'NOT_FOUND', `${req.params.id} is not a ${kind} version.`);
      const all = await ctx.versions.list({ kind, productId: d.productId });
      res.json({ version: all.find((x) => x.id === d.id) || d });
    }));
    api.post(`/${prefix}`, need('config:edit'), wrap(async (req, res) => {
      const draft = await ctx.versions.createDraft(req.user, { ...(req.body || {}), kind });
      res.status(201).json({ version: draft });
    }));
    api.put(`/${prefix}/:id`, need('config:edit'), wrap(async (req, res) => {
      await assertKind(req.params.id, kind);
      res.json({ version: await ctx.versions.updateDraft(req.user, req.params.id, req.body || {}) });
    }));
    api.post(`/${prefix}/:id/validate`, need('config:validate'), wrap(async (req, res) => {
      await assertKind(req.params.id, kind);
      if (can(req.user, 'config:edit') && req.query.persist !== 'false') return res.json(await ctx.versions.validate(req.user, req.params.id));
      const doc = await ctx.versions.mustGet(req.params.id);
      res.json({ document: ctx.versions.summary(doc), report: await ctx.versions.validateDocument(doc), persisted: false });
    }));
    api.post(`/${prefix}/:id/submit`, need('config:edit'), wrap(async (req, res) => { await assertKind(req.params.id, kind); res.json({ version: await ctx.versions.submit(req.user, req.params.id, req.body?.note) }); }));
    api.post(`/${prefix}/:id/withdraw`, need('config:edit'), wrap(async (req, res) => { await assertKind(req.params.id, kind); res.json({ version: await ctx.versions.withdraw(req.user, req.params.id, req.body?.note) }); }));
    api.post(`/${prefix}/:id/approve`, need('config:approve'), wrap(async (req, res) => { await assertKind(req.params.id, kind); res.json({ version: await ctx.versions.approve(req.user, req.params.id, req.body?.note) }); }));
    api.post(`/${prefix}/:id/reject`, need('config:approve'), wrap(async (req, res) => { await assertKind(req.params.id, kind); res.json({ version: await ctx.versions.reject(req.user, req.params.id, req.body?.reason) }); }));
    api.post(`/${prefix}/:id/promote`, need('config:promote'), wrap(async (req, res) => { await assertKind(req.params.id, kind); res.json({ version: await ctx.versions.promote(req.user, req.params.id, req.body?.note) }); }));
    api.post(`/${prefix}/:id/rollback`, need('config:rollback'), wrap(async (req, res) => { await assertKind(req.params.id, kind); res.json(await ctx.versions.rollback(req.user, req.params.id, req.body?.reason)); }));
    api.get(`/${prefix}/:a/diff/:b`, need('config:read'), wrap(async (req, res) => res.json(await ctx.versions.diff(req.params.a, req.params.b))));
  };
  async function assertKind(id, kind) { const d = await ctx.versions.mustGet(id); if (d.kind !== kind) throw new HttpError(404, 'NOT_FOUND', `${id} is not a ${kind} version.`); }
  versionRoutes('rating-versions', 'rating');
  versionRoutes('product-versions', 'product');

  api.get('/rating-versions/:id/export.xlsx', need('config:read'), wrap(async (req, res) => {
    const { doc, buffer } = await ctx.workbooks.exportVersion(req.params.id);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${doc.id}.xlsx"` }).send(buffer);
  }));

  // demo drafts: a normal rate change or an intentional defect, created through the normal draft path
  api.post('/demo/drafts', need('config:edit'), wrap(async (req, res) => {
    const { productId, kind, pct = 4, fromVersionId, effectiveFrom } = req.body || {};
    if (!['rate_change', 'defect_silent', 'defect_structural'].includes(kind)) throw new HttpError(400, 'BAD_REQUEST', 'kind must be rate_change, defect_silent or defect_structural.');
    const from = await ctx.versions.mustGet(fromVersionId || (await ctx.versions.resolveRating(productId, 'AZ', today(ctx))).national?.id);
    if (from.kind !== 'rating' || from.scope.level !== 'national') throw new HttpError(400, 'BAD_REQUEST', 'Demo drafts are generated from a national rating version.');
    let content; let demo; let label;
    if (kind === 'rate_change') {
      if (!(typeof pct === 'number' && pct > -50 && pct < 100)) throw new HttpError(400, 'BAD_REQUEST', 'pct must be a number between -50 and 100.');
      content = applyRateChange(from.productId, from.content, pct); label = `DEMO – normal rate change: base rates ${pct >= 0 ? '+' : ''}${pct}%`; demo = { kind, description: `A normal, intended rate change (${RATE_CHANGE_NOTE[from.productId]?.replace('+4.0%', `${pct}%`) ?? ''}).`, pct };
    } else if (kind === 'defect_silent') {
      const d = applySilentDefect(from.productId, from.content); content = d.content; label = 'DEMO – intentional silent defect (passes structural validation)'; demo = { kind, description: `Hidden defect: ${d.note.change}. Structurally valid.`, defect: d.note };
    } else {
      const d = applyStructuralDefect(from.productId, from.content); content = d.content; label = 'DEMO – intentional structural defects (fails validation)'; demo = { kind, description: `Defects: ${d.notes.join('; ')}.`, defect: { notes: d.notes } };
    }
    const draft = await ctx.versions.createDraft(req.user, { productId: from.productId, scope: { level: 'national' }, fromVersionId: from.id, content, label, effectiveFrom: effectiveFrom || '2026-12-01', demo, changeTicket: { reference: `SYN-DEMO-${kind.toUpperCase()}`, text: 'Synthetic demonstration ticket (the pilot stores this text; it does not analyse it).' } });
    res.status(201).json({ version: draft });
  }));

  // ---------- quotes ----------
  const pinsAllowed = (user) => can(user, 'quote:pin');
  api.post('/quotes', need('quote:create'), wrap(async (req, res) => {
    const persist = req.query.persist === 'true';
    const result = await ctx.quotes.quote(req.user, req.body, { persist, allowPins: pinsAllowed(req.user) });
    res.json(result);
  }));
  api.post('/quotes/batch', need('quote:create'), wrap(async (req, res) => res.json(await ctx.quotes.batch(req.user, req.body, { allowPins: pinsAllowed(req.user) }))));
  api.post('/validate-submission', need('quote:create'), wrap(async (req, res) => {
    const r = await ctx.quotes.quote(req.user, { ...req.body, options: { trace: false } }, { allowPins: pinsAllowed(req.user) });
    res.json({ scenarioId: r.scenarioId, valid: r.validation?.valid ?? false, status: r.status, errors: r.validation?.errors ?? [], warnings: r.validation?.warnings ?? [], eligibility: r.eligibility ?? null, versions: r.versions });
  }));
  api.get('/quotes/:id', need('quote:create'), wrap(async (req, res) => {
    const q = await ctx.store.get('quotes', req.params.id);
    if (!q) throw new HttpError(404, 'NOT_FOUND', 'Quote not found.');
    res.json(q);
  }));

  // ---------- submissions ----------
  const sub = need('submission:write');
  api.get('/submissions', sub, wrap(async (req, res) => res.json({ submissions: await ctx.submissions.list(req.query) })));
  api.post('/submissions', sub, wrap(async (req, res) => res.status(201).json({ submission: await ctx.submissions.create(req.user, req.body) })));
  api.get('/submissions/:id', sub, wrap(async (req, res) => res.json({ submission: await ctx.submissions.get(req.params.id) })));
  api.put('/submissions/:id', sub, wrap(async (req, res) => res.json({ submission: await ctx.submissions.update(req.user, req.params.id, req.body) })));
  api.delete('/submissions/:id', sub, wrap(async (req, res) => { await ctx.submissions.remove(req.user, req.params.id); res.status(204).end(); }));
  api.post('/submissions/:id/rate', sub, wrap(async (req, res) => res.json(await ctx.submissions.rate(req.user, req.params.id, { allowPins: pinsAllowed(req.user), pin: pinsAllowed(req.user) ? req.body?.ratingVersionIds : undefined }))));
  api.get('/submissions/:id/quotes', sub, wrap(async (req, res) => res.json({ quotes: await ctx.submissions.quotes(req.params.id) })));
  api.post('/submissions/:id/bind-simulated', sub, wrap(async (req, res) => res.json({ submission: await ctx.submissions.bindSimulated(req.user, req.params.id) })));
  api.post('/submissions/:id/scenarios', sub, wrap(async (req, res) => res.status(201).json({ submission: await ctx.submissions.createScenario(req.user, req.params.id, req.body || {}) })));

  // ---------- workbooks ----------
  api.get('/workbooks', need('workbook:read'), wrap(async (_req, res) => res.json({ workbooks: await ctx.workbooks.list() })));
  api.get('/workbooks/samples', need('workbook:read'), (_req, res) => res.json({ samples: ctx.workbooks.listSamples() }));
  api.get('/workbooks/samples/:file', need('workbook:read'), (req, res) => {
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${req.params.file}"` }).send(ctx.workbooks.readSample(req.params.file));
  });
  api.post('/workbooks', need('workbook:write'), express.raw({ type: () => true, limit: '6mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'BAD_REQUEST', 'Send the .xlsx bytes as the request body (Content-Type: application/octet-stream) with an X-Filename header.');
    res.status(201).json(await ctx.workbooks.upload(req.user, { fileName: req.get('x-filename') || 'workbook.xlsx', buffer: req.body }));
  }));
  api.post('/workbooks/compare', need('workbook:read'), wrap(async (req, res) => res.json(await ctx.workbooks.compare(req.body?.a, req.body?.b))));
  api.post('/workbooks/:id/inspect', need('workbook:read'), wrap(async (req, res) => res.json(await ctx.workbooks.inspect(req.params.id, req.body?.baseVersionId))));
  api.post('/workbooks/:id/preview', need('workbook:read'), wrap(async (req, res) => res.json(await ctx.workbooks.preview(req.params.id, req.body?.mapping, req.body?.baseVersionId))));
  api.post('/workbooks/:id/import', need('workbook:write'), wrap(async (req, res) => res.status(201).json(await ctx.workbooks.importDraft(req.user, req.params.id, req.body || {}))));

  // ---------- pilot test tooling ----------
  api.get('/test-tools/scenario-sets/:productId', need('testtools:run'), wrap(async (req, res) => {
    if (!(await ctx.store.get('products', req.params.productId))) throw new HttpError(404, 'UNKNOWN_PRODUCT', 'Unknown product.');
    const set = ctx.testTools.scenarioSet(req.params.productId);
    res.json({ label: 'Pilot test tooling – synthetic scenario set', productId: req.params.productId, count: set.length, scenarios: set });
  }));
  api.post('/test-tools/compare', need('testtools:run'), wrap(async (req, res) => res.json(await ctx.testTools.compare(req.user, req.body))));
  api.get('/test-tools/runs', need('testtools:run'), wrap(async (_req, res) => res.json({ runs: await ctx.testTools.listRuns() })));
  api.get('/test-tools/runs/:id', need('testtools:run'), wrap(async (req, res) => res.json(await ctx.testTools.getRun(req.params.id))));

  // ---------- feedback ----------
  api.get('/feedback/types', (_req, res) => res.json({ types: FEEDBACK_TYPES }));
  api.get('/feedback/hints', wrap(async (req, res) => res.json({ hints: await ctx.feedback.activeHints(req.query.productId) })));
  api.get('/feedback', wrap(async (req, res) => res.json({ feedback: await ctx.feedback.list(req.query) })));
  api.post('/feedback', need('feedback:create'), wrap(async (req, res) => res.status(201).json({ feedback: await ctx.feedback.create(req.user, req.body) })));
  api.post('/feedback/:id/review', need('feedback:review'), wrap(async (req, res) => res.json(await ctx.feedback.review(req.user, req.params.id, req.body || {}))));

  // ---------- audit ----------
  api.get('/audit/verify', need('audit:read'), wrap(async (_req, res) => res.json(await ctx.audit.verify())));
  api.get('/audit', need('audit:read'), wrap(async (req, res) => res.json({ entries: await ctx.audit.list({ entityType: req.query.entityType, entityId: req.query.entityId, action: req.query.action, limit: Math.min(Number(req.query.limit) || 200, 1000) }) })));

  // ---------- admin ----------
  api.post('/admin/reset', need('admin:reset'), wrap(async (req, res) => {
    if (req.body?.confirm !== 'RESET') throw new HttpError(400, 'CONFIRM_REQUIRED', 'Send {"confirm":"RESET"} to wipe local synthetic data and re-seed.');
    await resetData(ctx);
    res.json({ ok: true, message: 'Synthetic data re-seeded.' });
  }));
  void DEMO_USERS;

  return api;
}

function PERMS_FOR(user) {
  const out = {};
  for (const p of ['quote:create', 'quote:pin', 'submission:write', 'config:edit', 'config:validate', 'config:approve', 'config:promote', 'config:rollback', 'workbook:write', 'workbook:read', 'audit:read', 'feedback:create', 'feedback:review', 'testtools:run', 'admin:reset']) if (can(user, p)) out[p] = true;
  return out;
}
