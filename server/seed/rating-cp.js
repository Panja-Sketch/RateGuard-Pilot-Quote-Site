// Synthetic Commercial Property rating content (illustrative only; not filed rates).
import { T, E, S, R } from './helpers.js';
import { DEMO_STATES } from '../engine/geo.js';

const { i, v, p, mul, div, add, sub, max, eq, ne, gt, gte, lt, inn, iff } = E;
const BASE = { AZ: 0.28, CA: 0.26, FL: 0.62, GA: 0.34, IL: 0.31, NY: 0.30, NC: 0.32, OR: 0.24, TX: 0.52, WA: 0.22 };
const COAST_W = { FL: 1.5, TX: 1.2, NC: 1.0, GA: 0.6, CA: 0.15, OR: 0.15, WA: 0.15, AZ: 0, IL: 0, NY: 0.2 };
const COAST = { gt10: 0, '5to10': 0.05, '1to5': 0.2, lt1: 0.5 };
const OCC = ['office', 'retail_apparel', 'retail_grocery', 'restaurant', 'warehouse', 'light_mfg', 'salon_spa', 'medical_office', 'auto_repair', 'self_storage', 'mixed_use', 'fitness'];
const mapOcc = (vals) => Object.fromEntries(OCC.map((o, ix) => [o, vals[ix]]));

export function cpNational(rev = 1) {
  const k = rev >= 2 ? 1.03 : 1;
  const coastRows = [];
  for (const s of DEMO_STATES) for (const [c, x] of Object.entries(COAST)) coastRows.push({ state: s, coast: c, value: Math.round((1 + x * COAST_W[s]) * 1000) / 1000 });
  const tables = {
    BASE_RATE: T.byState('Base building rate per $100 of value', (s) => Math.round(BASE[s] * k * 10000) / 10000, 'rate'),
    TERRITORY: T.territory('Territory relativity (state × ZIP3 band)', 'cp', 0.15),
    OCC_BUILDING: T.exact('Occupancy – building', 'occupancy_class', mapOcc([0.85, 1.0, 1.1, 1.55, 1.05, 1.25, 1.0, 0.9, 1.4, 0.8, 1.1, 0.95])),
    OCC_CONTENTS: T.exact('Occupancy – contents/stock/BI', 'occupancy_class', mapOcc([0.9, 1.1, 1.25, 1.7, 1.15, 1.35, 1.0, 0.95, 1.5, 0.85, 1.2, 1.0])),
    CONSTRUCTION: T.exact('Construction class', 'construction_class', { frame: 1.35, joisted_masonry: 1.15, noncombustible: 1.0, masonry_noncombustible: 0.9, modified_fire_resistive: 0.8, fire_resistive: 0.72 }),
    BUILDING_AGE: T.range('Building age (years)', 'age', [[0, 10, 0.9], [10, 25, 1.0], [25, 50, 1.1], [50, 80, 1.2], [80, null, 1.3]]),
    ROOF_AGE: T.range('Roof age (years)', 'age', [[0, 11, 1.0], [11, 16, 1.08], [16, 21, 1.18], [21, null, 1.3]]),
    ROOF_TYPE: T.exact('Roof type', 'roof_type', { asphalt_shingle: 1.0, metal: 0.92, tile: 0.95, flat_membrane: 1.1 }),
    ELECTRICAL_AGE: T.range('Years since electrical update', 'years', [[0, 15, 0.97], [15, 30, 1.0], [30, 45, 1.1], [45, null, 1.25]]),
    PPC: T.exact('Public protection class', 'ppc', { 1: 0.85, 2: 0.88, 3: 0.92, 4: 0.96, 5: 1.0, 6: 1.05, 7: 1.12, 8: 1.2, 9: 1.32, 10: 1.5 }),
    SPRINKLER: T.exact('Sprinkler credit', 'sprinkler', { none: 1.0, partial: 0.88, full: 0.75 }),
    FIRE_ALARM: T.exact('Fire alarm credit', 'alarm', { none: 1.0, local: 0.97, central: 0.93 }),
    BURGLAR_ALARM: T.exact('Burglar alarm credit', 'alarm', { none: 1.0, local: 0.98, central: 0.95 }),
    COOKING: T.exact('Cooking operations', 'cooking', { none: 1.0, light: 1.05, heavy: 1.2 }),
    VACANCY: T.range('Percent vacant', 'pct', [[0, 10, 1.0], [10, 25, 1.12], [25, 60, 1.35], [60, 101, 2.0]]),
    YEARS_IN_BUSINESS: T.range('Years in business', 'years', [[0, 2, 1.1], [2, 5, 1.03], [5, null, 0.97]]),
    CLAIMS: T.exact('Claims in last 5 years', 'claims', { 0: 1.0, 1: 1.15, 2: 1.4, 3: 1.8, 4: 2.2, 5: 2.5, 6: 2.8, 7: 3.1, 8: 3.4, 9: 3.7 }),
    DEDUCTIBLE: T.exact('All-other-perils deductible', 'deductible', { 1000: 1.08, 2500: 1.0, 5000: 0.93, 10000: 0.85, 25000: 0.72 }),
    WIND_DED: T.exact('Wind/hail deductible', 'option', { flat: 1.0, '1pct': 0.94, '2pct': 0.88 }),
    COINSURANCE: T.exact('Coinsurance', 'coinsurance', { 80: 1.0, 90: 0.95, 100: 0.9 }),
    CAUSE_OF_LOSS: T.exact('Causes of loss form', 'cause_of_loss', { basic: 0.8, broad: 0.9, special: 1.0 }),
    VALUATION: T.exact('Valuation', 'valuation', { replacement_cost: 1.0, actual_cash_value: 0.9 }),
    COAST: T.multi('Distance-to-coast load (strength varies by state)', [{ name: 'state', kind: 'exact' }, { name: 'coast', kind: 'exact' }], coastRows),
    REBUILD_COST_PSF: T.exact('Estimated rebuild cost per sq ft', 'construction_class', { frame: 140, joisted_masonry: 150, noncombustible: 160, masonry_noncombustible: 170, modified_fire_resistive: 185, fire_resistive: 200 }, 'amount'),
  };
  const params = { policy_fee: 75, cameras_factor: 0.97, bi_share: 0.55, extra_expense_share: 0.4, stock_load: 1.1, ti_load: 1.0, equipment_rate_per_100: 0.012, ordinance_share: 0.03, utility_flat: 85, spoilage_rate_per_100: 0.9, signs_rate_per_100: 1.4, outdoor_rate_per_100: 1.1 };

  const derive = [
    S.set('d_zip3', 'zip3', E.op('floor', div(i('risk.zip'), 100))),
    S.set('d_bldg_age', 'bldg_age', max(0, sub(i('sys.effectiveYear'), i('risk.year_built')))),
    S.set('d_roof_age', 'roof_age', max(0, sub(i('sys.effectiveYear'), i('risk.roof_year')))),
    S.set('d_elec_age', 'elec_age', max(0, sub(i('sys.effectiveYear'), i('risk.electrical_update_year')))),
    S.lookup('d_psf', 'REBUILD_COST_PSF', { construction_class: i('risk.construction_class') }, 'rebuild_psf'),
    S.set('d_rebuild', 'rebuild_estimate', mul(i('risk.square_feet'), v('rebuild_psf'))),
    S.set('d_bldg', 'bldg_value', E.op('coalesce', i('cov.building_value'), 0)),
    S.set('d_tiv', 'tiv', add(v('bldg_value'), E.op('coalesce', i('cov.bpp_value'), 0), E.op('coalesce', i('cov.stock_value'), 0), E.op('coalesce', i('cov.tenant_improvements'), 0), E.op('coalesce', i('cov.business_income_limit'), 0))),
  ];
  const rules = [
    R.decline('CP_DECL_VACANT', 'Buildings that are 60% or more vacant are not eligible.', gte(i('risk.vacancy_pct'), 60)),
    R.decline('CP_DECL_COOKING', 'Commercial cooking without UL-300 hood suppression is not eligible.', E.and(eq(i('risk.cooking'), 'heavy'), ne(i('risk.hood_suppression'), true))),
    R.decline('CP_DECL_CLAIMS', 'Four or more property claims in 5 years are outside this demo appetite.', gte(i('risk.claims_5yr'), 4)),
    R.refer('CP_REF_TIV', 'Total insured value over $5,000,000 requires underwriter review.', gt(v('tiv'), 5000000)),
    R.refer('CP_REF_BUILDING', 'Building values over $3,000,000 require underwriter review.', gt(v('bldg_value'), 3000000)),
    R.refer('CP_REF_VACANCY', 'Buildings 25–59% vacant require underwriter review.', E.and(gte(i('risk.vacancy_pct'), 25), lt(i('risk.vacancy_pct'), 60))),
    R.refer('CP_REF_SQFT', 'Buildings over 50,000 sq ft require underwriter review.', gt(i('risk.square_feet'), 50000)),
    R.refer('CP_REF_AUTO_REPAIR', 'Auto repair occupancies require underwriter review.', eq(i('risk.occupancy_class'), 'auto_repair')),
    R.refer('CP_REF_FLOOD_V', 'Coastal high-hazard flood zone (V) requires underwriter review.', eq(i('risk.flood_zone'), 'v')),
    R.refer('CP_REF_OLD_ELECTRICAL', 'Older buildings with electrical not updated in 40+ years require review.', E.and(gt(v('bldg_age'), 40), gt(v('elec_age'), 40))),
    R.refer('CP_REF_TALL_NO_SPRINKLER', 'Buildings of 4+ stories without sprinklers require underwriter review.', E.and(gte(i('risk.stories'), 4), eq(i('risk.sprinkler'), 'none'))),
    R.info('CP_INFO_LOW_VALUE', 'The building value is below 70% of the estimated rebuild cost. Increase the value or confirm to continue.', E.and(eq(i('cov.insure_building'), true), lt(v('bldg_value'), mul(0.7, v('rebuild_estimate'))))),
  ];
  const L = (id, table, keys, out) => S.lookup(id, table, keys, out);
  const plan = [
    L('l_base', 'BASE_RATE', { state: i('risk.state') }, 'base_rate'),
    L('l_terr', 'TERRITORY', { state: i('risk.state'), zip3: v('zip3') }, 'f_terr'),
    L('l_occ_b', 'OCC_BUILDING', { occupancy_class: i('risk.occupancy_class') }, 'f_occ_b'),
    L('l_occ_c', 'OCC_CONTENTS', { occupancy_class: i('risk.occupancy_class') }, 'f_occ_c'),
    L('l_constr', 'CONSTRUCTION', { construction_class: i('risk.construction_class') }, 'f_constr'),
    L('l_bage', 'BUILDING_AGE', { age: v('bldg_age') }, 'f_bage'),
    L('l_roof', 'ROOF_AGE', { age: v('roof_age') }, 'f_roof'),
    L('l_roof_t', 'ROOF_TYPE', { roof_type: i('risk.roof_type') }, 'f_roof_t'),
    L('l_elec', 'ELECTRICAL_AGE', { years: v('elec_age') }, 'f_elec'),
    L('l_ppc', 'PPC', { ppc: i('risk.ppc') }, 'f_ppc'),
    L('l_sprink', 'SPRINKLER', { sprinkler: i('risk.sprinkler') }, 'f_sprink'),
    L('l_fire', 'FIRE_ALARM', { alarm: i('risk.fire_alarm') }, 'f_fire'),
    L('l_burg', 'BURGLAR_ALARM', { alarm: i('risk.burglar_alarm') }, 'f_burg'),
    L('l_cook', 'COOKING', { cooking: i('risk.cooking') }, 'f_cook'),
    L('l_vac', 'VACANCY', { pct: i('risk.vacancy_pct') }, 'f_vac'),
    L('l_ybiz', 'YEARS_IN_BUSINESS', { years: i('risk.years_in_business') }, 'f_ybiz'),
    L('l_claims', 'CLAIMS', { claims: i('risk.claims_5yr') }, 'f_claims'),
    L('l_ded', 'DEDUCTIBLE', { deductible: i('cov.deductible') }, 'f_ded'),
    L('l_wind', 'WIND_DED', { option: i('cov.wind_hail_ded') }, 'f_wind'),
    L('l_coins', 'COINSURANCE', { coinsurance: i('cov.coinsurance') }, 'f_coins'),
    L('l_col', 'CAUSE_OF_LOSS', { cause_of_loss: i('cov.cause_of_loss') }, 'f_col'),
    L('l_val', 'VALUATION', { valuation: i('cov.valuation') }, 'f_val'),
    L('l_coast', 'COAST', { state: i('risk.state'), coast: i('risk.distance_to_coast') }, 'f_coast'),
    S.set('s_protection', 'protection', mul(v('f_ppc'), v('f_sprink'), v('f_fire'), v('f_burg'), iff(eq(i('risk.security_cameras'), true), p('cameras_factor'), 1))),
    S.set('s_site', 'site', mul(v('f_terr'), v('f_coast'), v('f_claims'), v('f_vac'), v('f_cook'), v('f_ybiz'))),
    S.set('s_terms', 'terms', mul(v('f_ded'), v('f_wind'), v('f_coins'), v('f_col'), v('f_val'))),
    S.set('s_bldg_factor', 'bldg_factor', mul(v('f_constr'), v('f_bage'), v('f_roof'), v('f_roof_t'), v('f_elec'))),
    S.set('s_bldg_rate', 'bldg_rate', mul(v('base_rate'), v('f_occ_b'), v('bldg_factor'), v('protection'), v('site'), v('terms'))),
    S.set('s_cont_rate', 'cont_rate', mul(v('base_rate'), v('f_occ_c'), v('f_constr'), v('protection'), v('site'), v('terms'))),
    S.component('c_building', 'Building', mul(div(v('bldg_value'), 100), v('bldg_rate')), ['building', 'property'], { when: gt(v('bldg_value'), 0), coverage: 'Property' }),
    S.component('c_bpp', 'Business personal property', mul(div(E.op('coalesce', i('cov.bpp_value'), 0), 100), v('cont_rate')), ['contents', 'property'], { when: gt(E.op('coalesce', i('cov.bpp_value'), 0), 0), coverage: 'Property' }),
    S.component('c_stock', 'Stock / inventory', mul(div(E.op('coalesce', i('cov.stock_value'), 0), 100), v('cont_rate'), p('stock_load')), ['contents', 'property'], { when: gt(E.op('coalesce', i('cov.stock_value'), 0), 0), coverage: 'Property' }),
    S.component('c_tib', 'Tenant improvements & betterments', mul(div(E.op('coalesce', i('cov.tenant_improvements'), 0), 100), v('bldg_rate'), p('ti_load')), ['building', 'property'], { when: gt(E.op('coalesce', i('cov.tenant_improvements'), 0), 0), coverage: 'Property' }),
    S.component('c_bi', 'Business income', mul(div(E.op('coalesce', i('cov.business_income_limit'), 0), 100), v('cont_rate'), p('bi_share')), ['time_element'], { when: gt(E.op('coalesce', i('cov.business_income_limit'), 0), 0), coverage: 'Time element' }),
    S.component('c_extra_expense', 'Extra expense', mul(div(E.op('coalesce', i('cov.extra_expense_limit'), 0), 100), v('cont_rate'), p('extra_expense_share')), ['time_element'], { when: gt(E.op('coalesce', i('cov.extra_expense_limit'), 0), 0), coverage: 'Time element' }),
    S.component('c_equipment', 'Equipment breakdown', mul(div(add(v('bldg_value'), E.op('coalesce', i('cov.bpp_value'), 0)), 100), p('equipment_rate_per_100')), ['optional'], { when: eq(i('cov.equipment_breakdown'), true), coverage: 'Optional' }),
    S.component('c_ordinance', 'Ordinance or law', mul(div(v('bldg_value'), 100), v('bldg_rate'), p('ordinance_share')), ['optional'], { when: E.and(eq(i('cov.ordinance_or_law'), true), gt(v('bldg_value'), 0)), coverage: 'Optional' }),
    S.component('c_utility', 'Utility services – time element', p('utility_flat'), ['optional'], { when: eq(i('cov.utility_services'), true), coverage: 'Optional' }),
    S.component('c_spoilage', 'Spoilage', mul(div(E.op('coalesce', i('cov.spoilage'), 0), 100), p('spoilage_rate_per_100')), ['optional'], { when: gt(E.op('coalesce', i('cov.spoilage'), 0), 0), coverage: 'Optional' }),
    S.component('c_signs', 'Outdoor signs', mul(div(E.op('coalesce', i('cov.signs'), 0), 100), p('signs_rate_per_100')), ['optional'], { when: gt(E.op('coalesce', i('cov.signs'), 0), 0), coverage: 'Optional' }),
    S.component('c_outdoor', 'Outdoor property', mul(div(E.op('coalesce', i('cov.outdoor_property'), 0), 100), p('outdoor_rate_per_100')), ['optional'], { when: gt(E.op('coalesce', i('cov.outdoor_property'), 0), 0), coverage: 'Optional' }),
    S.fee('fee_policy', 'Policy fee', p('policy_fee')),
  ];
  return {
    params, tables, derive, rules, plan,
    limits: { minPremium: 750, maxPremium: 750000, rounding: { places: 2, mode: 'half_up' }, renewalCap: { maxIncreasePct: 25, maxDecreasePct: 25 } },
    paymentPlans: [
      { id: 'pay_in_full', label: 'Pay in full', payments: 1, downPaymentPct: 100, feePerPayment: 0 },
      { id: 'quarterly', label: 'Quarterly', payments: 4, downPaymentPct: 25, feePerPayment: 5 },
    ],
  };
}

export function cpStateOverrides() {
  return [
    { state: 'FL', seq: 1, effectiveFrom: '2025-01-01', label: 'FL: higher fee and minimum, coastal wind deductible information rule, cat-fund surcharge', content: {
      params: { policy_fee: 120 }, limits: { minPremium: 1500 },
      rules: [R.info('CP_FL_INFO_WIND_DED', 'Coastal Florida commercial property must choose a percentage wind/hail deductible.', E.and(inn(i('risk.distance_to_coast'), 'lt1', '1to5'), eq(i('cov.wind_hail_ded'), 'flat')))],
      additionalSteps: [{ after: 'c_outdoor', section: 'plan', step: S.modifier('m_fl_cat_fund', 'Catastrophe fund assessment (demo)', 1.04, { kind: 'surcharge', appliesTo: ['property'] }) }],
    } },
    { state: 'TX', seq: 1, effectiveFrom: '2026-01-01', label: 'TX: hail loads on older roofs; roof 20+ referred', content: {
      tables: { ROOF_AGE: T.range('Roof age (TX hail)', 'age', [[0, 11, 1.0], [11, 16, 1.15], [16, 21, 1.3], [21, null, 1.5]]) },
      rules: [R.refer('CP_TX_REF_OLD_ROOF', 'Roofs 25+ years old require underwriter review in Texas.', gte(v('roof_age'), 25))],
    } },
    { state: 'NY', seq: 1, effectiveFrom: '2025-01-01', label: 'NY: higher minimum premium', content: { limits: { minPremium: 1100 } } },
  ];
}
