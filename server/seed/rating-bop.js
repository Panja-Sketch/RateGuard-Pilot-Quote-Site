// Synthetic Business Owners Policy rating content (illustrative only; not filed rates).
import { T, E, S, R } from './helpers.js';
import { DEMO_STATES } from '../engine/geo.js';

const { i, v, p, mul, div, add, sub, max, eq, ne, gt, gte, lt } = E;
const BASE = { AZ: 0.22, CA: 0.2, FL: 0.5, GA: 0.27, IL: 0.25, NY: 0.24, NC: 0.26, OR: 0.19, TX: 0.42, WA: 0.18 };
const GL_STATE = { AZ: 1.0, CA: 1.25, FL: 1.3, GA: 1.05, IL: 1.1, NY: 1.35, NC: 0.9, OR: 0.95, TX: 1.1, WA: 0.98 };
const COAST_W = { FL: 1.5, TX: 1.2, NC: 1.0, GA: 0.6, CA: 0.15, OR: 0.15, WA: 0.15, AZ: 0, IL: 0, NY: 0.2 };
const COAST = { gt10: 0, '5to10': 0.05, '1to5': 0.2, lt1: 0.5 };
const CLASSES = { office_professional: 0.45, retail_apparel: 0.9, retail_gift: 0.85, restaurant_limited: 2.2, salon_barber: 1.1, medical_dental: 0.7, fitness_studio: 1.8, photography: 0.6, it_services: 0.4, auto_repair: 3.0, contractor_interior: 4.5, bar_tavern: 6.0, mobile_food: 3.5 };
const PROP_CLASS = { office_professional: 0.85, retail_apparel: 1.0, retail_gift: 1.0, restaurant_limited: 1.5, salon_barber: 1.0, medical_dental: 0.9, fitness_studio: 0.95, photography: 0.9, it_services: 0.8, auto_repair: 1.4, contractor_interior: 1.2, bar_tavern: 1.6, mobile_food: 1.3 };
const wb = (min, max) => ({ bounds: { min, max } });

export function bopNational(rev = 1) {
  const k = rev >= 2 ? 1.03 : 1;
  const coastRows = [];
  for (const s of DEMO_STATES) for (const [c, x] of Object.entries(COAST)) coastRows.push({ state: s, coast: c, value: Math.round((1 + x * COAST_W[s]) * 1000) / 1000 });
  const tables = {
    PROPERTY_BASE_RATE: T.byState('Base property rate per $100', (s) => Math.round(BASE[s] * k * 10000) / 10000, 'rate'),
    GL_STATE: T.byState('General liability state relativity', (s) => GL_STATE[s]),
    TERRITORY: T.territory('Territory relativity (state × ZIP3 band)', 'bop', 0.12),
    GL_CLASS_RATE: T.exact('General liability rate per $1,000 revenue', 'business_class', Object.fromEntries(Object.entries(CLASSES).map(([c, r]) => [c, Math.round(r * k * 1000) / 1000])), 'rate'),
    PROPERTY_CLASS: T.exact('Property class relativity', 'business_class', PROP_CLASS),
    GL_LIMIT: T.exact('GL each-occurrence limit factor', 'limit', { 500000: 0.88, 1000000: 1.0, 2000000: 1.18 }),
    CONSTRUCTION: T.exact('Construction', 'construction', { frame: 1.3, joisted_masonry: 1.12, noncombustible: 1.0, masonry_noncombustible: 0.9, fire_resistive: 0.78 }),
    BUILDING_AGE: T.range('Building age (years)', 'age', [[0, 10, 0.92], [10, 25, 1.0], [25, 50, 1.1], [50, 80, 1.2], [80, null, 1.3]]),
    ROOF_AGE: T.range('Roof age (years)', 'age', [[0, 11, 1.0], [11, 16, 1.08], [16, 21, 1.18], [21, null, 1.3]]),
    ELECTRICAL_AGE: T.range('Years since electrical update', 'years', [[0, 15, 0.97], [15, 30, 1.0], [30, 45, 1.1], [45, null, 1.25]]),
    PPC: T.exact('Public protection class', 'ppc', { 1: 0.85, 2: 0.88, 3: 0.92, 4: 0.96, 5: 1.0, 6: 1.05, 7: 1.12, 8: 1.2, 9: 1.32, 10: 1.5 }),
    SPRINKLER: T.exact('Sprinkler credit', 'sprinkler', { none: 1.0, partial: 0.9, full: 0.8 }),
    FIRE_ALARM: T.exact('Fire alarm credit', 'alarm', { none: 1.0, local: 0.97, central: 0.93 }),
    BURGLAR_ALARM: T.exact('Burglar alarm credit', 'alarm', { none: 1.0, local: 0.98, central: 0.95 }),
    COAST: T.multi('Distance-to-coast load (strength varies by state)', [{ name: 'state', kind: 'exact' }, { name: 'coast', kind: 'exact' }], coastRows),
    PROPERTY_DEDUCTIBLE: T.exact('Property deductible', 'deductible', { 500: 1.1, 1000: 1.0, 2500: 0.92, 5000: 0.84 }),
    WIND_DED: T.exact('Wind/hail deductible', 'option', { flat: 1.0, '1pct': 0.94, '2pct': 0.88 }),
    BI_LOAD: T.exact('Business income share of property premium', 'months', { none: 0, 6: 0.08, 12: 0.14 }, 'factor', wb(0, 1)),
    EMPLOYEE_SIZE: T.range('Employee-count relativity', 'employees', [[0, 5, 0.9], [5, 15, 1.0], [15, 30, 1.1], [30, null, 1.25]]),
    LOCATIONS: T.exact('Number of locations', 'locations', { 1: 1.0, 2: 1.45, 3: 1.9, 4: 2.35, 5: 2.8, 6: 3.25, 7: 3.7, 8: 4.15, 9: 4.6, 10: 5.0 }),
    YEARS_IN_BUSINESS: T.range('Years in business', 'years', [[0, 2, 1.12], [2, 5, 1.04], [5, null, 0.97]]),
    PRIOR_CLAIMS: T.exact('Prior claims', 'claims', { none: 1.0, one: 1.12, two_plus: 1.35 }),
    MED_EXP: T.exact('Medical expense premium', 'limit', { 5000: 0, 10000: 24 }, 'amount'),
    TENANT_FIRE_LEGAL: T.exact('Damage to rented premises premium', 'limit', { 100000: 0, 300000: 28, 1000000: 85 }, 'amount'),
    CYBER: T.exact('Cyber liability annual premium', 'limit', { none: 0, 50000: 120, 100000: 190, 250000: 340 }, 'amount'),
    EPLI: T.exact('EPLI annual premium', 'limit', { none: 0, 100000: 210, 250000: 360, 500000: 540 }, 'amount'),
    EMPLOYEE_DISHONESTY: T.exact('Employee dishonesty annual premium', 'limit', { none: 0, 10000: 45, 25000: 85, 50000: 140 }, 'amount'),
    REBUILD_COST_PSF: T.exact('Estimated rebuild cost per sq ft', 'construction', { frame: 140, joisted_masonry: 150, noncombustible: 160, masonry_noncombustible: 170, fire_resistive: 200 }, 'amount'),
    HNOA: T.range('Hired & non-owned auto premium by employees', 'employees', [[0, 10, 95], [10, 25, 140], [25, null, 210]], 'amount'),
  };
  const params = { policy_fee: 60, bpp_share: 0.9, equipment_rate_per_100: 0.01, utility_flat: 55, signs_rate_per_100: 1.2, package_credit: 0.95, safeguard_credit: 0.95, subcontractor_rate_per_1000: 1.2, min_gl_premium: 180, schedule_cap_pct: 25 };

  const totalEmp = add(i('risk.full_time_employees'), mul(0.5, i('risk.part_time_employees')));
  const derive = [
    S.set('d_zip3', 'zip3', E.op('floor', div(i('risk.zip'), 100))),
    S.set('d_bldg_age', 'bldg_age', max(0, sub(i('sys.effectiveYear'), i('risk.year_built')))),
    S.set('d_roof_age', 'roof_age', max(0, sub(i('sys.effectiveYear'), E.op('coalesce', i('risk.roof_year'), i('risk.year_built'))))),
    S.set('d_elec_age', 'elec_age', max(0, sub(i('sys.effectiveYear'), i('risk.electrical_update_year')))),
    S.set('d_emp_total', 'employees_fte', totalEmp),
    S.set('d_headcount', 'headcount', add(i('risk.full_time_employees'), i('risk.part_time_employees'))),
    S.lookup('d_psf', 'REBUILD_COST_PSF', { construction: i('risk.construction') }, 'rebuild_psf'),
    S.set('d_rebuild', 'rebuild_estimate', mul(i('risk.square_feet'), v('rebuild_psf'))),
    S.set('d_bldg_limit', 'bldg_limit', E.op('coalesce', i('cov.building_limit'), 0)),
  ];
  const rules = [
    R.decline('BOP_DECL_CLASS', 'This business class is not eligible for the BOP in this demo.', E.op('in', i('risk.business_class'), { list: ['bar_tavern', 'mobile_food'] })),
    R.decline('BOP_DECL_RESTAURANT_HOOD', 'Restaurants need UL-300 hood fire suppression.', E.and(eq(i('risk.business_class'), 'restaurant_limited'), ne(i('risk.hood_suppression'), true))),
    R.refer('BOP_REF_CLASS', 'This business class requires underwriter review.', E.op('in', i('risk.business_class'), { list: ['auto_repair', 'contractor_interior'] })),
    R.refer('BOP_REF_REVENUE', 'Annual revenue over $5,000,000 requires underwriter review.', gt(i('risk.annual_revenue'), 5000000)),
    R.refer('BOP_REF_EMPLOYEES', 'More than 50 employees requires underwriter review.', gt(v('headcount'), 50)),
    R.refer('BOP_REF_LOCATIONS', 'More than 3 locations requires underwriter review.', gt(i('risk.locations_count'), 3)),
    R.refer('BOP_REF_VEHICLES', 'Business-owned vehicles are not covered by a BOP; a commercial auto review is needed.', gt(i('risk.owned_vehicles'), 0)),
    R.refer('BOP_REF_CLAIMS', 'Two or more prior claims require underwriter review.', eq(i('risk.prior_claims_3yr'), 'two_plus')),
    R.refer('BOP_REF_CANCELLED', 'A prior cancellation or non-renewal requires underwriter review.', eq(i('risk.prior_cancellation'), true)),
    R.refer('BOP_REF_FLOOD_V', 'Coastal high-hazard flood zone (V) requires underwriter review.', eq(i('risk.flood_zone'), 'v')),
    R.refer('BOP_REF_HIGH_BUILDING', 'Building limits over $2,500,000 require underwriter review.', gt(v('bldg_limit'), 2500000)),
    R.refer('BOP_REF_TALL_NO_SPRINKLER', 'Buildings of 4+ stories without sprinklers require underwriter review.', E.and(gte(i('risk.stories'), 4), eq(i('risk.sprinkler'), 'none'))),
    R.info('BOP_INFO_MEDICAL_LIMIT', 'Medical and dental offices need at least a $1,000,000 occurrence liability limit.', E.and(eq(i('risk.business_class'), 'medical_dental'), lt(i('cov.gl_occurrence'), 1000000))),
    R.info('BOP_INFO_LOW_BUILDING', 'The building limit is below 70% of the estimated rebuild cost. Increase the limit or confirm to continue.', E.and(eq(i('risk.building_ownership'), 'owner'), lt(v('bldg_limit'), mul(0.7, v('rebuild_estimate'))))),
  ];
  const L = (id, table, keys, out) => S.lookup(id, table, keys, out);
  const plan = [
    L('l_pbase', 'PROPERTY_BASE_RATE', { state: i('risk.state') }, 'prop_base'),
    L('l_glstate', 'GL_STATE', { state: i('risk.state') }, 'f_gl_state'),
    L('l_terr', 'TERRITORY', { state: i('risk.state'), zip3: v('zip3') }, 'f_terr'),
    L('l_glrate', 'GL_CLASS_RATE', { business_class: i('risk.business_class') }, 'gl_rate'),
    L('l_pclass', 'PROPERTY_CLASS', { business_class: i('risk.business_class') }, 'f_pclass'),
    L('l_gllim', 'GL_LIMIT', { limit: i('cov.gl_occurrence') }, 'f_gl_limit'),
    L('l_constr', 'CONSTRUCTION', { construction: i('risk.construction') }, 'f_constr'),
    L('l_bage', 'BUILDING_AGE', { age: v('bldg_age') }, 'f_bage'),
    L('l_roof', 'ROOF_AGE', { age: v('roof_age') }, 'f_roof'),
    L('l_elec', 'ELECTRICAL_AGE', { years: v('elec_age') }, 'f_elec'),
    L('l_ppc', 'PPC', { ppc: i('risk.ppc') }, 'f_ppc'),
    L('l_sprink', 'SPRINKLER', { sprinkler: i('risk.sprinkler') }, 'f_sprink'),
    L('l_fire', 'FIRE_ALARM', { alarm: i('risk.fire_alarm') }, 'f_fire'),
    L('l_burg', 'BURGLAR_ALARM', { alarm: i('risk.burglar_alarm') }, 'f_burg'),
    L('l_coast', 'COAST', { state: i('risk.state'), coast: i('risk.distance_to_coast') }, 'f_coast'),
    L('l_ded', 'PROPERTY_DEDUCTIBLE', { deductible: i('cov.property_deductible') }, 'f_ded'),
    L('l_wind', 'WIND_DED', { option: i('cov.wind_hail_ded') }, 'f_wind'),
    L('l_bi', 'BI_LOAD', { months: i('cov.business_income_months') }, 'bi_load'),
    L('l_emp', 'EMPLOYEE_SIZE', { employees: v('employees_fte') }, 'f_emp'),
    L('l_locs', 'LOCATIONS', { locations: i('risk.locations_count') }, 'f_locs'),
    L('l_ybiz', 'YEARS_IN_BUSINESS', { years: i('risk.years_in_business') }, 'f_ybiz'),
    L('l_claims', 'PRIOR_CLAIMS', { claims: i('risk.prior_claims_3yr') }, 'f_claims'),
    L('l_med', 'MED_EXP', { limit: i('cov.med_exp') }, 'med_prem'),
    L('l_cyber', 'CYBER', { limit: i('cov.cyber') }, 'cyber_prem'),
    L('l_epli', 'EPLI', { limit: i('cov.epli') }, 'epli_prem'),
    L('l_dish', 'EMPLOYEE_DISHONESTY', { limit: i('cov.employee_dishonesty') }, 'dish_prem'),
    L('l_hnoa', 'HNOA', { employees: v('headcount') }, 'hnoa_prem'),
    S.lookup('l_tenant_fire', 'TENANT_FIRE_LEGAL', { limit: i('cov.tenant_fire_legal') }, 'tenant_fire_prem', { when: eq(i('risk.building_ownership'), 'tenant') }),
    S.set('s_prop_rate', 'prop_rate', mul(v('prop_base'), v('f_pclass'), v('f_constr'), v('f_bage'), v('f_roof'), v('f_elec'), v('f_ppc'), v('f_sprink'), v('f_fire'), v('f_burg'), v('f_terr'), v('f_coast'), v('f_ded'), v('f_wind'), v('f_locs'))),
    S.set('s_building_prem', 'building_prem', mul(div(v('bldg_limit'), 100), v('prop_rate'))),
    S.set('s_bpp_prem', 'bpp_prem', mul(div(i('cov.bpp_limit'), 100), v('prop_rate'), p('bpp_share'))),
    S.component('c_building', 'Building', v('building_prem'), ['property'], { when: gt(v('bldg_limit'), 0), coverage: 'Property' }),
    S.component('c_bpp', 'Business personal property', v('bpp_prem'), ['property'], { when: gt(i('cov.bpp_limit'), 0), coverage: 'Property' }),
    S.component('c_bi', 'Business income & extra expense', mul(add(v('building_prem'), v('bpp_prem')), v('bi_load')), ['property'], { when: gt(v('bi_load'), 0), coverage: 'Property' }),
    S.component('c_gl', 'General liability', max(p('min_gl_premium'), add(mul(div(i('risk.annual_revenue'), 1000), v('gl_rate'), v('f_gl_state'), v('f_gl_limit'), v('f_emp'), v('f_locs')), mul(div(E.op('coalesce', i('risk.subcontractor_cost'), 0), 1000), p('subcontractor_rate_per_1000'))), 0), ['liability'], { coverage: 'Liability' }),
    S.component('c_med_exp', 'Medical expense', v('med_prem'), ['liability'], { when: gt(v('med_prem'), 0), coverage: 'Liability' }),
    S.component('c_tenant_fire', 'Damage to rented premises', v('tenant_fire_prem'), ['liability'], { when: E.and(eq(i('risk.building_ownership'), 'tenant'), gt(E.op('coalesce', v('tenant_fire_prem'), 0), 0)), coverage: 'Liability' }),
    S.component('c_hnoa', 'Hired & non-owned auto', v('hnoa_prem'), ['liability'], { when: eq(i('cov.hired_nonowned_auto'), true), coverage: 'Liability' }),
    S.component('c_cyber', 'Cyber liability', v('cyber_prem'), ['optional'], { when: gt(v('cyber_prem'), 0), coverage: 'Optional' }),
    S.component('c_epli', 'Employment practices liability', mul(v('epli_prem'), v('f_emp')), ['optional'], { when: gt(v('epli_prem'), 0), coverage: 'Optional' }),
    S.component('c_dishonesty', 'Employee dishonesty', v('dish_prem'), ['optional'], { when: gt(v('dish_prem'), 0), coverage: 'Optional' }),
    S.component('c_equipment', 'Equipment breakdown', mul(div(add(v('bldg_limit'), i('cov.bpp_limit')), 100), p('equipment_rate_per_100')), ['optional'], { when: eq(i('cov.equipment_breakdown'), true), coverage: 'Optional' }),
    S.component('c_utility', 'Utility services interruption', p('utility_flat'), ['optional'], { when: eq(i('cov.utility_interruption'), true), coverage: 'Optional' }),
    S.component('c_signs', 'Outdoor signs', mul(div(E.op('coalesce', i('cov.signs'), 0), 100), p('signs_rate_per_100')), ['optional'], { when: gt(E.op('coalesce', i('cov.signs'), 0), 0), coverage: 'Optional' }),
    S.modifier('m_safeguards', 'Protective safeguards credit (property)', p('safeguard_credit'), { kind: 'discount', appliesTo: ['property'], when: E.and(eq(i('risk.sprinkler'), 'full'), eq(i('risk.fire_alarm'), 'central')) }),
    S.modifier('m_claims', 'Prior claims factor', v('f_claims'), { kind: 'factor' }),
    S.modifier('m_ybiz', 'Years-in-business factor', v('f_ybiz'), { kind: 'factor' }),
    S.modifier('m_package', 'BOP package credit', p('package_credit'), { kind: 'discount', appliesTo: ['property', 'liability'] }),
    S.modifier('m_schedule', 'Schedule rating (underwriter judgment, capped)', add(1, div(E.op('clamp', E.op('coalesce', i('cov.schedule_mod_pct'), 0), mul(-1, p('schedule_cap_pct')), p('schedule_cap_pct')), 100)), { kind: 'factor' }),
    S.fee('fee_policy', 'Policy fee', p('policy_fee')),
  ];
  return {
    params, tables, derive, rules, plan,
    limits: { minPremium: 500, maxPremium: 400000, rounding: { places: 2, mode: 'half_up' }, renewalCap: { maxIncreasePct: 25, maxDecreasePct: 25 } },
    paymentPlans: [
      { id: 'pay_in_full', label: 'Pay in full', payments: 1, downPaymentPct: 100, feePerPayment: 0 },
      { id: 'quarterly', label: 'Quarterly', payments: 4, downPaymentPct: 25, feePerPayment: 5 },
      { id: 'monthly', label: 'Monthly (10 payments)', payments: 10, downPaymentPct: 20, feePerPayment: 6 },
    ],
  };
}

export function bopStateOverrides() {
  return [
    { state: 'NY', seq: 1, effectiveFrom: '2025-01-01', label: 'NY: higher minimum premium and GL minimum', content: { limits: { minPremium: 800 }, params: { min_gl_premium: 260 } } },
    { state: 'CA', seq: 1, effectiveFrom: '2025-01-01', label: 'CA: lower schedule-rating cap, policy fee', content: { params: { schedule_cap_pct: 15, policy_fee: 50 } } },
    { state: 'FL', seq: 1, effectiveFrom: '2025-01-01', label: 'FL: coastal wind deductible information rule, higher fee', content: {
      params: { policy_fee: 90 },
      rules: [R.info('BOP_FL_INFO_WIND_DED', 'Coastal Florida BOP policies must choose a percentage wind/hail deductible.', E.and(E.op('in', i('risk.distance_to_coast'), { list: ['lt1', '1to5'] }), eq(i('cov.wind_hail_ded'), 'flat')))],
    } },
  ];
}
