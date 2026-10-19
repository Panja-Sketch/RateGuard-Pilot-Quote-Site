// Four lines of business: distinct journeys, validation messages, eligibility outcomes, rating sanity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, actors } from './helpers.js';
import { baselineScenario, patchScenario, scenarioSet } from '../server/seed/scenarios.js';
import { PRODUCT_CONTENT } from '../server/seed/products.js';
import { DEMO_STATES } from '../server/engine/geo.js';
import { clone } from '../server/engine/util.js';

const PRODUCTS = ['personal-auto', 'homeowners', 'commercial-property', 'bop'];
const q = (ctx, sc, over = {}) => ctx.quotes.quote(actors.admin, { ...sc, ...over }, { allowPins: true });
const total = async (ctx, sc) => { const r = await q(ctx, sc); assert.equal(r.status, 'QUOTED', `${sc.scenarioId}: ${r.status} ${JSON.stringify(r.validation?.errors?.slice(0, 2) || r.eligibility?.reasons || r.error)}`); return r.premium.total; };

test('every line quotes in every demo state, with reconciling premium components and a trace', async () => {
  const ctx = await makeContext();
  for (const p of PRODUCTS) {
    for (const s of DEMO_STATES) {
      const r = await q(ctx, baselineScenario(p, s));
      assert.equal(r.status, 'QUOTED', `${p}/${s}`);
      assert.ok(r.premium.total > 100 && r.premium.total < 100000, `${p}/${s} total ${r.premium.total}`);
      const cents = r.premium.components.reduce((a, c) => a + Math.round(c.amount * 100), 0) + r.premium.fees.reduce((a, f) => a + Math.round(f.amount * 100), 0) + r.premium.adjustments.reduce((a, f) => a + Math.round(f.amount * 100), 0);
      assert.equal(Math.round(r.premium.total * 100), cents, `${p}/${s} reconciles`);
      assert.ok(r.trace.length > 10 && r.appliedConfig.tables.length > 5);
      assert.equal(r.lineOfBusiness, ctx && { 'personal-auto': 'PERSONAL_AUTO', homeowners: 'HOMEOWNERS', 'commercial-property': 'COMMERCIAL_PROPERTY', bop: 'BOP' }[p]);
      assert.match(r.disclaimer, /not an offer of insurance/i);
    }
  }
});

test('whole scenario sets produce the expected outcome (quote / refer / decline / info-required)', async () => {
  const ctx = await makeContext();
  const seen = new Set();
  for (const p of PRODUCTS) {
    for (const sc of scenarioSet(p, { variationStates: ['AZ', 'FL', 'NY'] })) {
      const r = await q(ctx, sc, { options: { trace: false } });
      assert.equal(r.status, sc.expectStatus, `${sc.scenarioId}: got ${r.status} ${JSON.stringify(r.validation?.errors?.slice(0, 2) || r.eligibility?.reasons?.map((x) => x.code) || r.error)}`);
      seen.add(`${p}:${r.status}`);
      if (r.status !== 'QUOTED') assert.equal(r.premium, undefined, 'no premium is released for non-quoted outcomes');
      if (r.status === 'REFERRED' || r.status === 'DECLINED' || r.status === 'INFO_REQUIRED') assert.ok(r.eligibility.reasons.length >= 1 && r.eligibility.reasons[0].message.length > 10);
    }
  }
  for (const p of PRODUCTS) for (const st of ['QUOTED', 'REFERRED', 'DECLINED', 'INFO_REQUIRED']) assert.ok(seen.has(`${p}:${st}`), `${p} should demonstrate ${st}`);
});

test('journeys are product-specific: the four input schemas are genuinely different', () => {
  const keys = (p) => new Set(PRODUCT_CONTENT[p].sections.flatMap((s) => (s.repeat ? [s.repeat.key, ...s.repeat.fields.map((f) => f.key)] : s.fields.map((f) => f.key))));
  const sectionIds = (p) => PRODUCT_CONTENT[p].sections.map((s) => s.id);
  for (let a = 0; a < PRODUCTS.length; a++) for (let b = a + 1; b < PRODUCTS.length; b++) {
    const A = keys(PRODUCTS[a]); const B = keys(PRODUCTS[b]);
    const inter = [...A].filter((k) => B.has(k)).length;
    assert.ok(inter / new Set([...A, ...B]).size < 0.3, `${PRODUCTS[a]} vs ${PRODUCTS[b]} overlap ${inter}`);
  }
  assert.ok(keys('personal-auto').has('annual_mileage') && keys('personal-auto').has('at_fault_accidents_3yr'));
  assert.ok(keys('homeowners').has('roof_year') && keys('homeowners').has('dwelling_limit') && keys('homeowners').has('water_backup'));
  assert.ok(keys('commercial-property').has('construction_class') && keys('commercial-property').has('business_income_limit') && keys('commercial-property').has('coinsurance'));
  assert.ok(keys('bop').has('annual_revenue') && keys('bop').has('gl_occurrence') && keys('bop').has('prior_claims_3yr'));
  assert.ok(sectionIds('personal-auto').includes('drivers') && sectionIds('personal-auto').includes('vehicles'));
  assert.ok(sectionIds('bop').includes('liability') && sectionIds('commercial-property').includes('values'));
});

test('validation errors are understandable and point at the field', async () => {
  const ctx = await makeContext();
  const pa = baselineScenario('personal-auto', 'FL');
  let r = await q(ctx, { ...pa, risk: { ...pa.risk, garaging_zip: '90210' } });
  assert.equal(r.status, 'INVALID');
  const zip = r.validation.errors.find((e) => e.path === 'risk.garaging_zip');
  assert.equal(zip.code, 'ZIP_STATE'); assert.match(zip.message, /is outside the ZIP ranges used for FL/);
  r = await q(ctx, { ...pa, risk: { ...pa.risk, drivers: [] } });
  assert.match(r.validation.errors.find((e) => e.path === 'risk.drivers').message, /at least 1 driver/i);
  const d = clone(pa.risk); d.drivers[0].birth_date = '2020-01-01'; d.drivers[0].years_licensed = 30;
  r = await q(ctx, { ...pa, risk: d });
  assert.ok(r.validation.errors.some((e) => /at least 15/.test(e.message)));
  const v = clone(pa.risk); v.vehicles[0].year = 2040; v.vehicles[0].primary_driver = 5; delete v.vehicles[0].make;
  r = await q(ctx, { ...pa, risk: v });
  const msgs = r.validation.errors.map((e) => e.message).join(' | ');
  assert.match(msgs, /Vehicle 1: .*make.* required/i); assert.match(msgs, /model year is later/i); assert.match(msgs, /primary driver number/i);
  const ho = baselineScenario('homeowners', 'AZ');
  r = await q(ctx, { ...ho, risk: { ...ho.risk, year_built: 2010, roof_year: 2001 } });
  assert.ok(r.validation.errors.some((e) => /Roof year cannot be earlier/.test(e.message)));
  r = await q(ctx, { ...ho, coverages: { ...ho.coverages, dwelling_limit: 10 } });
  assert.ok(r.validation.errors.some((e) => e.path === 'coverages.dwelling_limit' && /at least 50000/.test(e.message)));
  const cp = baselineScenario('commercial-property', 'IL');
  r = await q(ctx, { ...cp, coverages: { ...cp.coverages, insure_building: false, building_value: 0, bpp_value: 0, stock_value: 0 } });
  assert.ok(r.validation.errors.some((e) => /Enter a value for the building/.test(e.message)));
  const bop = baselineScenario('bop', 'NY');
  r = await q(ctx, { ...bop, risk: { ...bop.risk, prior_claims_3yr: 'one' } });
  assert.ok(r.validation.errors.some((e) => e.path === 'risk.prior_claims_amount' && e.code === 'REQUIRED'));
  r = await q(ctx, { ...bop, state: 'MA', risk: bop.risk });
  assert.equal(r.status, 'INVALID'); assert.equal(r.validation.errors[0].code, 'UNSUPPORTED_STATE');
});

test('hidden (conditional) fields do not influence the price', async () => {
  const ctx = await makeContext();
  const sc = baselineScenario('personal-auto', 'AZ');
  const a = clone(sc); a.risk.vehicles[0].use = 'pleasure'; a.risk.vehicles[0].commute_miles_one_way = 5;
  const b = clone(sc); b.risk.vehicles[0].use = 'pleasure'; delete b.risk.vehicles[0].commute_miles_one_way;
  assert.equal(await total(ctx, a), await total(ctx, b));
  const bop = baselineScenario('bop', 'AZ'); // tenant: owner-only fields are hidden and ignored
  const withOwner = clone(bop); withOwner.coverages.building_limit = 900000; withOwner.risk.roof_year = 2010;
  assert.equal(await total(ctx, withOwner), await total(ctx, bop));
});

test('Personal Auto rating behaves sensibly', async () => {
  const ctx = await makeContext();
  const P = (patch, s = 'AZ') => total(ctx, patchScenario('personal-auto', s, patch));
  const base = await P({});
  assert.ok(await P({ risk: { drivers: [{ birth_date: '2007-03-01', years_licensed: 2 }] } }) > base * 1.5, 'young driver is much costlier');
  assert.ok(await P({ risk: { drivers: [{ at_fault_accidents_3yr: 1 }] } }) > base);
  assert.ok(await P({ coverages: { bi_limit: '500/500' } }) > base);
  assert.ok(await P({ coverages: { bi_limit: '25/50' } }) < base);
  assert.ok(await P({ risk: { vehicles: [{ coll_deductible: '2000', comp_deductible: '1000' }] } }) < base, 'higher deductibles lower premium');
  assert.ok(await P({ coverages: { multi_policy: false, autopay: false, paperless: false, early_shopper: false } }) > base, 'discounts reduce premium');
  assert.ok(await P({}, 'FL') > await P({}, 'NC'), 'FL costs more than NC in the synthetic tables');
  // a second vehicle adds its own components
  const two = await q(ctx, patchScenario('personal-auto', 'AZ', { risk: { vehicles: [{}, { year: 2018, make: 'Synthia', model: 'Second', body_type: 'sedan', value_class: 'standard', ownership: 'owned', use: 'pleasure', annual_mileage: 6000, garaged: 'garage', anti_theft: false, adas: false, primary_driver: 2, comp_deductible: '500', coll_deductible: '500' }] } }));
  assert.ok(two.premium.components.some((c) => c.group === 'Vehicle 2') && two.premium.components.some((c) => c.group === 'Vehicle 1'));
  assert.equal(two.premium.modifiers.filter((m) => m.id === 'm_prior').length, 1, 'policy-level modifier applied once');
  // state-specific behaviour
  const ca = await q(ctx, patchScenario('personal-auto', 'CA', { risk: { drivers: [{ credit_tier: 'poor' }] } }));
  const caGood = await q(ctx, patchScenario('personal-auto', 'CA', { risk: { drivers: [{ credit_tier: 'excellent' }] } }));
  assert.equal(ca.premium.total, caGood.premium.total, 'CA override removes insurance-score rating');
  assert.ok(await P({ risk: { drivers: [{ credit_tier: 'poor' }] } }) > await P({ risk: { drivers: [{ credit_tier: 'excellent' }] } }), 'but AZ uses it');
  const ny = await q(ctx, patchScenario('personal-auto', 'NY', { coverages: { bi_limit: '25/50', pd_limit: '25000', um_limit: 'none', med_limit: 'none', rental: 'none' }, risk: { vehicles: [{ comp_deductible: '1000', coll_deductible: '2000', annual_mileage: 2000, use: 'pleasure', value_class: 'economy', year: 2010, ownership: 'owned' }], drivers: [{ birth_date: '1960-01-01', years_licensed: 40, marital_status: 'married', credit_tier: 'excellent' }] }, coverages2: {} }));
  assert.ok(ny.premium.total >= 650, 'NY minimum premium is 650');
});

test('state-specific eligibility rules', async () => {
  const ctx = await makeContext();
  const codes = (r) => r.eligibility.reasons.map((x) => x.code);
  assert.deepEqual(codes(await q(ctx, patchScenario('homeowners', 'FL', { risk: { distance_to_coast: 'lt1' } }))), ['HO_FL_INFO_HURRICANE_DED']);
  assert.equal((await q(ctx, patchScenario('homeowners', 'FL', { risk: { distance_to_coast: 'lt1' }, coverages: { wind_hail_ded: '2pct' } }))).status, 'QUOTED');
  assert.deepEqual(codes(await q(ctx, patchScenario('homeowners', 'TX', { risk: { year_built: 1995, roof_year: 2005 } }))), ['HO_TX_REF_OLD_ASPHALT']);
  assert.equal((await q(ctx, patchScenario('homeowners', 'WA', { risk: { year_built: 1995, roof_year: 2005 } }))).status, 'QUOTED');
  const u18 = await q(ctx, patchScenario('personal-auto', 'NY', { risk: { drivers: [{ birth_date: '2009-01-01', years_licensed: 1 }] } }));
  assert.ok(codes(u18).includes('PA_NY_REF_UNDER18'));
  const u18az = await q(ctx, patchScenario('personal-auto', 'AZ', { risk: { drivers: [{ birth_date: '2009-01-01', years_licensed: 1 }] } }));
  assert.equal(u18az.status, 'QUOTED');
  assert.deepEqual(codes(await q(ctx, patchScenario('commercial-property', 'FL', { risk: { distance_to_coast: '1to5' } }))), ['CP_FL_INFO_WIND_DED']);
});

test('Homeowners: roof age bands, protection credits and coverage options', async () => {
  const ctx = await makeContext();
  const H = (patch, s = 'AZ') => total(ctx, patchScenario('homeowners', s, patch));
  const ages = [];
  for (const y of [2021, 2014, 2008, 2005]) ages.push(await H({ risk: { roof_year: y } }));
  assert.ok(ages[0] < ages[1] && ages[1] < ages[2] && ages[2] < ages[3], `roof age monotonic ${ages}`);
  const base = await H({});
  assert.ok(await H({ risk: { sprinkler: 'full' } }) < base);
  assert.ok(await H({ coverages: { aop_deductible: '10000' } }) < base);
  assert.ok(await H({ coverages: { water_backup: '25000', equipment_breakdown: true, identity_theft: true } }) > base);
  assert.ok(await H({ risk: { claims_5yr: 2 } }) > base);
  const r = await q(ctx, patchScenario('homeowners', 'AZ', { coverages: { other_structures_pct: '20', personal_property_pct: '70', ordinance_or_law: '50', extended_replacement: '50', water_backup: '10000' } }));
  for (const id of ['c_dwelling', 'c_other_structures', 'c_personal_property', 'c_liability', 'c_ordinance', 'c_ext_rc', 'c_water_backup']) assert.ok(r.premium.components.some((c) => c.id === id), `${id} present`);
  // Coverage A is linear in the dwelling limit within the same factors
  const a1 = (await q(ctx, patchScenario('homeowners', 'AZ', { coverages: { dwelling_limit: 400000 } }))).premium.components.find((c) => c.id === 'c_dwelling').amountBeforeModifiers;
  const a2 = (await q(ctx, patchScenario('homeowners', 'AZ', { coverages: { dwelling_limit: 800000 } }))).premium.components.find((c) => c.id === 'c_dwelling').amountBeforeModifiers;
  assert.ok(Math.abs(a2 / a1 - 2) < 0.001);
});

test('Commercial Property and BOP: line-specific drivers of price', async () => {
  const ctx = await makeContext();
  const C = (patch, s = 'AZ') => total(ctx, patchScenario('commercial-property', s, patch));
  const cb = await C({});
  assert.ok(await C({ risk: { sprinkler: 'none' } }) > cb);
  assert.ok(await C({ risk: { construction_class: 'frame' } }) > cb);
  assert.ok(await C({ coverages: { coinsurance: '100' } }) < cb);
  assert.ok(await C({ coverages: { deductible: '25000' } }) < cb);
  assert.ok(await C({ risk: { occupancy_class: 'restaurant', cooking: 'heavy', hood_suppression: true } }) > cb);
  const B = (patch, s = 'AZ') => total(ctx, patchScenario('bop', s, patch));
  const bb = await B({});
  assert.ok(await B({ risk: { annual_revenue: 1800000 } }) > bb, 'GL scales with revenue');
  assert.ok(await B({ coverages: { cyber: '250000', epli: '500000' } }) > bb);
  assert.ok(await B({ coverages: { gl_occurrence: '2000000' } }) > bb);
  const debit25 = await B({ coverages: { schedule_mod_pct: 25 } }); const debit40 = await B({ coverages: { schedule_mod_pct: 40 } });
  assert.equal(debit25, debit40, 'schedule debit is capped at +25% by the rating plan');
  assert.ok(debit25 > bb);
  const r = await q(ctx, patchScenario('bop', 'AZ', {}));
  assert.ok(r.premium.components.some((c) => c.tags.includes('property')) && r.premium.components.some((c) => c.tags.includes('liability')));
  assert.ok(r.premium.modifiers.some((m) => m.id === 'm_package'));
});
