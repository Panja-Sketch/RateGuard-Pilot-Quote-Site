// HTTP-level tests against the real Express app (seeded in-memory store, ephemeral port).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, ROOT } from './helpers.js';
import { baselineScenario, patchScenario, scenarioSet } from '../server/seed/scenarios.js';
import { buildSamples } from '../server/xlsx/samples.js';

let S;
test.before(async () => { S = await startServer(); });
test.after(async () => { await S.close(); });
const r = (...a) => S.request(...a);

test('authentication: 401 without/with bad token; login errors; throttling', async () => {
  assert.equal((await r('GET', '/api/v1/products')).status, 401);
  assert.equal((await S.request('GET', '/api/v1/products', { headers: { authorization: 'Bearer abc.def' } })).status, 401);
  const bad = await r('POST', '/api/v1/auth/login', { body: { username: 'agent.demo', password: 'wrong' } });
  assert.equal(bad.status, 401); assert.equal(bad.data.error.code, 'BAD_CREDENTIALS');
  const ok = await r('POST', '/api/v1/auth/login', { body: { username: 'agent.demo', password: 'test-password-123' } });
  assert.equal(ok.status, 200); assert.ok(ok.data.token);
  // tampered token
  const [body, sig] = ok.data.token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin.demo', role: 'admin', exp: 9999999999 })).toString('base64url');
  assert.equal((await S.request('GET', '/api/v1/auth/me', { headers: { authorization: `Bearer ${forged}.${sig}` } })).status, 401);
  assert.equal((await S.request('GET', '/api/v1/auth/me', { headers: { authorization: `Bearer ${body}.${sig}` } })).data.user.role, 'agent');
  for (let i = 0; i < 10; i++) await r('POST', '/api/v1/auth/login', { body: { username: 'nobody', password: 'x' } });
  assert.equal((await r('POST', '/api/v1/auth/login', { body: { username: 'nobody', password: 'x' } })).status, 429);
  assert.equal((await r('GET', '/api/v1/auth/demo-users')).status, 200, 'the demo user list is public and never contains passwords');
});

test('public endpoints: health, meta, openapi', async () => {
  assert.equal((await r('GET', '/healthz')).data.ok, true);
  const m = await r('GET', '/api/v1/meta');
  assert.equal(m.status, 200); assert.match(m.data.separation, /Not integrated with RateGuard Enhanced/); assert.equal(m.data.states.length, 10);
  const o = await r('GET', '/api/v1/openapi.json');
  assert.equal(o.data.openapi, '3.0.3');
});

test('role-based access: who may do what', async () => {
  const draft = { productId: 'homeowners', scope: { level: 'national' }, fromVersionId: 'HO-NAT-v2' };
  assert.equal((await r('POST', '/api/v1/rating-versions', { user: 'agent.demo', body: draft })).status, 403);
  assert.equal((await r('POST', '/api/v1/rating-versions/HO-NAT-v3/approve', { user: 'analyst.demo', body: {} })).status, 403);
  assert.equal((await r('PUT', '/api/v1/rating-versions/HO-NAT-v3', { user: 'approver.demo', body: { label: 'x' } })).status, 403);
  assert.equal((await r('GET', '/api/v1/submissions', { user: 'rateguard.client' })).status, 403);
  assert.equal((await r('GET', '/api/v1/audit', { user: 'agent.demo' })).status, 403);
  assert.equal((await r('GET', '/api/v1/audit', { user: 'analyst.demo' })).status, 200);
  assert.equal((await r('POST', '/api/v1/admin/reset', { user: 'approver.demo', body: { confirm: 'RESET' } })).status, 403);
  assert.equal((await r('POST', '/api/v1/workbooks', { user: 'approver.demo', body: Buffer.from('x'), raw: true })).status, 403);
  assert.equal((await r('POST', '/api/v1/quotes', { user: 'rateguard.client', body: baselineScenario('bop', 'NY') })).status, 200);
  assert.equal((await r('POST', '/api/v1/feedback', { user: 'rateguard.client', body: { type: 'terminology', productId: 'bop', payload: { term: 'a', meaning: 'b' } } })).status, 403);
  const me = await r('GET', '/api/v1/auth/me', { user: 'approver.demo' });
  assert.ok(me.data.permissions.includes('config:approve') && !me.data.permissions.includes('config:edit'));
});

test('discovery: products, input schema (with JSON Schema), jurisdictions, version resolution', async () => {
  const p = await r('GET', '/api/v1/products', { user: 'rateguard.client' });
  assert.deepEqual(p.data.products.map((x) => x.id), ['personal-auto', 'homeowners', 'commercial-property', 'bop']);
  const sch = await r('GET', '/api/v1/products/homeowners/schema?state=FL', { user: 'rateguard.client' });
  assert.equal(sch.status, 200);
  assert.equal(sch.data.productVersion.id, 'HO-PROD-v1');
  assert.ok(sch.data.sections.some((s) => s.id === 'systems'));
  const js = sch.data.jsonSchema;
  assert.equal(js.properties.risk.properties.roof_year.type, 'integer');
  assert.deepEqual(js.properties.coverages.properties.aop_deductible.enum, ['1000', '2500', '5000', '10000']);
  assert.equal(js.properties.risk.additionalProperties, false);
  const auto = (await r('GET', '/api/v1/products/personal-auto/schema', { user: 'rateguard.client' })).data.jsonSchema;
  assert.equal(auto.properties.risk.properties.vehicles.type, 'array'); assert.equal(auto.properties.risk.properties.vehicles.maxItems, 6);
  assert.equal((await r('GET', '/api/v1/products/nope/schema', { user: 'agent.demo' })).status, 404);
  const j = await r('GET', '/api/v1/jurisdictions', { user: 'agent.demo' });
  assert.equal(j.data.states.length, 10);
  const res = await r('GET', '/api/v1/rating-versions/resolve?productId=homeowners&state=FL&date=2026-10-15', { user: 'rateguard.client' });
  assert.equal(res.data.national.id, 'HO-NAT-v2'); assert.equal(res.data.stateOverride.id, 'HO-FL-v1'); assert.match(res.data.explanation, /HO-FL-v1/);
  const none = await r('GET', '/api/v1/rating-versions/resolve?productId=homeowners&state=GA&date=2026-10-15', { user: 'rateguard.client' });
  assert.equal(none.data.stateOverride, null);
  const list = await r('GET', '/api/v1/rating-versions?productId=homeowners&state=FL', { user: 'rateguard.client' });
  assert.ok(list.data.versions.every((v) => v.productId === 'homeowners' && (v.scope.level === 'national' || v.scope.state === 'FL')));
  assert.ok(list.data.versions.find((v) => v.id === 'HO-NAT-v1').effectiveState === 'superseded');
  assert.ok(list.data.versions.find((v) => v.id === 'HO-NAT-v2').effectiveState === 'in_effect');
  const full = await r('GET', '/api/v1/rating-versions/HO-NAT-v2', { user: 'rateguard.client' });
  assert.ok(full.data.version.content.tables.ROOF_AGE);
});

test('single quote API: complete, version-stamped, deterministic result', async () => {
  const sc = { ...patchScenario('homeowners', 'AZ', { risk: { roof_year: 2005 } }), scenarioId: 'HO-AZ-roof21' };
  const a = await r('POST', '/api/v1/quotes', { user: 'rateguard.client', body: sc });
  assert.equal(a.status, 200);
  const q = a.data;
  assert.equal(q.scenarioId, 'HO-AZ-roof21'); assert.equal(q.productId, 'homeowners'); assert.equal(q.lineOfBusiness, 'HOMEOWNERS'); assert.equal(q.state, 'AZ');
  assert.equal(q.transactionType, 'NEW_BUSINESS'); assert.equal(q.effectiveDate, '2026-10-15');
  assert.deepEqual(q.risk, sc.risk); assert.deepEqual(q.coverages, sc.coverages);
  assert.equal(q.versions.product.id, 'HO-PROD-v1'); assert.equal(q.versions.rating[0].id, 'HO-NAT-v2');
  assert.equal(q.status, 'QUOTED'); assert.equal(q.premium.currency, 'USD'); assert.ok(q.premium.total > 0);
  assert.ok(q.premium.components.every((c) => c.id && c.label && typeof c.amount === 'number'));
  assert.equal(q.eligibility.decision, 'ELIGIBLE');
  const roof = q.trace.find((t) => t.step === 'l_roof_age');
  assert.deepEqual([roof.table, roof.matched.age_min, roof.value], ['ROOF_AGE', 21, 1.35], 'trace names the table and the matched row');
  assert.ok(q.appliedConfig.tables.some((t) => t.id === 'ROOF_AGE' && t.origin === 'HO-NAT-v2'));
  assert.ok(q.premium.paymentPlans.length >= 2);
  assert.match(q.disclaimer, /SYNTHETIC/);
  const b = await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: sc });
  assert.equal(b.data.resultHash, q.resultHash);
  const noTrace = await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: { ...sc, options: { trace: false } } });
  assert.equal(noTrace.data.trace, undefined); assert.equal(noTrace.data.resultHash, q.resultHash);
});

test('single quote API: business outcomes are 200 with status; contract errors are 4xx', async () => {
  const sc = baselineScenario('personal-auto', 'AZ');
  const refer = await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: patchScenario('personal-auto', 'AZ', { risk: { drivers: [{ sr22: true }] } }) });
  assert.equal(refer.status, 200); assert.equal(refer.data.status, 'REFERRED'); assert.equal(refer.data.premium, undefined); assert.equal(refer.data.eligibility.reasons[0].code, 'PA_REF_SR22');
  const inv = await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: { ...sc, risk: { ...sc.risk, garaging_zip: 'abc' } } });
  assert.equal(inv.status, 200); assert.equal(inv.data.status, 'INVALID'); assert.equal(inv.data.validation.errors[0].path, 'risk.garaging_zip');
  assert.equal((await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: { productId: 'bop' } })).status, 400);
  assert.equal((await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: { ...sc, productId: 'pet-insurance' } })).status, 404);
  assert.equal((await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: { ...sc, transactionType: 'ENDORSEMENT' } })).status, 400);
  const badJson = await S.request('POST', '/api/v1/quotes', { user: 'agent.demo', body: '{not json', raw: true, headers: { 'content-type': 'application/json' } });
  assert.equal(badJson.status, 400); assert.equal(badJson.data.error.code, 'BAD_JSON');
  assert.equal((await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: { ...sc, ratingVersionIds: { national: 'PA-NAT-v1' } } })).status, 403);
  const pinned = await r('POST', '/api/v1/quotes', { user: 'rateguard.client', body: { ...sc, ratingVersionIds: { national: 'PA-NAT-v1' } } });
  assert.equal(pinned.data.versions.rating[0].id, 'PA-NAT-v1'); assert.equal(pinned.data.versions.pinned, true);
  assert.equal((await r('GET', '/api/v1/definitely/not/a/route', { user: 'agent.demo' })).status, 404);
});

test('batch API: many scenarios, per-item outcomes, defaults, limits', async () => {
  const set = scenarioSet('homeowners', { states: ['AZ', 'FL'], variationStates: [] });
  const b = await r('POST', '/api/v1/quotes/batch', { user: 'rateguard.client', body: { scenarios: [...set, { scenarioId: 'bad', productId: 'homeowners' }, { ...patchScenario('homeowners', 'AZ', { risk: { dog: 'restricted_breed' } }), scenarioId: 'ref' }] } });
  assert.equal(b.status, 200);
  assert.equal(b.data.count, 4);
  assert.deepEqual(b.data.summary, { QUOTED: 2, REQUEST_ERROR: 1, REFERRED: 1 });
  assert.deepEqual(b.data.results.map((x) => x.scenarioId), [set[0].scenarioId, set[1].scenarioId, 'bad', 'ref']);
  assert.equal(b.data.results[2].status, 'REQUEST_ERROR');
  assert.equal(b.data.results[0].trace, undefined, 'batch omits trace by default');
  const base = baselineScenario('bop', 'NY');
  const withDefaults = await r('POST', '/api/v1/quotes/batch', { user: 'rateguard.client', body: { defaults: { productId: 'bop', transactionType: 'NEW_BUSINESS', effectiveDate: '2026-10-15', state: 'NY' }, scenarios: [{ scenarioId: 'one', risk: base.risk, coverages: base.coverages }, { scenarioId: 'two', risk: base.risk, coverages: { ...base.coverages, cyber: '250000' } }], options: { trace: true } } });
  assert.deepEqual(withDefaults.data.results.map((x) => x.status), ['QUOTED', 'QUOTED']);
  assert.ok(withDefaults.data.results[1].premium.total > withDefaults.data.results[0].premium.total);
  assert.ok(withDefaults.data.results[0].trace.length > 0);
  const big = await r('POST', '/api/v1/quotes/batch', { user: 'rateguard.client', body: { scenarios: Array.from({ length: 201 }, () => base) } });
  assert.equal(big.status, 413);
  assert.equal((await r('POST', '/api/v1/quotes/batch', { user: 'rateguard.client', body: { scenarios: [] } })).status, 400);
  // a batch of 200 scenarios is rated quickly
  const t0 = Date.now();
  const two = await r('POST', '/api/v1/quotes/batch', { user: 'rateguard.client', body: { scenarios: Array.from({ length: 200 }, (_, i) => ({ ...base, scenarioId: `n${i}` })) } });
  assert.equal(two.data.summary.QUOTED, 200); assert.ok(Date.now() - t0 < 10000);
});

test('validation APIs: candidate document and stored draft (read-only for the API client)', async () => {
  const defective = (await r('GET', '/api/v1/rating-versions/HO-NAT-v5', { user: 'rateguard.client' })).data.version;
  const rep = await r('POST', '/api/v1/rating-versions/validate', { user: 'rateguard.client', body: { productId: defective.productId, scope: defective.scope, effectiveFrom: defective.effectiveFrom, content: defective.content } });
  assert.equal(rep.status, 200); assert.equal(rep.data.valid, false); assert.ok(rep.data.errors.some((e) => e.code === 'RANGE_GAP'));
  assert.match(rep.data.note, /not stored/);
  const stored = await r('POST', '/api/v1/rating-versions/HO-NAT-v3/validate', { user: 'rateguard.client', body: {} });
  assert.equal(stored.data.persisted, false); assert.equal(stored.data.report.valid, true);
  assert.equal((await r('GET', '/api/v1/rating-versions/HO-NAT-v3', { user: 'agent.demo' })).data.version.status, 'draft', 'client validation did not change the draft');
  const good = (await r('GET', '/api/v1/rating-versions/HO-NAT-v3', { user: 'agent.demo' })).data.version;
  const ok = await r('POST', '/api/v1/rating-versions/validate', { user: 'rateguard.client', body: { productId: 'homeowners', scope: good.scope, effectiveFrom: '2026-12-01', content: good.content } });
  assert.equal(ok.data.valid, true); assert.ok(ok.data.smoke.quoted >= 20); assert.ok(ok.data.impact.averagePct > 3);
  assert.equal((await r('POST', '/api/v1/rating-versions/validate', { user: 'agent.demo', body: {} })).status, 403);
  assert.equal((await r('POST', '/api/v1/rating-versions/validate', { user: 'rateguard.client', body: { productId: 'homeowners' } })).status, 400);
});

test('submission journey: create, rate, edit, requote, bind (simulated), renewal and endorsement scenarios', async () => {
  const sc = baselineScenario('homeowners', 'GA');
  const c = await r('POST', '/api/v1/submissions', { user: 'agent.demo', body: { productId: 'homeowners', state: 'GA', name: 'Journey test', effectiveDate: '2026-11-01', risk: sc.risk, coverages: sc.coverages } });
  assert.equal(c.status, 201); const id = c.data.submission.id; assert.equal(c.data.submission.status, 'DRAFT');
  const r1 = await r('POST', `/api/v1/submissions/${id}/rate`, { user: 'agent.demo', body: {} });
  assert.equal(r1.data.quote.status, 'QUOTED'); assert.match(r1.data.quote.quoteId, /^Q-\d+$/); assert.equal(r1.data.submission.status, 'QUOTED');
  const first = r1.data.quote.premium.total;
  const upd = await r('PUT', `/api/v1/submissions/${id}`, { user: 'agent.demo', body: { coverages: { ...sc.coverages, aop_deductible: '10000' } } });
  assert.equal(upd.data.submission.status, 'DRAFT');
  const r2 = await r('POST', `/api/v1/submissions/${id}/rate`, { user: 'agent.demo', body: {} });
  assert.ok(r2.data.quote.premium.total < first, 'a higher deductible requotes lower');
  const qs = await r('GET', `/api/v1/submissions/${id}/quotes`, { user: 'agent.demo' });
  assert.equal(qs.data.quotes.length, 2);
  const stored = await r('GET', `/api/v1/quotes/${r1.data.quote.quoteId}`, { user: 'agent.demo' });
  assert.equal(stored.data.premium.total, first, 'earlier quote is immutable');
  // scenarios need a quoted submission; a renewal and an endorsement
  const ren = await r('POST', `/api/v1/submissions/${id}/scenarios`, { user: 'agent.demo', body: { type: 'RENEWAL', effectiveDate: '2027-11-01' } });
  assert.equal(ren.status, 201); assert.equal(ren.data.submission.transactionType, 'RENEWAL'); assert.equal(ren.data.submission.priorTermPremium, r2.data.quote.premium.total);
  const end = await r('POST', `/api/v1/submissions/${id}/scenarios`, { user: 'agent.demo', body: { type: 'ENDORSEMENT', effectiveDate: '2027-03-01' } });
  const eid = end.data.submission.id;
  await r('PUT', `/api/v1/submissions/${eid}`, { user: 'agent.demo', body: { coverages: { ...sc.coverages, water_backup: '10000', identity_theft: true } } });
  const er = await r('POST', `/api/v1/submissions/${eid}/rate`, { user: 'agent.demo', body: {} });
  assert.equal(er.data.quote.transactionType, 'ENDORSEMENT'); assert.equal(er.data.quote.endorsement.computed, true);
  assert.ok(er.data.quote.endorsement.proratedChange > 0 && er.data.quote.endorsement.proratedChange < er.data.quote.endorsement.annualPremiumChange);
  const rr = await r('POST', `/api/v1/submissions/${ren.data.submission.id}/rate`, { user: 'agent.demo', body: {} });
  assert.equal(rr.data.quote.status, 'QUOTED');
  // simulated bind
  const bound = await r('POST', `/api/v1/submissions/${id}/bind-simulated`, { user: 'agent.demo' });
  assert.equal(bound.data.submission.status, 'BOUND_SIMULATED'); assert.match(bound.data.submission.bind.simulatedPolicyNumber, /^SIM-/); assert.match(bound.data.submission.bind.notice, /no coverage exists/i);
  assert.equal((await r('PUT', `/api/v1/submissions/${id}`, { user: 'agent.demo', body: { name: 'x' } })).status, 409);
  assert.equal((await r('DELETE', `/api/v1/submissions/${id}`, { user: 'agent.demo' })).status, 409);
  assert.equal((await r('POST', `/api/v1/submissions/${id}/bind-simulated`, { user: 'agent.demo' })).status, 409);
  // can't bind a referral
  const rf = await r('POST', '/api/v1/submissions', { user: 'agent.demo', body: { productId: 'homeowners', state: 'GA', risk: { ...sc.risk, dog: 'restricted_breed' }, coverages: sc.coverages, effectiveDate: '2026-11-01' } });
  await r('POST', `/api/v1/submissions/${rf.data.submission.id}/rate`, { user: 'agent.demo', body: {} });
  assert.equal((await r('POST', `/api/v1/submissions/${rf.data.submission.id}/bind-simulated`, { user: 'agent.demo' })).status, 409);
  assert.equal((await r('DELETE', `/api/v1/submissions/${rf.data.submission.id}`, { user: 'agent.demo' })).status, 204);
  assert.equal((await r('GET', '/api/v1/submissions/SUB-99999', { user: 'agent.demo' })).status, 404);
  assert.equal((await r('POST', '/api/v1/submissions', { user: 'agent.demo', body: { productId: 'homeowners' } })).status, 400);
  const search = await r('GET', '/api/v1/submissions?q=journey', { user: 'agent.demo' });
  assert.ok(search.data.submissions.some((s) => s.id === id));
});

test('workbench over HTTP: upload -> inspect -> preview -> import -> validate -> approve -> promote -> quote', async () => {
  const samples = await buildSamples();
  const up = await r('POST', '/api/v1/workbooks', { user: 'analyst.demo', body: samples.get('HO_NAT_rate_change_plus4pct.xlsx').buffer, raw: true, headers: { 'x-filename': 'HO_rate_change.xlsx', 'content-type': 'application/octet-stream' } });
  assert.equal(up.status, 201); assert.equal(up.data.workbook.accepted, true);
  const wid = up.data.workbook.id;
  const ins = await r('POST', `/api/v1/workbooks/${wid}/inspect`, { user: 'analyst.demo', body: { baseVersionId: 'HO-NAT-v2' } });
  const mapping = { ...ins.data.suggestedMapping, tables: ins.data.suggestedMapping.tables.map((t) => ({ ...t, confirmed: true, columns: Object.fromEntries(Object.entries(t.columns).map(([k, v]) => [k, v.source])) })), params: { ...ins.data.suggestedMapping.params, confirmed: true } };
  const prev = await r('POST', `/api/v1/workbooks/${wid}/preview`, { user: 'analyst.demo', body: { mapping, baseVersionId: 'HO-NAT-v2' } });
  assert.equal(prev.data.ok, true); assert.equal(prev.data.diff.summary.total, 10);
  const imp = await r('POST', `/api/v1/workbooks/${wid}/import`, { user: 'analyst.demo', body: { mapping, baseVersionId: 'HO-NAT-v2', effectiveFrom: '2027-02-01', label: 'Feb 2027 +4%' } });
  assert.equal(imp.status, 201); const vid = imp.data.draft.id;
  const val = await r('POST', `/api/v1/rating-versions/${vid}/validate`, { user: 'analyst.demo', body: {} });
  assert.equal(val.data.report.valid, true); assert.equal(val.data.document.status, 'validated');
  assert.equal((await r('POST', `/api/v1/rating-versions/${vid}/submit`, { user: 'analyst.demo', body: { note: 'rate change' } })).data.version.status, 'pending_approval');
  assert.equal((await r('POST', `/api/v1/rating-versions/${vid}/approve`, { user: 'admin.demo', body: {} })).data.version.status, 'approved', 'admin did not create it, so four-eyes is satisfied');
  assert.equal((await r('POST', `/api/v1/rating-versions/${vid}/promote`, { user: 'approver.demo', body: {} })).data.version.status, 'active');
  const sc = baselineScenario('homeowners', 'GA');
  const before = await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: { ...sc, effectiveDate: '2027-01-31' } });
  const after = await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: { ...sc, effectiveDate: '2027-02-01' } });
  assert.equal(before.data.versions.rating[0].id, 'HO-NAT-v2'); assert.equal(after.data.versions.rating[0].id, vid);
  assert.ok(after.data.premium.total > before.data.premium.total);
  const exp = await r('GET', `/api/v1/rating-versions/${vid}/export.xlsx`, { user: 'agent.demo' });
  assert.equal(exp.status, 200); assert.equal(exp.data[0], 0x50);
  // rollback: back to the previous version
  const rb = await r('POST', `/api/v1/rating-versions/${vid}/rollback`, { user: 'approver.demo', body: { reason: 'test rollback' } });
  assert.equal(rb.data.nowInForce, 'HO-NAT-v2');
  // unsafe upload is reported, not stored
  const bad = await r('POST', '/api/v1/workbooks', { user: 'analyst.demo', body: samples.get('UNSAFE_macro_parts.xlsx').buffer, raw: true, headers: { 'x-filename': 'macro.xlsx', 'content-type': 'application/octet-stream' } });
  assert.equal(bad.data.workbook.accepted, false); assert.ok(bad.data.report.issues.some((i) => i.code === 'MACROS'));
  const blocked = await r('POST', `/api/v1/workbooks/${bad.data.workbook.id}/inspect`, { user: 'analyst.demo', body: { baseVersionId: 'HO-NAT-v2' } });
  assert.equal(blocked.status, 422);
  const sam = await r('GET', '/api/v1/workbooks/samples', { user: 'analyst.demo' });
  assert.ok(sam.data.samples.length >= 10);
  assert.equal((await r('GET', '/api/v1/workbooks/samples/..%2Fpackage.json', { user: 'analyst.demo' })).status >= 400, true);
});

test('demo drafts + scenario runner: a normal change vs an intentional defect', async () => {
  const rc = await r('POST', '/api/v1/demo/drafts', { user: 'analyst.demo', body: { productId: 'personal-auto', kind: 'rate_change', pct: 2.5 } });
  assert.equal(rc.status, 201); assert.equal(rc.data.version.demo.kind, 'rate_change');
  const run = await r('POST', '/api/v1/test-tools/compare', { user: 'analyst.demo', body: { productId: 'personal-auto', baseline: { national: 'PA-NAT-v2' }, candidate: { national: rc.data.version.id }, states: ['AZ', 'TX'], variationStates: ['AZ'], expectedChangePct: 2.5, tolerancePct: 0.6, label: 'API test' } });
  assert.equal(run.status, 200);
  assert.match(run.data.notice, /Not RateGuard assurance/);
  assert.equal(run.data.summary.outsideExpectation, 0, 'a uniform change stays inside the stated expectation');
  assert.ok(run.data.summary.averagePct > 1.8 && run.data.summary.averagePct < 2.6);
  const def = await r('POST', '/api/v1/test-tools/compare', { user: 'analyst.demo', body: { productId: 'personal-auto', baseline: { national: 'PA-NAT-v2' }, candidate: { national: 'PA-NAT-v4' }, states: ['AZ'], variationStates: ['AZ'], expectedChangePct: 0, tolerancePct: 0.5 } });
  assert.ok(def.data.summary.outsideExpectation >= 1 && def.data.summary.unchanged > def.data.summary.changed, 'the silent defect moves only a few scenarios');
  assert.equal((await r('GET', `/api/v1/test-tools/runs/${run.data.id}`, { user: 'rateguard.client' })).data.rows.length, run.data.rows.length);
  assert.equal((await r('GET', '/api/v1/test-tools/scenario-sets/bop', { user: 'rateguard.client' })).data.count > 30, true);
  assert.equal((await r('POST', '/api/v1/demo/drafts', { user: 'analyst.demo', body: { productId: 'bop', kind: 'nope' } })).status, 400);
  assert.equal((await r('POST', '/api/v1/test-tools/compare', { user: 'analyst.demo', body: { productId: 'bop' } })).status, 400);
});

test('feedback API: scoped, reviewable, and powerless over rates', async () => {
  const sc = baselineScenario('bop', 'NY');
  const before = (await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: sc })).data.resultHash;
  const bad = await r('POST', '/api/v1/feedback', { user: 'agent.demo', body: { type: 'mapping_correction', productId: 'bop', payload: {} } });
  assert.equal(bad.status, 400);
  assert.equal((await r('POST', '/api/v1/feedback', { user: 'agent.demo', body: { type: 'terminology', productId: 'unknown', payload: { term: 'a', meaning: 'b' } } })).status, 400);
  const useful = await r('POST', '/api/v1/feedback', { user: 'agent.demo', body: { type: 'scenario_useful', productId: 'bop', versionId: 'BOP-NAT-v2', scenarioId: 'bop:NY:baseline', payload: { useful: false }, comment: 'Missed a restaurant-with-hood case' } });
  assert.equal(useful.status, 201); assert.equal(useful.data.feedback.status, 'submitted'); assert.equal(useful.data.feedback.versionId, 'BOP-NAT-v2');
  const expl = await r('POST', '/api/v1/feedback', { user: 'analyst.demo', body: { type: 'explanation_comment', productId: 'bop', quoteId: 'Q-000006', comment: 'Explain the package credit better' } });
  assert.equal((await r('POST', `/api/v1/feedback/${expl.data.feedback.id}/review`, { user: 'agent.demo', body: { decision: 'accept' } })).status, 403);
  assert.equal((await r('POST', `/api/v1/feedback/${expl.data.feedback.id}/review`, { user: 'approver.demo', body: { decision: 'maybe' } })).status, 400);
  const rev = await r('POST', `/api/v1/feedback/${expl.data.feedback.id}/review`, { user: 'approver.demo', body: { decision: 'accept', comment: 'noted' } });
  assert.equal(rev.data.feedback.status, 'accepted'); assert.equal(rev.data.hint, null);
  assert.equal((await r('POST', `/api/v1/feedback/${expl.data.feedback.id}/review`, { user: 'approver.demo', body: { decision: 'reject' } })).status, 409);
  const list = await r('GET', '/api/v1/feedback?productId=bop', { user: 'agent.demo' });
  assert.ok(list.data.feedback.length >= 2);
  assert.equal((await r('POST', '/api/v1/quotes', { user: 'agent.demo', body: sc })).data.resultHash, before);
});

test('audit trail: who/what/when, hash chain verifies and detects tampering', async () => {
  const a = await r('GET', '/api/v1/audit?entityId=HO-NAT-v1', { user: 'analyst.demo' });
  assert.ok(Array.isArray(a.data.entries));
  const v = await r('GET', '/api/v1/audit/verify', { user: 'approver.demo' });
  assert.equal(v.data.ok, true); assert.ok(v.data.entries > 50);
  const login = (await r('GET', '/api/v1/audit?action=LOGIN', { user: 'admin.demo' })).data.entries[0];
  assert.ok(login.actor.id && login.ts && login.hash && login.prevHash);
  // tamper with a stored entry
  const entry = await S.ctx.store.get('audit', login.id);
  entry.actor.id = 'someone.else'; await S.ctx.store.put('audit', entry);
  const broken = await r('GET', '/api/v1/audit/verify', { user: 'approver.demo' });
  assert.equal(broken.data.ok, false); assert.equal(broken.data.brokenAt, login.id);
  entry.actor.id = login.actor.id; await S.ctx.store.put('audit', entry);
  assert.equal((await r('GET', '/api/v1/audit/verify', { user: 'approver.demo' })).data.ok, true);
});

test('OpenAPI document matches the implemented routes (both directions)', async () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'openapi.json'), 'utf8'));
  const documented = new Set();
  for (const [p, ops] of Object.entries(doc.paths)) for (const m of Object.keys(ops)) documented.add(`${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`);
  const implemented = new Set();
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) for (const m of Object.keys(layer.route.methods)) implemented.add(`${m.toUpperCase()} ${prefix}${layer.route.path}`);
      else if (layer.name === 'router' && layer.handle.stack) walk(layer.handle.stack, prefix);
    }
  };
  walk(S.app._router.stack.find((l) => l.name === 'router' && l.handle.stack.some((x) => x.route?.path === '/meta')).handle.stack, '');
  const norm = (s) => s.replace(/:(\w+)/g, ':x');
  const docN = new Set([...documented].map(norm)); const impN = new Set([...implemented].map(norm));
  const missingInCode = [...docN].filter((x) => !impN.has(x));
  const missingInDocs = [...impN].filter((x) => !docN.has(x));
  assert.deepEqual(missingInCode, [], 'documented but not implemented');
  assert.deepEqual(missingInDocs.filter((x) => !x.includes('/product-versions/')), [], 'implemented but undocumented');
});

test('admin reset re-seeds local data (admin only, explicit confirmation)', async () => {
  assert.equal((await r('POST', '/api/v1/admin/reset', { user: 'admin.demo', body: {} })).status, 400);
  const res = await r('POST', '/api/v1/admin/reset', { user: 'admin.demo', body: { confirm: 'RESET' } });
  assert.equal(res.status, 200);
  const subs = await r('GET', '/api/v1/submissions', { user: 'agent.demo' });
  assert.equal(subs.data.submissions.length, 6);
  assert.equal((await r('GET', '/api/v1/audit/verify', { user: 'admin.demo' })).data.ok, true);
});
