// Synthetic Personal Auto rating content. All numbers are invented for demonstration;
// they are NOT filed rates and do not reflect any insurer's pricing.
import { T, E, S, R } from './helpers.js';
import { clone } from '../engine/util.js';

const { i, v, p, mul, add, sub, max, eq, ne, gt, gte, lt, inn, iff } = E;
const REL = { // state relativities [liability, physical damage] – illustrative
  AZ: [1.05, 1.0], CA: [1.12, 1.08], FL: [1.38, 1.22], GA: [1.15, 1.04], IL: [0.98, 0.94],
  NY: [1.28, 1.06], NC: [0.78, 0.84], OR: [0.92, 0.95], TX: [1.10, 1.18], WA: [0.96, 0.96],
};
const BASES = { bi: 420, pd: 230, um: 90, med: 48, comp: 190, coll: 400 };
const GROUP = { bi: 0, pd: 0, um: 0, med: 0, comp: 1, coll: 1 };
const bounds = (min, max) => ({ bounds: { min, max } });

export function paNational(rev = 1) {
  const baseScale = rev >= 2 ? 1.035 : 1;
  const tables = {
    BASE_RATE: T.stateMatrix('Annual base rate per vehicle by state and coverage', 'coverage', BASES, (s, g) => REL[s][g] * baseScale, (c) => GROUP[c]),
    TERR_LIAB: T.territory('Liability territory relativity (state × ZIP3 band)', 'pa-liab', 0.13),
    TERR_PHYS: T.territory('Physical-damage territory relativity (state × ZIP3 band)', 'pa-phys', 0.18),
    ILF_BI: T.exact('Bodily injury increased-limit factor', 'limit', { '25/50': 1.0, '50/100': 1.22, '100/300': 1.45, '250/500': 1.78, '500/500': 2.05 }),
    ILF_PD: T.exact('Property damage increased-limit factor', 'limit', { 25000: 1.0, 50000: 1.08, 100000: 1.15, 250000: 1.25 }),
    UM_FACTOR: T.exact('UM/UIM limit factor (0 = rejected)', 'limit', { none: 0, '25/50': 0.9, '50/100': 1.0, '100/300': 1.25 }, 'factor', bounds(0, 5)),
    MED_FACTOR: T.exact('Medical payments limit factor (0 = none)', 'limit', { none: 0, 1000: 0.8, 5000: 1.0, 10000: 1.3 }, 'factor', bounds(0, 5)),
    RENTAL_COST: T.exact('Rental reimbursement annual cost per vehicle', 'level', { none: 0, 30: 26, 40: 34, 50: 41 }, 'amount'),
    DRIVER_AGE: T.range('Driver age relativity', 'age', [[0, 20, 2.1], [20, 25, 1.55], [25, 30, 1.2], [30, 50, 0.97], [50, 65, 0.94], [65, 75, 1.08], [75, null, 1.28]]),
    ACCIDENTS: T.exact('At-fault accidents (3 yrs)', 'count', { 0: 1.0, 1: 1.3, 2: 1.7, 3: 2.2, 4: 2.9, 5: 3.5, 6: 3.9, 7: 4.2, 8: 4.5, 9: 4.8 }),
    MINOR_VIOL: T.exact('Minor violations (3 yrs)', 'count', { 0: 1.0, 1: 1.1, 2: 1.25, 3: 1.45, 4: 1.7, 5: 1.9, 6: 2.1, 7: 2.3, 8: 2.5, 9: 2.7 }),
    MAJOR_VIOL: T.exact('Major violations (3 yrs)', 'count', { 0: 1.0, 1: 1.8, 2: 2.6, 3: 3.4, 4: 4.0, 5: 4.5 }),
    MARITAL: T.exact('Marital status', 'status', { single: 1.04, married: 0.94, divorced: 1.0, widowed: 0.97 }),
    LIC_YEARS: T.range('Years licensed', 'years', [[0, 3, 1.15], [3, 6, 1.06], [6, 10, 1.0], [10, null, 0.96]]),
    CREDIT: T.exact('Insurance score tier (synthetic)', 'tier', { excellent: 0.85, good: 0.95, fair: 1.05, poor: 1.3, unknown: 1.05 }),
    VEH_AGE: T.range('Vehicle age (physical damage)', 'age', [[0, 3, 1.15], [3, 7, 1.0], [7, 12, 0.8], [12, null, 0.6]]),
    BODY_TYPE: T.exact('Body type (liability)', 'body_type', { sedan: 1.0, suv: 1.05, pickup: 1.08, coupe: 1.04, van: 0.98, sports: 1.25 }),
    VALUE_CLASS: T.exact('Value class (physical damage)', 'value_class', { economy: 0.8, standard: 1.0, premium: 1.25, luxury: 1.6, exotic: 2.4 }),
    USE: T.exact('Vehicle use', 'use', { pleasure: 0.92, commute: 1.0, business: 1.15, rideshare: 1.45 }),
    MILEAGE: T.range('Annual mileage', 'miles', [[0, 5000, 0.85], [5000, 10000, 0.92], [10000, 15000, 1.0], [15000, 20000, 1.1], [20000, null, 1.2]]),
    GARAGED: T.exact('Overnight parking (physical damage)', 'garaged', { garage: 0.95, driveway: 1.0, street: 1.1 }),
    COMP_DED: T.exact('Comprehensive deductible factor (0 = not purchased)', 'deductible', { none: 0, 250: 1.15, 500: 1.0, 1000: 0.82 }, 'factor', bounds(0, 5)),
    COLL_DED: T.exact('Collision deductible factor (0 = not purchased)', 'deductible', { none: 0, 250: 1.2, 500: 1.0, 1000: 0.8, 2000: 0.65 }, 'factor', bounds(0, 5)),
    PRIOR_INS: T.exact('Prior insurance', 'prior', { continuous_6plus: 0.92, continuous_lt6: 1.0, lapse_lt30: 1.08, lapse_30plus: 1.2, none: 1.25 }),
  };
  const params = { policy_fee: 18, comp_cat_load: 1.0, anti_theft_factor: 0.95, adas_factor: 0.93, roadside_cost: 14, homeowner_factor: 0.96, multi_policy_factor: 0.93, telematics_factor: rev >= 2 ? 0.88 : 0.9, paid_in_full_factor: 0.95, autopay_factor: 0.98, paperless_factor: 0.99, early_shopper_factor: 0.97, extra_driver_load: 0.04, good_student_factor: 0.9, defensive_driving_factor: 0.95 };

  const zip3 = S.set('d_zip3', 'zip3', E.op('floor', E.op('div', i('risk.garaging_zip'), 100)));
  const derive = [
    zip3,
    S.lookup('d_prior', 'PRIOR_INS', { prior: i('risk.prior_insurance') }, 'f_prior'),
  ];
  const age = E.op('years_between', i('item.birth_date'), i('sys.effectiveDate'));
  const rules = [
    R.decline('PA_DECL_SUSPENDED', 'A driver with a suspended or revoked license cannot be quoted online.', E.agg('any', 'risk.drivers', eq(i('item.license_status'), 'suspended'))),
    R.decline('PA_DECL_MAJOR_VIOL', 'Two or more major violations in 3 years are outside this demo appetite.', E.agg('any', 'risk.drivers', gte(i('item.major_violations_3yr'), 2))),
    R.decline('PA_DECL_ACCIDENTS', 'Four or more at-fault accidents in 3 years are outside this demo appetite.', E.agg('any', 'risk.drivers', gte(i('item.at_fault_accidents_3yr'), 4))),
    R.refer('PA_REF_SR22', 'SR-22 / FR-44 filings require underwriter review.', E.agg('any', 'risk.drivers', eq(i('item.sr22'), true))),
    R.refer('PA_REF_RIDESHARE', 'Rideshare or delivery use requires a commercial endorsement review.', E.agg('any', 'risk.vehicles', eq(i('item.use'), 'rideshare'))),
    R.refer('PA_REF_YOUNG_MAJOR', 'A young driver with a major violation requires underwriter review.', E.agg('any', 'risk.drivers', E.and(gte(i('item.major_violations_3yr'), 1), lt(age, 25)))),
    R.refer('PA_REF_ACC3', 'Three at-fault accidents in 3 years require underwriter review.', E.agg('any', 'risk.drivers', eq(i('item.at_fault_accidents_3yr'), 3))),
    R.refer('PA_REF_PERMIT', 'Learner-permit or foreign-license drivers require underwriter review.', E.agg('any', 'risk.drivers', inn(i('item.license_status'), 'permit', 'foreign'))),
    R.refer('PA_REF_MILEAGE', 'Annual mileage above 30,000 requires underwriter review.', E.agg('any', 'risk.vehicles', gt(i('item.annual_mileage'), 30000))),
    R.refer('PA_REF_EXOTIC', 'Exotic or collector vehicles require underwriter review.', E.agg('any', 'risk.vehicles', eq(i('item.value_class'), 'exotic'))),
    R.refer('PA_REF_MANY_DRIVERS', 'More than four drivers requires underwriter review.', gt(E.op('len', i('risk.drivers')), 4)),
    R.info('PA_INFO_LENDER', 'Financed or leased vehicles require comprehensive and collision coverage. Choose deductibles for those vehicles to continue.', E.agg('any', 'risk.vehicles', E.and(ne(i('item.ownership'), 'owned'), E.or(eq(i('item.comp_deductible'), 'none'), eq(i('item.coll_deductible'), 'none'))))),
  ];

  const L = (id, table, keys, out) => S.lookup(id, table, keys, out);
  const vehicleSteps = [
    S.set('v_age', 'veh_age', max(0, sub(i('sys.effectiveYear'), i('vehicle.year')))),
    S.set('v_drv_age', 'drv_age', E.op('years_between', i('driver.birth_date'), i('sys.effectiveDate'))),
    L('l_drv_age', 'DRIVER_AGE', { age: v('drv_age') }, 'f_drv_age'),
    L('l_acc', 'ACCIDENTS', { count: i('driver.at_fault_accidents_3yr') }, 'f_acc'),
    L('l_minor', 'MINOR_VIOL', { count: i('driver.minor_violations_3yr') }, 'f_minor'),
    L('l_major', 'MAJOR_VIOL', { count: i('driver.major_violations_3yr') }, 'f_major'),
    L('l_marital', 'MARITAL', { status: i('driver.marital_status') }, 'f_marital'),
    L('l_lic', 'LIC_YEARS', { years: i('driver.years_licensed') }, 'f_lic'),
    L('l_credit', 'CREDIT', { tier: i('driver.credit_tier') }, 'f_credit'),
    L('l_vage', 'VEH_AGE', { age: v('veh_age') }, 'f_vage'),
    L('l_body', 'BODY_TYPE', { body_type: i('vehicle.body_type') }, 'f_body'),
    L('l_value', 'VALUE_CLASS', { value_class: i('vehicle.value_class') }, 'f_value'),
    L('l_use', 'USE', { use: i('vehicle.use') }, 'f_use'),
    L('l_miles', 'MILEAGE', { miles: i('vehicle.annual_mileage') }, 'f_miles'),
    L('l_garaged', 'GARAGED', { garaged: i('vehicle.garaged') }, 'f_garaged'),
    L('l_terr_liab', 'TERR_LIAB', { state: i('risk.state'), zip3: v('zip3') }, 't_liab'),
    L('l_terr_phys', 'TERR_PHYS', { state: i('risk.state'), zip3: v('zip3') }, 't_phys'),
    L('l_ilf_bi', 'ILF_BI', { limit: i('cov.bi_limit') }, 'ilf_bi'),
    L('l_ilf_pd', 'ILF_PD', { limit: i('cov.pd_limit') }, 'ilf_pd'),
    L('l_um', 'UM_FACTOR', { limit: i('cov.um_limit') }, 'um_f'),
    L('l_med', 'MED_FACTOR', { limit: i('cov.med_limit') }, 'med_f'),
    L('l_cded', 'COMP_DED', { deductible: i('vehicle.comp_deductible') }, 'comp_ded'),
    L('l_kded', 'COLL_DED', { deductible: i('vehicle.coll_deductible') }, 'coll_ded'),
    L('l_rental', 'RENTAL_COST', { level: i('cov.rental') }, 'rental_cost'),
    ...['bi', 'pd', 'um', 'med', 'comp', 'coll'].map((c) => L(`l_base_${c}`, 'BASE_RATE', { state: i('risk.state'), coverage: c }, `base_${c}`)),
    S.set('s_drv_factor', 'drv_factor', mul(v('f_drv_age'), v('f_acc'), v('f_minor'), v('f_major'), v('f_marital'), v('f_lic'), v('f_credit'))),
    S.component('c_bi', 'Bodily injury liability', mul(v('base_bi'), v('ilf_bi'), v('t_liab'), v('drv_factor'), v('f_body'), v('f_use'), v('f_miles')), ['liability', 'bi'], { coverage: 'Liability' }),
    S.component('c_pd', 'Property damage liability', mul(v('base_pd'), v('ilf_pd'), v('t_liab'), v('drv_factor'), v('f_body'), v('f_use')), ['liability', 'pd'], { coverage: 'Liability' }),
    S.component('c_um', 'Uninsured / underinsured motorist', mul(v('base_um'), v('um_f'), v('t_liab'), v('f_use')), ['liability', 'um'], { when: ne(i('cov.um_limit'), 'none'), coverage: 'Liability' }),
    S.component('c_med', 'Medical payments', mul(v('base_med'), v('med_f')), ['medical'], { when: ne(i('cov.med_limit'), 'none'), coverage: 'Medical' }),
    S.component('c_comp', 'Comprehensive', mul(v('base_comp'), v('f_value'), v('f_vage'), v('comp_ded'), v('t_phys'), v('f_garaged'), p('comp_cat_load'), iff(eq(i('vehicle.anti_theft'), true), p('anti_theft_factor'), 1)), ['physical', 'comp'], { when: ne(i('vehicle.comp_deductible'), 'none'), coverage: 'Physical damage' }),
    S.component('c_coll', 'Collision', mul(v('base_coll'), v('f_value'), v('f_vage'), v('coll_ded'), v('t_phys'), v('drv_factor'), v('f_use'), v('f_miles'), iff(eq(i('vehicle.adas'), true), p('adas_factor'), 1)), ['physical', 'coll'], { when: ne(i('vehicle.coll_deductible'), 'none'), coverage: 'Physical damage' }),
    S.component('c_rental', 'Rental reimbursement', v('rental_cost'), ['optional'], { when: E.and(ne(i('cov.rental'), 'none'), E.or(ne(i('vehicle.comp_deductible'), 'none'), ne(i('vehicle.coll_deductible'), 'none'))), coverage: 'Optional' }),
    S.component('c_roadside', 'Roadside assistance', p('roadside_cost'), ['optional'], { when: eq(i('cov.roadside'), true), coverage: 'Optional' }),
    S.modifier('m_good_student', 'Good student discount', p('good_student_factor'), { kind: 'discount', when: E.and(eq(i('driver.good_student'), true), lt(v('drv_age'), 25)) }),
    S.modifier('m_defensive', 'Defensive driving discount (liability)', p('defensive_driving_factor'), { kind: 'discount', appliesTo: ['liability'], when: eq(i('driver.defensive_driving'), true) }),
  ];

  const plan = [
    S.foreach('f_vehicles', 'risk.vehicles', 'vehicle', 'Vehicle', vehicleSteps, { bind: { driver: E.op('at', i('risk.drivers'), sub(i('vehicle.primary_driver'), 1)) }, bindTypes: { driver: 'risk.drivers' } }),
    S.modifier('m_prior', 'Prior insurance factor', v('f_prior'), { kind: 'factor' }),
    S.modifier('m_extra_drivers', 'Additional drivers beyond vehicles', add(1, mul(p('extra_driver_load'), max(0, sub(E.op('len', i('risk.drivers')), E.op('len', i('risk.vehicles')))))), { kind: 'surcharge' }),
    S.modifier('m_homeowner', 'Homeowner discount', iff(inn(i('risk.residence_type'), 'own_home', 'own_condo'), p('homeowner_factor'), 1), { kind: 'discount' }),
    S.modifier('m_multi_policy', 'Multi-policy discount', iff(eq(i('cov.multi_policy'), true), p('multi_policy_factor'), 1), { kind: 'discount' }),
    S.modifier('m_telematics', 'Usage-based enrollment discount', iff(eq(i('cov.telematics'), true), p('telematics_factor'), 1), { kind: 'discount' }),
    S.modifier('m_paid_in_full', 'Paid-in-full discount', iff(eq(i('cov.paid_in_full'), true), p('paid_in_full_factor'), 1), { kind: 'discount' }),
    S.modifier('m_autopay', 'Automatic payment discount', iff(eq(i('cov.autopay'), true), p('autopay_factor'), 1), { kind: 'discount' }),
    S.modifier('m_paperless', 'Paperless discount', iff(eq(i('cov.paperless'), true), p('paperless_factor'), 1), { kind: 'discount' }),
    S.modifier('m_early', 'Early shopper discount', iff(eq(i('cov.early_shopper'), true), p('early_shopper_factor'), 1), { kind: 'discount' }),
    S.fee('fee_policy', 'Policy fee', p('policy_fee')),
  ];

  return {
    params, tables, derive, rules, plan,
    limits: { minPremium: 350, maxPremium: 40000, rounding: { places: 2, mode: 'half_up' }, renewalCap: { maxIncreasePct: 15, maxDecreasePct: 15 } },
    paymentPlans: [
      { id: 'pay_in_full', label: 'Pay in full', payments: 1, downPaymentPct: 100, feePerPayment: 0 },
      { id: 'two_pay', label: 'Two payments', payments: 2, downPaymentPct: 50, feePerPayment: 3 },
      { id: 'monthly', label: 'Monthly (12 payments)', payments: 12, downPaymentPct: 16.67, feePerPayment: 4 },
    ],
  };
}

const r2 = (x) => Math.round(x * 100) / 100;
const scaleBase = (nat, k) => { const t = clone(nat.tables.BASE_RATE); t.rows.forEach((r) => { r.value = r2(r.value * k); }); return t; };

/** State override blocks: id -> {state, effectiveFrom, label, content} */
export function paStateOverrides(nat2) {
  const noCredit = T.exact('Insurance score not used (state restriction in this demo)', 'tier', { excellent: 1, good: 1, fair: 1, poor: 1, unknown: 1 });
  return [
    { state: 'CA', seq: 1, effectiveFrom: '2025-01-01', label: 'CA: no insurance-score rating, mileage emphasis, low policy fee', content: {
      tables: { CREDIT: noCredit, MILEAGE: T.range('Annual mileage (CA: heavier weight)', 'miles', [[0, 5000, 0.8], [5000, 10000, 0.9], [10000, 15000, 1.0], [15000, 20000, 1.15], [20000, null, 1.3]]) },
      params: { policy_fee: 12 },
    } },
    { state: 'CA', seq: 2, effectiveFrom: '2027-01-01', label: 'CA: scheduled 2027 base-rate revision (+2%)', content: {
      tables: { CREDIT: noCredit, MILEAGE: T.range('Annual mileage (CA: heavier weight)', 'miles', [[0, 5000, 0.8], [5000, 10000, 0.9], [10000, 15000, 1.0], [15000, 20000, 1.15], [20000, null, 1.3]]), BASE_RATE: scaleBase(nat2, 1.02) },
      params: { policy_fee: 12 },
    } },
    { state: 'FL', seq: 1, effectiveFrom: '2025-01-01', label: 'FL: higher policy fee and a guaranty-assessment surcharge', content: {
      params: { policy_fee: 25 },
      additionalSteps: [{ after: 'm_early', section: 'plan', step: S.modifier('m_fl_assessment', 'Guaranty-fund assessment (demo)', 1.009, { kind: 'surcharge' }) }],
    } },
    { state: 'NY', seq: 1, effectiveFrom: '2025-01-01', label: 'NY: higher minimum premium, under-18 referral', content: {
      limits: { minPremium: 650 },
      rules: [R.refer('PA_NY_REF_UNDER18', 'Drivers under 18 require underwriter review in this demo.', E.agg('any', 'risk.drivers', lt(E.op('years_between', i('item.birth_date'), i('sys.effectiveDate')), 18)))],
    } },
    { state: 'TX', seq: 1, effectiveFrom: '2026-01-01', label: 'TX: hail/wind catastrophe load on comprehensive', content: { params: { comp_cat_load: 1.12 } } },
  ];
}
