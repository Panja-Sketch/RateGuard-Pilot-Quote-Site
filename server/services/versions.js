// Versioned configuration registry + lifecycle (draft -> validated -> pending_approval -> approved
// -> active, with reject / withdraw / rollback) for product versions and rating versions.
import { HttpError, hashOf, clone, isIsoDate } from '../engine/util.js';
import { mergeContent } from '../engine/merge.js';
import { validateRatingVersion, validateProductVersion } from '../engine/validateConfig.js';
import { quickRate } from '../engine/quoteCore.js';
import { diffContent, diffMeta } from '../engine/diff.js';
import { scenarioSet } from '../seed/scenarios.js';
import { DEMO_STATES } from '../engine/geo.js';

export const ABBR = { 'personal-auto': 'PA', homeowners: 'HO', 'commercial-property': 'CP', bop: 'BOP' };
const EDITABLE = ['draft', 'validated', 'rejected'];

export class VersionService {
  constructor({ store, audit, clock }) { this.store = store; this.audit = audit; this.clock = clock; }

  today() { return this.clock().toISOString().slice(0, 10); }

  // ---------- reads ----------
  async get(id) { return this.store.get('documents', id); }
  async mustGet(id) { const d = await this.get(id); if (!d) throw new HttpError(404, 'NOT_FOUND', `Version ${id} was not found.`); return d; }

  async list({ kind, productId, state, status, scope } = {}) {
    let docs = await this.store.list('documents');
    if (kind) docs = docs.filter((d) => d.kind === kind);
    if (productId) docs = docs.filter((d) => d.productId === productId);
    if (status) docs = docs.filter((d) => d.status === status);
    if (scope) docs = docs.filter((d) => d.scope?.level === scope);
    if (state) docs = docs.filter((d) => d.scope?.state === state || d.scope?.level === 'national');
    const today = this.today();
    docs.sort((a, b) => (a.productId + a.kind + (a.scope?.level ?? '') + (a.scope?.state ?? '')).localeCompare(b.productId + b.kind + (b.scope?.level ?? '') + (b.scope?.state ?? '')) || a.effectiveFrom.localeCompare(b.effectiveFrom) || a.versionNumber - b.versionNumber);
    return docs.map((d) => this.annotate(d, docs, today));
  }

  annotate(d, all, today) {
    let effectiveState = null;
    if (d.status === 'active') {
      if (d.effectiveFrom > today) effectiveState = 'scheduled';
      else if (d.effectiveTo && d.effectiveTo <= today) effectiveState = 'expired';
      else {
        const later = all.some((o) => o.id !== d.id && o.status === 'active' && o.kind === d.kind && o.productId === d.productId && o.scope?.level === d.scope?.level && o.scope?.state === d.scope?.state && o.effectiveFrom > d.effectiveFrom && o.effectiveFrom <= today);
        effectiveState = later ? 'superseded' : 'in_effect';
      }
    }
    return { ...d, effectiveState };
  }

  summary(d) {
    const { content, provenance, ...rest } = d;
    return { ...rest, contentSummary: content ? { tables: Object.keys(content.tables || {}).length, rules: (content.rules || []).length, params: Object.keys(content.params || {}).length } : undefined };
  }

  /** Pick the active version in force on `date` for a scope. */
  pickActive(docs, date) {
    const ok = docs.filter((d) => d.status === 'active' && d.effectiveFrom <= date && (!d.effectiveTo || date < d.effectiveTo));
    ok.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.versionNumber - a.versionNumber);
    return ok[0] || null;
  }

  async resolveProduct(productId, date, pinnedId) {
    if (pinnedId) { const d = await this.mustGet(pinnedId); if (d.kind !== 'product' || d.productId !== productId) throw new HttpError(400, 'BAD_PIN', `${pinnedId} is not a product version of ${productId}.`); return d; }
    const docs = await this.store.list('documents', (d) => d.kind === 'product' && d.productId === productId);
    return this.pickActive(docs, date);
  }

  /** Returns {national, state} rating documents for a product/state/date, honouring explicit pins. */
  async resolveRating(productId, state, date, pin = {}) {
    const docs = await this.store.list('documents', (d) => d.kind === 'rating' && d.productId === productId);
    let national; let stateDoc = null;
    if (pin.national) { national = await this.mustGet(pin.national); if (national.scope?.level !== 'national' || national.productId !== productId) throw new HttpError(400, 'BAD_PIN', `${pin.national} is not a national version of ${productId}.`); }
    else national = this.pickActive(docs.filter((d) => d.scope.level === 'national'), date);
    if (pin.state === null) stateDoc = null;
    else if (pin.state) { stateDoc = await this.mustGet(pin.state); if (stateDoc.scope?.level !== 'state' || stateDoc.scope.state !== state || stateDoc.productId !== productId) throw new HttpError(400, 'BAD_PIN', `${pin.state} is not a ${state} override of ${productId}.`); }
    else stateDoc = this.pickActive(docs.filter((d) => d.scope.level === 'state' && d.scope.state === state), date);
    return { national, state: stateDoc };
  }

  merged(national, stateDoc) {
    const { content, origins } = mergeContent(national.content, national.id, stateDoc?.content, stateDoc?.id);
    return { content, origins, hash: hashOf(content) };
  }

  // ---------- writes ----------
  async nextVersionNumber(kind, productId, scope) {
    const docs = await this.store.list('documents', (d) => d.kind === kind && d.productId === productId && d.scope?.level === (scope?.level ?? undefined) && d.scope?.state === scope?.state);
    return docs.reduce((m, d) => Math.max(m, d.versionNumber), 0) + 1;
  }

  makeId(kind, productId, scope, n) {
    const a = ABBR[productId] || productId.toUpperCase();
    if (kind === 'product') return `${a}-PROD-v${n}`;
    return `${a}-${scope.level === 'national' ? 'NAT' : scope.state}-v${n}`;
  }

  stamp(doc, actor, status, note) {
    const at = this.clock().toISOString();
    doc.status = status;
    doc.updatedAt = at; doc.updatedBy = actor.id;
    doc.transitions = [...(doc.transitions || []), { status, by: actor.id, role: actor.role, at, note: note || null }];
  }

  /** Create a draft. spec: {kind, productId, scope, fromVersionId?, label, effectiveFrom, effectiveTo, content?, changeTicket, demo, source, provenance} */
  async createDraft(actor, spec) {
    const kind = spec.kind || 'rating';
    let base = null;
    if (spec.fromVersionId) {
      base = await this.mustGet(spec.fromVersionId);
      if (base.kind !== kind) throw new HttpError(400, 'BAD_REQUEST', 'fromVersionId has a different kind.');
    }
    const productId = spec.productId || base?.productId;
    const product = await this.store.get('products', productId);
    if (!product) throw new HttpError(404, 'UNKNOWN_PRODUCT', `Unknown product "${productId}".`);
    const scope = kind === 'product' ? { level: 'product' } : (spec.scope || base?.scope);
    if (kind === 'rating') {
      if (!scope || !['national', 'state'].includes(scope.level)) throw new HttpError(400, 'BAD_SCOPE', 'scope.level must be national or state.');
      if (scope.level === 'state' && !DEMO_STATES.includes(scope.state)) throw new HttpError(400, 'BAD_STATE', `State ${scope.state} is not in the demo set.`);
      if (base && base.scope.level !== scope.level) throw new HttpError(400, 'BAD_SCOPE', 'A draft must have the same scope level as the version it is cloned from.');
    }
    const effectiveFrom = spec.effectiveFrom || this.today();
    if (!isIsoDate(effectiveFrom)) throw new HttpError(400, 'BAD_EFFECTIVE_DATE', 'effectiveFrom must be YYYY-MM-DD.');
    const n = await this.nextVersionNumber(kind, productId, kind === 'product' ? { level: 'product' } : scope);
    const at = this.clock().toISOString();
    const doc = {
      id: this.makeId(kind, productId, scope, n), kind, productId, lob: product.lob, scope, versionNumber: n,
      label: spec.label || (base ? `Draft based on ${base.id}` : 'New draft'),
      effectiveFrom, effectiveTo: spec.effectiveTo || null,
      content: clone(spec.content ?? base?.content ?? (scope?.level === 'state' ? {} : { params: {}, tables: {}, derive: [], rules: [], plan: [], limits: {} })),
      basedOn: base?.id ?? null,
      changeTicket: spec.changeTicket || null,
      source: spec.source || null, provenance: spec.provenance || null, demo: spec.demo || null,
      createdAt: at, createdBy: actor.id, validation: null, transitions: [],
    };
    this.stamp(doc, actor, 'draft', 'created');
    await this.store.put('documents', doc);
    await this.audit.record(actor, 'CONFIG_CREATED', { type: kind, id: doc.id }, `Created draft ${doc.id}${base ? ` from ${base.id}` : ''}`, { basedOn: base?.id ?? null, effectiveFrom, scope });
    return doc;
  }

  async updateDraft(actor, id, patch) {
    const doc = await this.mustGet(id);
    if (!EDITABLE.includes(doc.status)) throw new HttpError(409, 'NOT_EDITABLE', `${id} is ${doc.status}; only draft, validated or rejected versions can be edited. Clone it to make a new draft.`);
    const before = clone(doc);
    for (const k of ['label', 'effectiveFrom', 'effectiveTo', 'changeTicket']) if (k in patch) doc[k] = patch[k];
    if ('effectiveFrom' in patch && !isIsoDate(doc.effectiveFrom)) throw new HttpError(400, 'BAD_EFFECTIVE_DATE', 'effectiveFrom must be YYYY-MM-DD.');
    if ('content' in patch) {
      if (!patch.content || typeof patch.content !== 'object' || Array.isArray(patch.content)) throw new HttpError(400, 'BAD_CONTENT', 'content must be an object.');
      doc.content = clone(patch.content);
    }
    doc.validation = null;
    this.stamp(doc, actor, 'draft', 'edited');
    await this.store.put('documents', doc);
    const d = diffContent(before.content, doc.content);
    await this.audit.record(actor, 'CONFIG_UPDATED', { type: doc.kind, id }, `Edited ${id}: ${d.summary.total} content change(s)`, { contentChanges: d.summary, meta: diffMeta(before, doc) });
    return doc;
  }

  async buildValidationCtx(doc) {
    const date = doc.effectiveFrom;
    const productDoc = (await this.resolveProduct(doc.productId, date)) || (await this.store.list('documents', (d) => d.kind === 'product' && d.productId === doc.productId && d.status === 'active'))[0];
    if (!productDoc) return { product: null };
    const ctx = { product: productDoc.content };
    const all = await this.store.list('documents', (d) => d.kind === 'rating' && d.productId === doc.productId && d.id !== doc.id);
    if (doc.scope.level === 'state') ctx.national = this.pickActive(all.filter((d) => d.scope.level === 'national'), date) || undefined;
    // baseline: what this version would replace (parent if still available, else the one in force the day before)
    const dayBefore = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const sameScope = all.filter((d) => d.scope.level === doc.scope.level && d.scope.state === doc.scope.state);
    const baseline = (doc.basedOn && sameScope.find((d) => d.id === doc.basedOn)) || this.pickActive(sameScope, dayBefore);
    const nationalDoc = doc.scope.level === 'national' ? null : ctx.national;
    const states = doc.scope.level === 'state' ? [doc.scope.state] : DEMO_STATES;
    const scenarios = [];
    for (const s of states) scenarios.push(...scenarioSet(doc.productId, { states: [s], variationStates: [] }));
    scenarios.push(...scenarioSet(doc.productId, { states: [], variationStates: [doc.scope.level === 'state' ? doc.scope.state : 'AZ'] }));
    const prod = productDoc.content;
    const baseMerged = baseline ? (nationalDoc ? mergeContent(nationalDoc.content, nationalDoc.id, baseline.content, baseline.id) : { content: baseline.content, origins: { params: {}, tables: {}, rules: {}, steps: {} } }) : null;
    ctx.baseline = baseline || undefined;
    ctx.smoke = {
      scenarios,
      rate: (content, origins, sc) => quickRate(prod, content, origins, sc),
      rateBaseline: baseMerged ? (sc) => quickRate(prod, baseMerged.content, baseMerged.origins, sc) : undefined,
    };
    return ctx;
  }

  /** Validate a document (stored or candidate) without storing a result. */
  async validateDocument(doc) {
    if (doc.kind === 'product') return validateProductVersion(doc);
    const ctx = await this.buildValidationCtx(doc);
    return validateRatingVersion(doc, ctx);
  }

  async validate(actor, id) {
    const doc = await this.mustGet(id);
    const report = await this.validateDocument(doc);
    doc.validation = { at: this.clock().toISOString(), by: actor.id, valid: report.valid, contentHash: hashOf(doc.content), errors: report.errors.length, warnings: report.warnings.length };
    if (EDITABLE.includes(doc.status)) {
      doc.status = report.valid ? 'validated' : 'draft';
      doc.transitions.push({ status: doc.status, by: actor.id, role: actor.role, at: doc.validation.at, note: `validation ${report.valid ? 'passed' : 'failed'}` });
    }
    await this.store.put('documents', doc);
    await this.audit.record(actor, 'CONFIG_VALIDATED', { type: doc.kind, id }, `Validated ${id}: ${report.valid ? 'PASSED' : 'FAILED'} (${report.errors.length} errors, ${report.warnings.length} warnings)`, { errors: report.errors.slice(0, 20), warnings: report.warnings.length });
    return { document: doc, report };
  }

  async submit(actor, id, note) {
    const doc = await this.mustGet(id);
    if (!['validated'].includes(doc.status)) throw new HttpError(409, 'INVALID_TRANSITION', `${id} is ${doc.status}; validate it successfully before submitting for approval.`);
    if (doc.validation?.contentHash !== hashOf(doc.content)) throw new HttpError(409, 'STALE_VALIDATION', 'The content changed since validation. Validate again.');
    doc.submittedBy = actor.id; doc.submittedAt = this.clock().toISOString();
    this.stamp(doc, actor, 'pending_approval', note);
    await this.store.put('documents', doc);
    await this.audit.record(actor, 'CONFIG_SUBMITTED', { type: doc.kind, id }, `Submitted ${id} for approval`, { note });
    return doc;
  }

  async withdraw(actor, id, note) {
    const doc = await this.mustGet(id);
    if (doc.status !== 'pending_approval') throw new HttpError(409, 'INVALID_TRANSITION', `${id} is ${doc.status}, not pending approval.`);
    if (doc.submittedBy !== actor.id && actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only the submitter or an admin can withdraw.');
    this.stamp(doc, actor, 'draft', note || 'withdrawn');
    doc.validation = null;
    await this.store.put('documents', doc);
    await this.audit.record(actor, 'CONFIG_WITHDRAWN', { type: doc.kind, id }, `Withdrew ${id} from approval`, { note });
    return doc;
  }

  async approve(actor, id, note) {
    const doc = await this.mustGet(id);
    if (doc.status !== 'pending_approval') throw new HttpError(409, 'INVALID_TRANSITION', `${id} is ${doc.status}, not pending approval.`);
    if (doc.submittedBy === actor.id || doc.createdBy === actor.id) throw new HttpError(403, 'FOUR_EYES', 'Four-eyes rule: the person who created or submitted a version cannot approve it.');
    if (doc.validation?.contentHash !== hashOf(doc.content)) throw new HttpError(409, 'STALE_VALIDATION', 'The content changed after validation. Return it to draft and validate again.');
    doc.approvedBy = actor.id; doc.approvedAt = this.clock().toISOString();
    doc.contentHash = hashOf(doc.content);
    this.stamp(doc, actor, 'approved', note);
    await this.store.put('documents', doc);
    await this.audit.record(actor, 'CONFIG_APPROVED', { type: doc.kind, id }, `Approved ${id}`, { note, contentHash: doc.contentHash });
    return doc;
  }

  async reject(actor, id, reason) {
    const doc = await this.mustGet(id);
    if (doc.status !== 'pending_approval') throw new HttpError(409, 'INVALID_TRANSITION', `${id} is ${doc.status}, not pending approval.`);
    if (!reason) throw new HttpError(400, 'REASON_REQUIRED', 'A rejection reason is required.');
    if (doc.submittedBy === actor.id) throw new HttpError(403, 'FOUR_EYES', 'The submitter cannot reject their own submission; withdraw it instead.');
    doc.rejectedBy = actor.id; doc.rejectionReason = reason;
    this.stamp(doc, actor, 'rejected', reason);
    await this.store.put('documents', doc);
    await this.audit.record(actor, 'CONFIG_REJECTED', { type: doc.kind, id }, `Rejected ${id}: ${reason}`, { reason });
    return doc;
  }

  async promote(actor, id, note) {
    const doc = await this.mustGet(id);
    if (doc.status !== 'approved') throw new HttpError(409, 'INVALID_TRANSITION', `${id} is ${doc.status}; only approved versions can be promoted.`);
    if (doc.contentHash !== hashOf(doc.content)) throw new HttpError(409, 'HASH_MISMATCH', 'Approved content hash does not match current content.');
    const report = await this.validateDocument(doc);
    if (!report.valid) throw new HttpError(422, 'VALIDATION_FAILED', `${id} no longer validates (${report.errors.length} errors). It cannot be promoted.`, report.errors.slice(0, 10));
    const clash = await this.store.list('documents', (d) => d.id !== id && d.kind === doc.kind && d.productId === doc.productId && d.status === 'active' && d.scope?.level === doc.scope?.level && d.scope?.state === doc.scope?.state && d.effectiveFrom === doc.effectiveFrom);
    if (clash.length) throw new HttpError(409, 'EFFECTIVE_DATE_CONFLICT', `${clash[0].id} is already active for this scope with effective date ${doc.effectiveFrom}. Roll it back or choose a different effective date.`);
    doc.promotedBy = actor.id; doc.promotedAt = this.clock().toISOString(); doc.frozen = true;
    this.stamp(doc, actor, 'active', note);
    await this.store.put('documents', doc);
    await this.audit.record(actor, 'CONFIG_PROMOTED', { type: doc.kind, id }, `Promoted ${id} to active, effective ${doc.effectiveFrom}`, { note, contentHash: doc.contentHash, effectiveFrom: doc.effectiveFrom });
    return doc;
  }

  async rollback(actor, id, reason) {
    const doc = await this.mustGet(id);
    if (doc.status !== 'active') throw new HttpError(409, 'INVALID_TRANSITION', `${id} is ${doc.status}; only active versions can be rolled back.`);
    if (!reason) throw new HttpError(400, 'REASON_REQUIRED', 'A rollback reason is required.');
    doc.rolledBackBy = actor.id; doc.rolledBackAt = this.clock().toISOString(); doc.rollbackReason = reason;
    this.stamp(doc, actor, 'rolled_back', reason);
    await this.store.put('documents', doc);
    const fallback = doc.kind === 'rating' ? (await this.resolveRating(doc.productId, doc.scope.state || 'AZ', doc.effectiveFrom <= this.today() ? this.today() : doc.effectiveFrom))[doc.scope.level === 'national' ? 'national' : 'state'] : null;
    await this.audit.record(actor, 'CONFIG_ROLLED_BACK', { type: doc.kind, id }, `Rolled back ${id}: ${reason}`, { reason, nowInForce: fallback?.id ?? null });
    return { document: doc, nowInForce: fallback?.id ?? null };
  }

  async diff(aId, bId) {
    const a = await this.mustGet(aId); const b = await this.mustGet(bId);
    const d = diffContent(a.content, b.content);
    return { from: this.summary(a), to: this.summary(b), meta: diffMeta(a, b), ...d };
  }

  // ---------- seeding ----------
  /** Insert a pre-built document verbatim (used by the seeder). */
  async insertSeed(doc) { await this.store.put('documents', doc); }
}
