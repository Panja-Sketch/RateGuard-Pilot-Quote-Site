// Core rating-engine behaviour on a small hand-computable configuration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalExpr, analyzeExpr, ExprError, yearsBetween } from '../shared/expr.js';
import { runRating, RatingError, matchRows } from '../server/engine/rate.js';
import { rateCore, buildSys } from '../server/engine/quoteCore.js';
import { mergeContent } from '../server/engine/merge.js';
import { T, E, S, R } from '../server/seed/helpers.js';

const { i, v, p, mul, add, sub, eq, gt } = E;
const scope = (inputs = {}, extra = {}) => ({ inputs, vars: {}, params: {}, locals: {}, ...extra });

test('expressions: arithmetic, comparison, short-circuit and safety', () => {
  assert.equal(evalExpr(add(1, 2, 3), scope()), 6);
  assert.equal(evalExpr(mul(2, E.div(9, 3)), scope()), 6);
  assert.equal(evalExpr(E.iff(gt(i('risk.x'), 5), 'big', 'small'), scope({ risk: { x: 7 } })), 'big');
  assert.equal(evalExpr(E.inn(i('risk.s'), 'a', 'b'), scope({ risk: { s: 'b' } })), true);
  assert.equal(evalExpr(E.clamp(15, 0, 10), scope()), 10);
  assert.equal(evalExpr(E.op('round', 1.005, 2), scope()), 1.01, 'half-up rounding with float guard');
  assert.equal(evalExpr(E.agg('max', 'risk.l', i('item.n')), scope({ risk: { l: [{ n: 3 }, { n: 9 }] } })), 9);
  assert.equal(evalExpr(E.agg('count', 'risk.l', undefined, gt(i('item.n'), 5)), scope({ risk: { l: [{ n: 3 }, { n: 9 }] } })), 1);
  assert.throws(() => evalExpr(E.div(1, 0), scope()), (e) => e instanceof ExprError && e.code === 'DIV_ZERO');
  assert.throws(() => evalExpr({ op: 'constructor', args: [] }, scope()), (e) => e.code === 'UNSUPPORTED_OP');
  assert.throws(() => evalExpr({ op: '__proto__', args: [] }, scope()), (e) => e.code === 'UNSUPPORTED_OP');
  assert.throws(() => evalExpr([1, 2], scope()), (e) => e.code === 'BAD_NODE');
  assert.throws(() => evalExpr(add('abc', 1), scope()), (e) => e.code === 'NOT_NUMBER');
  // short circuit: second arg would throw
  assert.equal(evalExpr(E.or(true, E.div(1, 0)), scope()), true);
  // depth limit
  let deep = 1; for (let n = 0; n < 40; n++) deep = add(deep, 1);
  assert.throws(() => evalExpr(deep, scope()), (e) => e.code === 'EXPR_TOO_DEEP');
});

test('expressions: dates and static analysis', () => {
  assert.equal(yearsBetween('1985-04-12', '2026-04-11'), 40);
  assert.equal(yearsBetween('1985-04-12', '2026-04-12'), 41);
  const a = analyzeExpr(E.add(i('risk.a'), v('x'), p('y'), { op: 'nope', args: [] }));
  assert.deepEqual([...a.inputs], ['risk.a']);
  assert.deepEqual([...a.vars], ['x']);
  assert.ok(a.errors.some((e) => /unsupported operation "nope"/.test(e)));
});

// ---- mini product ----
const MINI = {
  states: ['AZ', 'CA'], termMonths: 12,
  sections: [
    { id: 'a', group: 'risk', title: 'A', fields: [
      { key: 'age', label: 'Age', type: 'integer', required: true, min: 0, max: 120 },
      { key: 'tier', label: 'Tier', type: 'select', required: true, options: ['gold', 'silver'] },
      { key: 'items', label: 'Items', type: 'integer', required: true, min: 1, max: 5 },
    ] },
    { id: 'c', group: 'coverage', title: 'C', fields: [{ key: 'deductible', label: 'Deductible', type: 'select', required: true, options: ['500', '1000'] }, { key: 'promo', label: 'Promo', type: 'boolean', default: false }] },
  ],
};
const miniContent = () => ({
  params: { base: 100, fee: 10.005 },
  tables: {
    AGE: T.range('age', 'age', [[0, 25, 1.5], [25, 65, 1.0], [65, null, 1.2]]),
    TIER: T.exact('tier', 'tier', { gold: 0.9, silver: 1.1 }),
    DED: T.multi('ded by state', [{ name: 'state', kind: 'exact' }, { name: 'ded', kind: 'exact' }], [{ state: 'AZ', ded: '500', value: 1.1 }, { state: 'AZ', ded: '1000', value: 0.9 }, { state: 'CA', ded: '500', value: 1.2 }, { state: 'CA', ded: '1000', value: 1.0 }]),
  },
  derive: [S.set('d_double', 'double_age', mul(2, i('risk.age')))],
  rules: [R.decline('R_OLD', 'Too old', gt(i('risk.age'), 90)), R.refer('R_BIG', 'Many items', gt(i('risk.items'), 4)), R.info('R_GOLD_CHEAP', 'Check gold', E.and(eq(i('risk.tier'), 'gold'), eq(i('cov.deductible'), '1000'), gt(i('risk.age'), 80)))],
  plan: [
    S.lookup('l_age', 'AGE', { age: i('risk.age') }, 'f_age'),
    S.lookup('l_tier', 'TIER', { tier: i('risk.tier') }, 'f_tier'),
    S.lookup('l_ded', 'DED', { state: i('risk.state'), ded: i('cov.deductible') }, 'f_ded'),
    S.foreach('each', 'risk.items_list', 'it', 'Item', [S.component('c_item', 'Item charge', mul(p('base'), v('f_age')), ['core'])]),
    S.component('c_main', 'Main', mul(p('base'), v('f_age'), v('f_tier'), v('f_ded')), ['core']),
    S.modifier('m_promo', 'Promo discount', E.iff(eq(i('cov.promo'), true), 0.9, 1), { kind: 'discount' }),
    S.fee('fee', 'Fee', p('fee')),
  ],
  limits: { minPremium: 50, maxPremium: 1000, rounding: { places: 2, mode: 'half_up' } },
});
const run = (content, risk, cov, state = 'AZ', extraSys = {}) => {
  const sys = buildSys({ transactionType: 'NEW_BUSINESS', ratingDate: '2026-01-01', effectiveDate: '2026-01-01', state, ...extraSys });
  return rateCore(MINI, content, { params: {}, tables: {}, rules: {}, steps: {} }, { state, risk, coverages: cov, sys, trace: true });
};

test('engine: exact, range (half-open) and multi-key lookups give hand-computed premium', () => {
  const c = miniContent(); c.plan = c.plan.filter((s) => s.id !== 'each');
  const r = run(c, { age: 30, tier: 'gold', items: 1 }, { deductible: '1000' });
  // 100 * 1.0 * 0.9 * 0.9 = 81 ; + fee 10.005 -> 10.01 (half-up) ; total 91.01
  assert.equal(r.status, 'QUOTED');
  assert.equal(r.premium.components[0].amount, 81);
  assert.equal(r.premium.fees[0].amount, 10.01);
  assert.equal(r.premium.total, 91.01);
  // range boundaries: [25,65) -> 25 is in the middle band, 24 is the lower band, 65 is the upper band
  const f = (age) => run(c, { age, tier: 'gold', items: 1 }, { deductible: '1000' }).premium.components[0].amountBeforeModifiers;
  assert.equal(f(24), 100 * 1.5 * 0.9 * 0.9);
  assert.equal(f(25), 100 * 1.0 * 0.9 * 0.9);
  assert.equal(f(64), 100 * 1.0 * 0.9 * 0.9);
  assert.equal(f(65), 100 * 1.2 * 0.9 * 0.9);
  // multi-key: state changes the deductible factor
  const ca = run(c, { age: 30, tier: 'silver', items: 1 }, { deductible: '500' }, 'CA');
  assert.equal(ca.premium.components[0].amount, 100 * 1 * 1.1 * 1.2);
});

test('engine: modifiers, minimum and maximum premium, rounding and trace', () => {
  const c = miniContent(); c.plan = c.plan.filter((s) => s.id !== 'each');
  const promo = run(c, { age: 30, tier: 'gold', items: 1 }, { deductible: '1000', promo: true });
  assert.equal(promo.premium.components[0].amount, 72.9); // 81 * 0.9
  assert.equal(promo.premium.modifiers[0].id, 'm_promo');
  assert.equal(promo.premium.modifiers[0].amountEffect, -8.1);
  assert.ok(promo.trace.some((t) => t.step === 'l_age' && t.matched.age_min === 25), 'trace shows the matched row');
  // minimum premium
  const low = miniContent(); low.plan = low.plan.filter((s) => s.id !== 'each'); low.params.base = 10; low.params.fee = 0;
  const m = run(low, { age: 30, tier: 'gold', items: 1 }, { deductible: '1000' });
  assert.equal(m.premium.adjustments[0].id, 'minimum_premium');
  assert.equal(m.premium.total, 50);
  // maximum premium
  const high = miniContent(); high.plan = high.plan.filter((s) => s.id !== 'each'); high.params.base = 5000;
  const mx = run(high, { age: 30, tier: 'gold', items: 1 }, { deductible: '1000' });
  assert.equal(mx.premium.total, 1000);
  assert.equal(mx.premium.adjustments[0].id, 'maximum_premium');
  // total always equals components + fees + adjustments
  for (const r of [promo, m, mx]) {
    const sum = r.premium.components.reduce((s, c2) => s + Math.round(c2.amount * 100), 0) + r.premium.fees.reduce((s, f) => s + Math.round(f.amount * 100), 0) + r.premium.adjustments.reduce((s, a) => s + Math.round(a.amount * 100), 0);
    assert.equal(Math.round(r.premium.total * 100), sum);
  }
});

test('engine: eligibility rules decide before rating; priority is decline > refer > info', () => {
  const c = miniContent(); c.plan = c.plan.filter((s) => s.id !== 'each');
  assert.equal(run(c, { age: 95, tier: 'gold', items: 5 }, { deductible: '1000' }).status, 'DECLINED');
  const ref = run(c, { age: 30, tier: 'gold', items: 5 }, { deductible: '1000' });
  assert.equal(ref.status, 'REFERRED'); assert.equal(ref.premium, null);
  assert.equal(run(c, { age: 85, tier: 'gold', items: 1 }, { deductible: '1000' }).status, 'INFO_REQUIRED');
});

test('engine: missing rate and ambiguous rate fail loudly, never silently', () => {
  const c = miniContent(); c.plan = c.plan.filter((s) => s.id !== 'each');
  c.tables.DED.rows = c.tables.DED.rows.filter((r) => !(r.state === 'CA' && r.ded === '500'));
  const miss = run(c, { age: 30, tier: 'gold', items: 1 }, { deductible: '500' }, 'CA');
  assert.equal(miss.status, 'RATING_ERROR'); assert.equal(miss.error.code, 'NO_RATE_FOUND');
  const amb = miniContent(); amb.plan = amb.plan.filter((s) => s.id !== 'each');
  amb.tables.AGE.rows.push({ age_min: 20, age_max: 30, value: 9 });
  const r = run(amb, { age: 22, tier: 'gold', items: 1 }, { deductible: '1000' });
  assert.equal(r.status, 'RATING_ERROR'); assert.equal(r.error.code, 'AMBIGUOUS_RATE');
  assert.throws(() => runRating({ tables: {}, plan: [{ id: 'x', op: 'eval', code: '1+1' }] }, {}, { risk: {}, cov: {}, sys: {} }), (e) => e instanceof RatingError && e.code === 'UNSUPPORTED_STEP');
});

test('engine: is deterministic (same input, same output, no clock/randomness)', () => {
  const c = miniContent(); c.plan = c.plan.filter((s) => s.id !== 'each');
  const a = JSON.stringify(run(c, { age: 41, tier: 'silver', items: 2 }, { deductible: '500' }));
  const b = JSON.stringify(run(c, { age: 41, tier: 'silver', items: 2 }, { deductible: '500' }));
  assert.equal(a, b);
});

test('engine: input validation reports understandable, field-level errors and strips hidden fields', () => {
  const c = miniContent(); c.plan = c.plan.filter((s) => s.id !== 'each');
  const r = run(c, { age: 'old', tier: 'bronze', extra: 1 }, { deductible: '777' });
  assert.equal(r.status, 'INVALID');
  const byPath = Object.fromEntries(r.validation.errors.map((e) => [e.path, e]));
  assert.equal(byPath['risk.age'].code, 'TYPE');
  assert.equal(byPath['risk.tier'].code, 'ENUM');
  assert.match(byPath['risk.tier'].message, /gold, silver/i);
  assert.equal(byPath['risk.items'].code, 'REQUIRED');
  assert.equal(byPath['risk.extra'].code, 'UNKNOWN_FIELD');
  assert.equal(byPath['coverages.deductible'].code, 'ENUM');
});

test('merge: state override replaces tables/params/rules and records origins', () => {
  const nat = miniContent();
  const { content, origins } = mergeContent(nat, 'NAT-1', {
    params: { base: 120 },
    tables: { TIER: T.exact('tier', 'tier', { gold: 0.5, silver: 1.0 }) },
    rules: [R.refer('R_BIG', 'Fewer items', gt(i('risk.items'), 2))],
    removeRules: ['R_OLD'],
    additionalSteps: [{ after: 'c_main', step: S.fee('fee_state', 'State fee', 3) }],
  }, 'AZ-1');
  assert.equal(content.params.base, 120);
  assert.equal(content.tables.TIER.rows[0].value, 0.5);
  assert.equal(origins.tables.TIER, 'AZ-1'); assert.equal(origins.tables.AGE, 'NAT-1');
  assert.equal(origins.rules.R_BIG, 'AZ-1');
  assert.ok(!content.rules.some((r) => r.id === 'R_OLD'));
  assert.ok(content.plan.findIndex((s) => s.id === 'fee_state') === content.plan.findIndex((s) => s.id === 'c_main') + 1);
  assert.equal(matchRows(content.tables.AGE, { age: 70 }).length, 1);
});
