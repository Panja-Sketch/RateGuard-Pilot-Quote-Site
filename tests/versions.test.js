// Version selection (national default / state override / effective dates), validation gate, lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, actors } from './helpers.js';
import { baselineScenario, patchScenario } from '../server/seed/scenarios.js';
import { clone, hashOf } from '../server/engine/util.js';

const quote = (ctx, sc, over = {}, opts = {}) => ctx.quotes.quote(actors.admin, { ...sc, options: { trace: false }, ...over }, { allowPins: true, ...opts });
const ratingIds = (r) => r.versions.rating.map((v) => v.id);

test('selection: national default applies when no state override exists', async () => {
  const ctx = await makeContext();
  const r = await quote(ctx, baselineScenario('homeowners', 'GA'));
  assert.equal(r.status, 'QUOTED');
  assert.deepEqual(ratingIds(r), ['HO-NAT-v2']);
  assert.equal(r.versions.product.id, 'HO-PROD-v1');
  assert.match(r.versions.effectiveConfigHash, /^[a-f0-9]{64}$/);
});

test('selection: state override layers on top of national and changes the result', async () => {
  const ctx = await makeContext();
  const fl = await quote(ctx, baselineScenario('homeowners', 'FL'));
  assert.deepEqual(ratingIds(fl), ['HO-NAT-v2', 'HO-FL-v1']);
  assert.equal(fl.premium.fees[0].amount, 35, 'FL policy fee comes from the state override');
  assert.ok(fl.premium.modifiers.some((m) => m.id === 'm_fl_cat_fund'), 'state-specific modifier step was inserted');
  assert.equal(fl.appliedConfig.tables.find((t) => t.id === 'PPC').origin, 'HO-NAT-v2');
  const ga = await quote(ctx, baselineScenario('homeowners', 'GA'));
  assert.equal(ga.premium.fees[0].amount, 25, 'GA keeps the national policy fee');
  // CA wildfire load table comes from the CA override
  const ca = await quote(ctx, patchScenario('homeowners', 'CA', { risk: { wildfire_risk: 'high' } }));
  assert.equal(ca.appliedConfig.tables.find((t) => t.id === 'WILDFIRE').origin, 'HO-CA-v1');
  // CA state rule: very high wildfire is declined only in CA
  assert.equal((await quote(ctx, patchScenario('homeowners', 'CA', { risk: { wildfire_risk: 'very_high' } }))).status, 'DECLINED');
  assert.equal((await quote(ctx, patchScenario('homeowners', 'AZ', { risk: { wildfire_risk: 'very_high' } }))).status, 'QUOTED');
});

test('selection: effective dates choose the right national version (boundaries inclusive of start)', async () => {
  const ctx = await makeContext();
  const sc = baselineScenario('personal-auto', 'GA');
  const at = async (d) => ratingIds(await quote(ctx, { ...sc, effectiveDate: d }));
  assert.deepEqual(await at('2026-06-30'), ['PA-NAT-v1']);
  assert.deepEqual(await at('2026-07-01'), ['PA-NAT-v2']);
  assert.deepEqual(await at('2025-01-01'), ['PA-NAT-v1']);
  const before = await quote(ctx, { ...sc, effectiveDate: '2024-12-31' });
  assert.equal(before.status, 'RATING_ERROR');
  assert.equal(before.error.code, 'NO_APPLICABLE_VERSION');
  // v2 base rates are 3.5% higher than v1 (same inputs)
  const v1 = (await quote(ctx, { ...sc, effectiveDate: '2026-06-30' })).premium.components.find((c) => c.id === 'c_bi#1').amountBeforeModifiers;
  const v2 = (await quote(ctx, { ...sc, effectiveDate: '2026-07-01' })).premium.components.find((c) => c.id === 'c_bi#1').amountBeforeModifiers;
  assert.ok(Math.abs(v2 / v1 - 1.035) < 0.002, `ratio ${v2 / v1}`);
});

test('selection: future-dated and state-specific effective dates', async () => {
  const ctx = await makeContext();
  const sc = baselineScenario('personal-auto', 'CA');
  assert.deepEqual(ratingIds(await quote(ctx, { ...sc, effectiveDate: '2026-12-31' })), ['PA-NAT-v2', 'PA-CA-v1']);
  assert.deepEqual(ratingIds(await quote(ctx, { ...sc, effectiveDate: '2027-01-01' })), ['PA-NAT-v2', 'PA-CA-v2']);
  // TX override only starts 2026-01-01
  const tx = baselineScenario('homeowners', 'TX');
  assert.deepEqual(ratingIds(await quote(ctx, { ...tx, effectiveDate: '2025-12-31' })), ['HO-NAT-v1']);
  assert.deepEqual(ratingIds(await quote(ctx, { ...tx, effectiveDate: '2026-01-01' })), ['HO-NAT-v1', 'HO-TX-v1']);
});

test('selection: endorsements are rated with the versions in force on the policy effective date', async () => {
  const ctx = await makeContext();
  const sc = baselineScenario('personal-auto', 'AZ');
  const r = await quote(ctx, { ...sc, transactionType: 'ENDORSEMENT', policyEffectiveDate: '2026-03-01', effectiveDate: '2026-10-15', endorsement: { priorRisk: sc.risk } });
  assert.deepEqual(ratingIds(r), ['PA-NAT-v1']);
  assert.equal(r.endorsement.computed, true);
  assert.equal(r.endorsement.annualPremiumChange, 0);
  // add a vehicle mid-term: prorated change is positive and smaller than the annual change
  const risk2 = clone(sc.risk); risk2.vehicles.push({ ...clone(sc.risk.vehicles[0]), year: 2019, model: 'Second' });
  const e = await quote(ctx, { ...sc, risk: risk2, transactionType: 'ENDORSEMENT', policyEffectiveDate: '2026-03-01', effectiveDate: '2026-10-15', endorsement: { priorRisk: sc.risk } });
  assert.ok(e.endorsement.annualPremiumChange > 0);
  assert.ok(e.endorsement.proratedChange > 0 && e.endorsement.proratedChange < e.endorsement.annualPremiumChange);
  assert.equal(e.endorsement.daysRemaining, 137);
  const out = await quote(ctx, { ...sc, transactionType: 'ENDORSEMENT', policyEffectiveDate: '2026-03-01', effectiveDate: '2027-04-01', endorsement: { priorRisk: sc.risk } });
  assert.equal(out.endorsement.computed, false);
});

test('renewal cap limits a rate increase against the prior-term premium', async () => {
  const ctx = await makeContext();
  const sc = baselineScenario('personal-auto', 'AZ');
  const free = await quote(ctx, sc);
  const prior = Math.round(free.premium.total * 0.5 * 100) / 100;
  const r = await quote(ctx, { ...sc, transactionType: 'RENEWAL', priorTermPremium: prior });
  assert.equal(r.premium.adjustments[0].id, 'renewal_cap');
  assert.equal(r.premium.total, Math.round(prior * 1.15 * 100) / 100);
});

test('pinning versions needs permission and marks results; drafts can be rated by pin', async () => {
  const ctx = await makeContext();
  const sc = baselineScenario('homeowners', 'AZ');
  await assert.rejects(() => ctx.quotes.quote(actors.agent, { ...sc, ratingVersionIds: { national: 'HO-NAT-v1' } }), (e) => e.status === 403);
  const pinned = await ctx.quotes.quote(actors.analyst, { ...sc, ratingVersionIds: { national: 'HO-NAT-v3' } }, { allowPins: true });
  assert.equal(pinned.status, 'QUOTED');
  assert.deepEqual(ratingIds(pinned), ['HO-NAT-v3']);
  assert.equal(pinned.versions.pinned, true);
  assert.equal(pinned.versions.containsUnapprovedVersion, true);
  assert.equal(pinned.versions.rating[0].status, 'draft');
  const normal = await quote(ctx, sc);
  assert.equal(normal.versions.containsUnapprovedVersion, false);
  await assert.rejects(() => ctx.quotes.quote(actors.analyst, { ...sc, ratingVersionIds: { state: 'HO-FL-v1' } }, { allowPins: true }), (e) => e.code === 'BAD_PIN');
});

test('results are reproducible: same request -> same resultHash; different version -> different hash', async () => {
  const ctx = await makeContext();
  const sc = baselineScenario('bop', 'NY');
  const a = await quote(ctx, sc); const b = await quote(ctx, sc);
  assert.equal(a.resultHash, b.resultHash);
  const c = await quote(ctx, { ...sc, effectiveDate: '2026-01-01' });
  assert.notEqual(a.resultHash, c.resultHash);
});

// ---------------- validation ----------------
test('validation: every seeded active version validates cleanly', async () => {
  const ctx = await makeContext();
  const active = (await ctx.versions.list({})).filter((d) => d.status === 'active');
  assert.ok(active.length >= 27);
  for (const d of active) {
    const rep = await ctx.versions.validateDocument(d);
    assert.equal(rep.valid, true, `${d.id}: ${rep.errors.map((e) => e.code + ' ' + e.message).join(' | ')}`);
  }
});

test('validation: product versions validate', async () => {
  const ctx = await makeContext();
  for (const d of (await ctx.versions.list({ kind: 'product' }))) assert.equal((await ctx.versions.validateDocument(d)).valid, true, d.id);
});

test('validation: the intentional structural defect candidates fail with specific, readable errors; the normal change passes', async () => {
  const ctx = await makeContext();
  for (const abbr of ['PA', 'HO', 'CP', 'BOP']) {
    const normal = await ctx.versions.validateDocument(await ctx.versions.mustGet(`${abbr}-NAT-v3`));
    assert.equal(normal.valid, true, `${abbr}-NAT-v3 should be a clean rate change: ${normal.errors.map((e) => e.message).join('|')}`);
    assert.ok(normal.impact.averagePct > 2 && normal.impact.averagePct < 5, `${abbr} avg impact ${normal.impact.averagePct}`);
    const bad = await ctx.versions.validateDocument(await ctx.versions.mustGet(`${abbr}-NAT-v5`));
    assert.equal(bad.valid, false);
    const codes = new Set(bad.errors.map((e) => e.code));
    for (const c of ['RANGE_GAP', 'VALUE_OUT_OF_BOUNDS', 'INCOMPLETE_TABLE']) assert.ok(codes.has(c), `${abbr}-NAT-v5 should report ${c}; got ${[...codes]}`);
  }
});

test('validation: the silent defect passes structural validation (documented limitation of the pilot gate)', async () => {
  const ctx = await makeContext();
  for (const abbr of ['PA', 'HO', 'CP', 'BOP']) {
    const rep = await ctx.versions.validateDocument(await ctx.versions.mustGet(`${abbr}-NAT-v4`));
    assert.equal(rep.valid, true, `${abbr}-NAT-v4 is structurally valid by design`);
  }
  // …but the scenario runner shows which scenarios moved, even though nothing "failed"
  const run = await ctx.testTools.compare(actors.analyst, { productId: 'homeowners', baseline: { national: 'HO-NAT-v2' }, candidate: { national: 'HO-NAT-v4' }, states: ['AZ'], variationStates: ['AZ'], expectedChangePct: 0, tolerancePct: 0.5 });
  const flagged = run.rows.filter((r) => r.flag);
  assert.ok(flagged.length >= 2 && flagged.length < run.rows.length / 2, `flagged ${flagged.length}/${run.rows.length}`);
  assert.ok(flagged.every((r) => /roof-age-(21|30)/.test(r.scenarioId)), flagged.map((f) => f.scenarioId).join(','));
  assert.ok(flagged.every((r) => r.pct < 0), 'the mis-keyed 1.25 lowers the premium for old roofs');
});

test('validation: references, expressions and overlaps are checked', async () => {
  const ctx = await makeContext();
  const base = await ctx.versions.mustGet('HO-NAT-v2');
  const mutate = async (fn) => { const d = clone(base); d.id = 'candidate'; d.status = 'draft'; fn(d.content); return ctx.versions.validateDocument(d); };
  let r = await mutate((c) => { c.plan.find((s) => s.id === 'l_roof_type').keys.roof_type = { in: 'risk.roof_typo' }; });
  assert.ok(r.errors.some((e) => e.code === 'UNKNOWN_INPUT' && /roof_typo/.test(e.message)));
  r = await mutate((c) => { c.plan.find((s) => s.id === 's_cov_a').expr = { op: 'mul', args: [{ v: 'never_set' }, 2] }; });
  assert.ok(r.errors.some((e) => e.code === 'UNDEFINED_VARIABLE'));
  r = await mutate((c) => { c.tables.ROOF_AGE.rows[1].age_min = 5; });
  assert.ok(r.errors.some((e) => e.code === 'RANGE_OVERLAP'));
  r = await mutate((c) => { c.plan.push({ id: 'evil', op: 'script', code: 'process.exit(1)' }); });
  assert.ok(r.errors.some((e) => e.code === 'UNSUPPORTED_STEP'));
  r = await mutate((c) => { c.limits.minPremium = 9e6; c.limits.maxPremium = 100; });
  assert.ok(r.errors.some((e) => e.code === 'BAD_LIMIT'));
  r = await mutate((c) => { c.tables.CONSTR.rows[0].value = 'abc'; });
  assert.ok(r.errors.some((e) => e.code === 'MISSING_VALUE'));
  r = await mutate((c) => { c.params.policy_fee = { nested: true }; });
  assert.ok(r.errors.some((e) => e.code === 'BAD_PARAM'));
  r = await mutate((c) => { c.plan.find((s) => s.id === 'c_dwelling').amount = E_DIV0(); });
  assert.ok(r.errors.some((e) => e.code === 'SMOKE_FAILURE'), 'a runtime failure is caught by the smoke run before activation');
});
const E_DIV0 = () => ({ op: 'div', args: [1, 0] });

test('validation: a state override that targets a missing step is rejected', async () => {
  const ctx = await makeContext();
  const d = clone(await ctx.versions.mustGet('HO-FL-v1')); d.id = 'candidate'; d.status = 'draft';
  d.content.stepOverrides = { no_such_step: null };
  const r = await ctx.versions.validateDocument(d);
  assert.ok(r.errors.some((e) => e.code === 'OVERRIDE_TARGET_MISSING'));
});

// ---------------- lifecycle ----------------
test('lifecycle: draft -> validate -> submit -> approve (four-eyes) -> promote -> quotes use it; active versions are immutable', async () => {
  const ctx = await makeContext();
  const draft = await ctx.versions.createDraft(actors.analyst, { productId: 'homeowners', scope: { level: 'national' }, fromVersionId: 'HO-NAT-v2', label: 'Test +2%', effectiveFrom: '2026-11-01', changeTicket: { reference: 'SYN-T1', text: 'test' } });
  assert.equal(draft.id, 'HO-NAT-v6');
  assert.equal(draft.status, 'draft');
  const c = clone(draft.content); c.tables.BASE_RATE.rows.forEach((r) => { r.value = Math.round(r.value * 1.02 * 10000) / 10000; });
  const edited = await ctx.versions.updateDraft(actors.analyst, draft.id, { content: c });
  assert.equal(edited.status, 'draft');
  await assert.rejects(() => ctx.versions.submit(actors.analyst, draft.id), (e) => e.code === 'INVALID_TRANSITION', 'cannot submit before validation');
  const v = await ctx.versions.validate(actors.analyst, draft.id);
  assert.equal(v.report.valid, true); assert.equal(v.document.status, 'validated');
  // editing after validation invalidates it
  const again = await ctx.versions.updateDraft(actors.analyst, draft.id, { label: 'Test +2% (renamed)' });
  assert.equal(again.status, 'draft'); assert.equal(again.validation, null);
  await ctx.versions.validate(actors.analyst, draft.id);
  await ctx.versions.submit(actors.analyst, draft.id, 'please review');
  await assert.rejects(() => ctx.versions.approve(actors.analyst, draft.id), (e) => e.code === 'FOUR_EYES');
  await assert.rejects(() => ctx.versions.updateDraft(actors.analyst, draft.id, { label: 'x' }), (e) => e.code === 'NOT_EDITABLE', 'pending approval is locked');
  const ap = await ctx.versions.approve(actors.approver, draft.id, 'looks right');
  assert.equal(ap.status, 'approved'); assert.equal(ap.approvedBy, 'approver.demo'); assert.equal(ap.contentHash, hashOf(ap.content));
  const pr = await ctx.versions.promote(actors.approver, draft.id);
  assert.equal(pr.status, 'active'); assert.equal(pr.frozen, true);
  await assert.rejects(() => ctx.versions.updateDraft(actors.analyst, draft.id, { label: 'sneaky' }), (e) => e.code === 'NOT_EDITABLE');
  // quotes at/after the effective date use the new version, earlier ones don't
  const sc = baselineScenario('homeowners', 'GA');
  assert.deepEqual(ratingIds(await quote(ctx, { ...sc, effectiveDate: '2026-11-01' })), [draft.id]);
  assert.deepEqual(ratingIds(await quote(ctx, { ...sc, effectiveDate: '2026-10-31' })), ['HO-NAT-v2']);
  // audit trail records who did what, and the chain verifies
  const trail = (await ctx.audit.list({ entityId: draft.id })).map((e) => `${e.action}:${e.actor.id}`).reverse();
  assert.deepEqual(trail.slice(0, 1), ['CONFIG_CREATED:analyst.demo']);
  assert.ok(trail.includes('CONFIG_SUBMITTED:analyst.demo') && trail.includes('CONFIG_APPROVED:approver.demo') && trail.includes('CONFIG_PROMOTED:approver.demo'));
  assert.equal((await ctx.audit.verify()).ok, true);
});

test('lifecycle: rejection needs a reason; rolled-back versions fall back to the previous version', async () => {
  const ctx = await makeContext();
  const d = await ctx.versions.createDraft(actors.analyst, { productId: 'personal-auto', scope: { level: 'national' }, fromVersionId: 'PA-NAT-v2', effectiveFrom: '2026-12-01' });
  await ctx.versions.validate(actors.analyst, d.id); await ctx.versions.submit(actors.analyst, d.id);
  await assert.rejects(() => ctx.versions.reject(actors.approver, d.id, ''), (e) => e.code === 'REASON_REQUIRED');
  const rej = await ctx.versions.reject(actors.approver, d.id, 'Impact not explained in ticket');
  assert.equal(rej.status, 'rejected');
  await ctx.versions.updateDraft(actors.analyst, d.id, { label: 'resubmitted' }); // rejected -> editable again
  await ctx.versions.validate(actors.analyst, d.id); await ctx.versions.submit(actors.analyst, d.id);
  await ctx.versions.approve(actors.approver, d.id); await ctx.versions.promote(actors.approver, d.id);
  const sc = { ...baselineScenario('personal-auto', 'GA'), effectiveDate: '2026-12-15' };
  assert.deepEqual(ratingIds(await quote(ctx, sc)), [d.id]);
  await assert.rejects(() => ctx.versions.rollback(actors.approver, d.id, ''), (e) => e.code === 'REASON_REQUIRED');
  const rb = await ctx.versions.rollback(actors.approver, d.id, 'Defect found after release');
  assert.equal(rb.document.status, 'rolled_back'); assert.equal(rb.nowInForce, 'PA-NAT-v2');
  assert.deepEqual(ratingIds(await quote(ctx, sc)), ['PA-NAT-v2']);
  await assert.rejects(() => ctx.versions.promote(actors.approver, d.id), (e) => e.code === 'INVALID_TRANSITION');
});

test('lifecycle: promotion is blocked for failing content and for effective-date conflicts', async () => {
  const ctx = await makeContext();
  // conflict: another active national version already starts on 2026-07-01
  const dup = await ctx.versions.createDraft(actors.analyst, { productId: 'bop', scope: { level: 'national' }, fromVersionId: 'BOP-NAT-v2', effectiveFrom: '2026-07-01' });
  await ctx.versions.validate(actors.analyst, dup.id); await ctx.versions.submit(actors.analyst, dup.id); await ctx.versions.approve(actors.approver, dup.id);
  await assert.rejects(() => ctx.versions.promote(actors.approver, dup.id), (e) => e.code === 'EFFECTIVE_DATE_CONFLICT');
  // a structurally defective draft cannot be validated, therefore cannot be submitted
  const v = await ctx.versions.validate(actors.analyst, 'HO-NAT-v5');
  assert.equal(v.report.valid, false); assert.equal(v.document.status, 'draft');
  await assert.rejects(() => ctx.versions.submit(actors.analyst, 'HO-NAT-v5'), (e) => e.code === 'INVALID_TRANSITION');
});

test('lifecycle: diff shows before/after values with percent change', async () => {
  const ctx = await makeContext();
  const d = await ctx.versions.diff('HO-NAT-v2', 'HO-NAT-v3');
  assert.equal(d.changes.every((c) => c.area === 'table-row'), true);
  const az = d.changes.find((c) => c.key === 'state=AZ');
  assert.equal(az.path, 'tables.BASE_RATE'); assert.ok(az.pct > 3.9 && az.pct < 4.1);
  const silent = await ctx.versions.diff('HO-NAT-v2', 'HO-NAT-v4');
  assert.equal(silent.summary.total, 1); assert.equal(silent.changes[0].before, 1.35); assert.equal(silent.changes[0].after, 1.25);
  const ca1 = await ctx.versions.diff('PA-CA-v1', 'PA-CA-v2');
  assert.ok(ca1.changes.some((c) => c.path === 'tables.BASE_RATE'));
});

test('lifecycle: product versions follow the same gate and drive input validation by date', async () => {
  const ctx = await makeContext();
  const d = await ctx.versions.createDraft(actors.analyst, { kind: 'product', productId: 'bop', fromVersionId: 'BOP-PROD-v1', effectiveFrom: '2027-01-01', label: 'Adds a field' });
  const c = clone(d.content);
  c.sections.find((s) => s.id === 'optional').fields.push({ key: 'drone_coverage', label: 'Drone coverage', type: 'boolean', default: false });
  await ctx.versions.updateDraft(actors.analyst, d.id, { content: c });
  const v = await ctx.versions.validate(actors.analyst, d.id);
  assert.equal(v.report.valid, true);
  await ctx.versions.submit(actors.analyst, d.id); await ctx.versions.approve(actors.approver, d.id); await ctx.versions.promote(actors.approver, d.id);
  const sc = baselineScenario('bop', 'NY');
  const early = await quote(ctx, { ...sc, effectiveDate: '2026-12-31', coverages: { ...sc.coverages, drone_coverage: true } });
  assert.equal(early.status, 'INVALID'); assert.ok(early.validation.errors.some((e) => e.code === 'UNKNOWN_FIELD'));
  const later = await quote(ctx, { ...sc, effectiveDate: '2027-01-01', coverages: { ...sc.coverages, drone_coverage: true } });
  assert.equal(later.status, 'QUOTED'); assert.equal(later.versions.product.id, d.id);
});
