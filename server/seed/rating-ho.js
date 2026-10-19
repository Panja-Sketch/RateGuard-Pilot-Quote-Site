// Synthetic Homeowners rating content (illustrative only; not filed rates).
import { T, E, S, R } from './helpers.js';
import { DEMO_STATES } from '../engine/geo.js';

const { i, v, p, mul, div, sub, max, eq, gt, gte, lt, inn, iff } = E;
const BASE = { AZ: 4.0, CA: 3.6, FL: 9.5, GA: 5.2, IL: 4.9, NY: 3.8, NC: 4.8, OR: 3.1, TX: 8.2, WA: 3.0 };
const COAST_W = { FL: 1.5, TX: 1.2, NC: 1.0, GA: 0.6, CA: 0.15, OR: 0.15, WA: 0.15, AZ: 0, IL: 0, NY: 0.2 };
const FIRE_W = { CA: 1.0, OR: 0.7, WA: 0.5, AZ: 0.7, TX: 0.3, FL: 0.1, GA: 0.1, IL: 0, NY: 0.05, NC: 0.15 };
const COAST = { gt10: 0, '5to10': 0.05, '1to5': 0.2, lt1: 0.5 };
const WILD = { low: 0, moderate: 0.06, high: 0.18, very_high: 0.4 };
const wb = (min, max) => ({ bounds: { min, max } });

export function hoNational(rev = 1) {
  const k = rev >= 2 ? 1.04 : 1;
  const coastRows = []; const wildRows = [];
  for (const s of DEMO_STATES) {
    for (const [c, x] of Object.entries(COAST)) coastRows.push({ state: s, coast: c, value: Math.round((1 + x * COAST_W[s]) * 1000) / 1000 });
    for (const [c, x] of Object.entries(WILD)) wildRows.push({ state: s, level: c, value: Math.round((1 + x * FIRE_W[s]) * 1000) / 1000 });
  }
  const tables = {
    BASE_RATE: T.byState('Base rate per $1,000 of dwelling limit', (s) => Math.round(BASE[s] * k * 1000) / 1000, 'rate'),
    TERRITORY: T.territory('Territory relativity (state × ZIP3 band)', 'ho', 0.16),
    PPC: T.exact('Public protection class', 'ppc', { 1: 0.85, 2: 0.88, 3: 0.92, 4: 0.96, 5: 1.0, 6: 1.05, 7: 1.12, 8: 1.2, 9: 1.32, 10: 1.5 }),
    CONSTR: T.exact('Construction', 'construction', { frame: 1.12, masonry_veneer: 1.0, masonry: 0.92, fire_resistive: 0.85 }),
    HOME_AGE: T.range('Age of home (years)', 'age', [[0, 10, 0.92], [10, 25, 1.0], [25, 40, 1.06], [40, 60, 1.14], [60, null, 1.25]]),
    ROOF_AGE: T.range('Roof age (years)', 'age', [[0, 11, 1.0], [11, 16, 1.1], [16, 21, 1.2], [21, null, 1.35]]),
    ROOF_TYPE: T.exact('Roof material', 'roof_type', { asphalt_shingle: 1.0, tile: 0.95, metal: 0.9, slate: 0.92, wood_shake: 1.35, flat_membrane: 1.15 }),
    FOUNDATION: T.exact('Foundation', 'foundation', { slab: 0.98, crawlspace: 1.0, basement: 1.03, pier: 1.1 }),
    HOME_TYPE: T.exact('Home type', 'home_type', { single_family: 1.0, townhouse: 0.92, duplex: 1.08 }),
    OCCUPANCY: T.exact('Occupancy', 'occupancy', { owner_occupied: 1.0, secondary: 1.18, tenant_occupied: 1.3, vacant: 2.0 }),
    WIRING: T.exact('Wiring', 'wiring_type', { copper: 1.0, aluminum_branch: 1.12, knob_and_tube: 2.0 }),
    PLUMBING: T.exact('Plumbing', 'plumbing_type', { copper_pex: 1.0, galvanized: 1.08, polybutylene: 1.5 }),
    HEATING: T.exact('Heating', 'heating', { central: 1.0, wood_stove: 1.12, space_heater: 1.15 }),
    BURGLAR_ALARM: T.exact('Burglar alarm credit', 'alarm', { none: 1.0, local: 0.98, central: 0.95 }),
    FIRE_ALARM: T.exact('Fire alarm credit', 'alarm', { none: 1.0, local: 0.98, central: 0.96 }),
    SPRINKLER: T.exact('Sprinkler credit', 'sprinkler', { none: 1.0, partial: 0.96, full: 0.9 }),
    FIRE_DISTANCE: T.range('Distance to fire station (miles)', 'miles', [[0, 1, 0.98], [1, 3, 1.0], [3, 5, 1.05], [5, 10, 1.12], [10, null, 1.25]]),
    AOP_DED: T.exact('All-other-perils deductible', 'deductible', { 1000: 1.0, 2500: 0.91, 5000: 0.82, 10000: 0.72 }),
    WIND_DED: T.exact('Wind/hail deductible option', 'option', { flat: 1.0, '1pct': 0.93, '2pct': 0.88, '5pct': 0.8 }),
    COAST: T.multi('Distance-to-coast load (strength varies by state)', [{ name: 'state', kind: 'exact' }, { name: 'coast', kind: 'exact' }], coastRows),
    WILDFIRE: T.multi('Wildfire exposure load (strength varies by state)', [{ name: 'state', kind: 'exact' }, { name: 'level', kind: 'exact' }], wildRows),
    CLAIMS: T.exact('Claims in last 5 years', 'claims', { 0: 1.0, 1: 1.12, 2: 1.3, 3: 1.6, 4: 2.0, 5: 2.3, 6: 2.6, 7: 2.9, 8: 3.2, 9: 3.5 }),
    CREDIT: T.exact('Insurance score tier (synthetic)', 'tier', { excellent: 0.88, good: 0.96, fair: 1.06, poor: 1.28, unknown: 1.05 }),
    PRIOR: T.exact('Prior insurance', 'prior', { continuous_3plus: 0.95, continuous_lt3: 1.0, lapse: 1.1, none: 1.08 }),
    POOL: T.exact('Pool (liability)', 'pool', { none: 1.0, fenced: 1.06, unfenced: 1.25 }),
    DOG: T.exact('Dogs (liability)', 'dog', { none: 1.0, standard: 1.04, restricted_breed: 1.6 }),
    LIABILITY_PREMIUM: T.exact('Personal liability annual premium', 'limit', { 100000: 62, 300000: 88, 500000: 112 }, 'amount'),
    MEDPAY_PREMIUM: T.exact('Medical payments annual premium', 'limit', { 1000: 0, 2000: 9, 5000: 21 }, 'amount'),
    WATER_BACKUP: T.exact('Water backup annual premium', 'limit', { none: 0, 5000: 48, 10000: 66, 25000: 98 }, 'amount'),
    ORDINANCE_LAW: T.exact('Ordinance or law (share of Coverage A premium)', 'pct', { 10: 0, 25: 0.03, 50: 0.07 }, 'factor', wb(0, 1)),
    EXT_REPLACEMENT: T.exact('Extended replacement cost (share of Coverage A premium)', 'pct', { none: 0, 25: 0.045, 50: 0.08 }, 'factor', wb(0, 1)),
    REPLACEMENT_COST_PSF: T.exact('Estimated rebuild cost per sq ft', 'construction', { frame: 165, masonry_veneer: 175, masonry: 190, fire_resistive: 210 }, 'amount'),
  };
  const params = { policy_fee: 25, other_structures_load: 0.6, personal_property_load: 0.35, hydrant_missing_factor: 1.04, leak_sensor_factor: 0.96, gated_factor: 0.98, equipment_flat: 38, identity_flat: 25, scheduled_rate_per_100: 1.05, bundled_auto_factor: 0.93, paperless_factor: 0.99, autopay_factor: 0.98, claims_free_factor: 0.96, roof_acv_factor: 0.94 };

  const derive = [
    S.set('d_zip3', 'zip3', E.op('floor', div(i('risk.zip'), 100))),
    S.set('d_roof_age', 'roof_age', max(0, sub(i('sys.effectiveYear'), i('risk.roof_year')))),
    S.set('d_home_age', 'home_age', max(0, sub(i('sys.effectiveYear'), i('risk.year_built')))),
    S.lookup('d_psf', 'REPLACEMENT_COST_PSF', { construction: i('risk.construction') }, 'rcv_psf'),
    S.set('d_rcv', 'rcv_estimate', mul(i('risk.square_feet'), v('rcv_psf'))),
  ];
  const rules = [
    R.decline('HO_DECL_VACANT', 'Vacant dwellings are not eligible.', eq(i('risk.occupancy'), 'vacant')),
    R.decline('HO_DECL_KNOB_TUBE', 'Knob-and-tube wiring is not eligible.', eq(i('risk.wiring_type'), 'knob_and_tube')),
    R.decline('HO_DECL_CLAIMS', 'Four or more claims in 5 years are outside this demo appetite.', gte(i('risk.claims_5yr'), 4)),
    R.decline('HO_DECL_OLD_SHAKE', 'Wood-shake roofs over 20 years old are not eligible.', E.and(eq(i('risk.roof_type'), 'wood_shake'), gt(v('roof_age'), 20))),
    R.refer('HO_REF_TENANT', 'Tenant-occupied homes need a landlord / dwelling-fire form; an underwriter will review.', eq(i('risk.occupancy'), 'tenant_occupied')),
    R.refer('HO_REF_OLD_ROOF', 'Roofs over 30 years old require underwriter review.', gt(v('roof_age'), 30)),
    R.refer('HO_REF_HIGH_VALUE', 'Dwelling limits over $1,500,000 require underwriter review.', gt(i('cov.dwelling_limit'), 1500000)),
    R.refer('HO_REF_LARGE_HOME', 'Homes over 8,000 sq ft require underwriter review.', gt(i('risk.square_feet'), 8000)),
    R.refer('HO_REF_POOL_TRAMP', 'An unfenced pool together with a trampoline requires underwriter review.', E.and(eq(i('risk.pool'), 'unfenced'), eq(i('risk.trampoline'), true))),
    R.refer('HO_REF_DOG', 'Restricted dog breeds require underwriter review.', eq(i('risk.dog'), 'restricted_breed')),
    R.refer('HO_REF_FLOOD_V', 'Coastal high-hazard flood zone (V) requires underwriter review.', eq(i('risk.flood_zone'), 'v')),
    R.refer('HO_REF_POLYB', 'Polybutylene plumbing requires underwriter review.', eq(i('risk.plumbing_type'), 'polybutylene')),
    R.refer('HO_REF_PPC10', 'Unprotected locations (class 10) require underwriter review.', eq(i('risk.ppc'), '10')),
    R.info('HO_INFO_LOW_LIMIT', 'The dwelling limit is below 80% of the estimated rebuild cost for this home. Increase Coverage A or confirm the value to continue.', lt(i('cov.dwelling_limit'), mul(0.8, v('rcv_estimate')))),
  ];
  const L = (id, table, keys, out) => S.lookup(id, table, keys, out);
  const plan = [
    L('l_base', 'BASE_RATE', { state: i('risk.state') }, 'base_rate'),
    L('l_terr', 'TERRITORY', { state: i('risk.state'), zip3: v('zip3') }, 'f_terr'),
    L('l_ppc', 'PPC', { ppc: i('risk.ppc') }, 'f_ppc'),
    L('l_constr', 'CONSTR', { construction: i('risk.construction') }, 'f_constr'),
    L('l_home_age', 'HOME_AGE', { age: v('home_age') }, 'f_home_age'),
    L('l_roof_age', 'ROOF_AGE', { age: v('roof_age') }, 'f_roof_age'),
    L('l_roof_type', 'ROOF_TYPE', { roof_type: i('risk.roof_type') }, 'f_roof_type'),
    L('l_found', 'FOUNDATION', { foundation: i('risk.foundation') }, 'f_found'),
    L('l_home_type', 'HOME_TYPE', { home_type: i('risk.home_type') }, 'f_home_type'),
    L('l_occ', 'OCCUPANCY', { occupancy: i('risk.occupancy') }, 'f_occ'),
    L('l_wiring', 'WIRING', { wiring_type: i('risk.wiring_type') }, 'f_wiring'),
    L('l_plumb', 'PLUMBING', { plumbing_type: i('risk.plumbing_type') }, 'f_plumb'),
    L('l_heat', 'HEATING', { heating: i('risk.heating') }, 'f_heat'),
    L('l_burg', 'BURGLAR_ALARM', { alarm: i('risk.burglar_alarm') }, 'f_burg'),
    L('l_fire', 'FIRE_ALARM', { alarm: i('risk.fire_alarm') }, 'f_fire'),
    L('l_sprink', 'SPRINKLER', { sprinkler: i('risk.sprinkler') }, 'f_sprink'),
    L('l_fdist', 'FIRE_DISTANCE', { miles: i('risk.distance_fire_station_mi') }, 'f_fdist'),
    L('l_aop', 'AOP_DED', { deductible: i('cov.aop_deductible') }, 'f_aop'),
    L('l_wind', 'WIND_DED', { option: i('cov.wind_hail_ded') }, 'f_wind'),
    L('l_coast', 'COAST', { state: i('risk.state'), coast: i('risk.distance_to_coast') }, 'f_coast'),
    L('l_wild', 'WILDFIRE', { state: i('risk.state'), level: i('risk.wildfire_risk') }, 'f_wild'),
    L('l_claims', 'CLAIMS', { claims: i('risk.claims_5yr') }, 'f_claims'),
    L('l_credit', 'CREDIT', { tier: i('risk.credit_tier') }, 'f_credit'),
    L('l_prior', 'PRIOR', { prior: i('risk.prior_insurance') }, 'f_prior'),
    L('l_pool', 'POOL', { pool: i('risk.pool') }, 'f_pool'),
    L('l_dog', 'DOG', { dog: i('risk.dog') }, 'f_dog'),
    L('l_liab', 'LIABILITY_PREMIUM', { limit: i('cov.liability_limit') }, 'liab_prem'),
    L('l_med', 'MEDPAY_PREMIUM', { limit: i('cov.med_pay') }, 'med_prem'),
    L('l_wb', 'WATER_BACKUP', { limit: i('cov.water_backup') }, 'wb_prem'),
    L('l_ol', 'ORDINANCE_LAW', { pct: i('cov.ordinance_or_law') }, 'ol_pct'),
    L('l_erc', 'EXT_REPLACEMENT', { pct: i('cov.extended_replacement') }, 'erc_pct'),
    S.set('s_prop_factor', 'prop_factor', mul(v('f_terr'), v('f_ppc'), v('f_constr'), v('f_home_age'), v('f_roof_age'), v('f_roof_type'), v('f_found'), v('f_home_type'), v('f_occ'), v('f_wiring'), v('f_plumb'), v('f_heat'), v('f_burg'), v('f_fire'), v('f_sprink'), v('f_fdist'), iff(eq(i('risk.hydrant_within_1000ft'), true), 1, p('hydrant_missing_factor')), iff(eq(i('risk.water_leak_sensors'), true), p('leak_sensor_factor'), 1), iff(eq(i('risk.gated_community'), true), p('gated_factor'), 1), v('f_aop'), v('f_wind'), v('f_coast'), v('f_wild'), v('f_claims'), v('f_credit'), v('f_prior'))),
    S.set('s_cov_a', 'cov_a_amt', mul(div(i('cov.dwelling_limit'), 1000), v('base_rate'), v('prop_factor'))),
    S.component('c_dwelling', 'Dwelling (Coverage A)', v('cov_a_amt'), ['dwelling', 'property'], { coverage: 'Property' }),
    S.component('c_other_structures', 'Other structures above 10% (Coverage B)', mul(div(mul(i('cov.dwelling_limit'), sub(i('cov.other_structures_pct'), 10), 0.01), 1000), v('base_rate'), v('prop_factor'), p('other_structures_load')), ['property'], { when: gt(i('cov.other_structures_pct'), 10), coverage: 'Property' }),
    S.component('c_personal_property', 'Personal property above 50% (Coverage C)', mul(div(mul(i('cov.dwelling_limit'), sub(i('cov.personal_property_pct'), 50), 0.01), 1000), v('base_rate'), v('prop_factor'), p('personal_property_load')), ['property'], { when: gt(i('cov.personal_property_pct'), 50), coverage: 'Property' }),
    S.component('c_liability', 'Personal liability (Coverage E)', mul(v('liab_prem'), v('f_pool'), v('f_dog'), iff(eq(i('risk.trampoline'), true), 1.1, 1)), ['liability'], { coverage: 'Liability' }),
    S.component('c_medpay', 'Medical payments (Coverage F)', v('med_prem'), ['liability'], { when: gt(v('med_prem'), 0), coverage: 'Liability' }),
    S.component('c_water_backup', 'Water backup', v('wb_prem'), ['endorsement'], { when: gt(v('wb_prem'), 0), coverage: 'Optional' }),
    S.component('c_ordinance', 'Ordinance or law increase', mul(v('cov_a_amt'), v('ol_pct')), ['endorsement'], { when: gt(v('ol_pct'), 0), coverage: 'Optional' }),
    S.component('c_ext_rc', 'Extended replacement cost', mul(v('cov_a_amt'), v('erc_pct')), ['endorsement'], { when: gt(v('erc_pct'), 0), coverage: 'Optional' }),
    S.component('c_equipment', 'Equipment / service line breakdown', p('equipment_flat'), ['endorsement'], { when: eq(i('cov.equipment_breakdown'), true), coverage: 'Optional' }),
    S.component('c_identity', 'Identity theft expense', p('identity_flat'), ['endorsement'], { when: eq(i('cov.identity_theft'), true), coverage: 'Optional' }),
    S.component('c_scheduled', 'Scheduled personal property', mul(div(i('cov.scheduled_property'), 100), p('scheduled_rate_per_100')), ['endorsement'], { when: gt(E.op('coalesce', i('cov.scheduled_property'), 0), 0), coverage: 'Optional' }),
    S.modifier('m_roof_acv', 'Roof ACV settlement credit', p('roof_acv_factor'), { kind: 'discount', appliesTo: ['dwelling'], when: eq(i('cov.roof_acv'), true) }),
    S.modifier('m_claims_free', 'Claims-free discount', p('claims_free_factor'), { kind: 'discount', when: eq(i('risk.claims_5yr'), 0) }),
    S.modifier('m_bundled_auto', 'Auto bundle discount', iff(eq(i('cov.bundled_auto'), true), p('bundled_auto_factor'), 1), { kind: 'discount' }),
    S.modifier('m_autopay', 'Automatic payment discount', iff(eq(i('cov.autopay'), true), p('autopay_factor'), 1), { kind: 'discount' }),
    S.modifier('m_paperless', 'Paperless discount', iff(eq(i('cov.paperless'), true), p('paperless_factor'), 1), { kind: 'discount' }),
    S.fee('fee_policy', 'Policy fee', p('policy_fee')),
  ];
  return {
    params, tables, derive, rules, plan,
    limits: { minPremium: 450, maxPremium: 120000, rounding: { places: 2, mode: 'half_up' }, renewalCap: { maxIncreasePct: 20, maxDecreasePct: 20 } },
    paymentPlans: [
      { id: 'pay_in_full', label: 'Pay in full', payments: 1, downPaymentPct: 100, feePerPayment: 0 },
      { id: 'quarterly', label: 'Quarterly', payments: 4, downPaymentPct: 25, feePerPayment: 3 },
      { id: 'monthly', label: 'Monthly (12 payments)', payments: 12, downPaymentPct: 16.67, feePerPayment: 4 },
    ],
  };
}

export function hoStateOverrides() {
  const wildCA = [];
  for (const [c, x] of Object.entries(WILD)) wildCA.push({ state: 'CA', level: c, value: Math.round((1 + x * 1.3) * 1000) / 1000 });
  return [
    { state: 'FL', seq: 1, effectiveFrom: '2025-01-01', label: 'FL: higher fee, cat-fund surcharge, hurricane-deductible information rule', content: {
      params: { policy_fee: 35 },
      rules: [R.info('HO_FL_INFO_HURRICANE_DED', 'Coastal Florida policies must choose a percentage hurricane/wind deductible.', E.and(inn(i('risk.distance_to_coast'), 'lt1', '1to5'), eq(i('cov.wind_hail_ded'), 'flat')))],
      additionalSteps: [{ after: 'm_autopay', section: 'plan', step: S.modifier('m_fl_cat_fund', 'Catastrophe fund assessment (demo)', 1.035, { kind: 'surcharge', appliesTo: ['dwelling'] }) }],
    } },
    { state: 'CA', seq: 1, effectiveFrom: '2025-01-01', label: 'CA: stronger wildfire loads, very-high wildfire not eligible, higher minimum', content: {
      tables: { WILDFIRE: T.multi('Wildfire exposure load (CA)', [{ name: 'state', kind: 'exact' }, { name: 'level', kind: 'exact' }], DEMO_STATES.flatMap((s) => (s === 'CA' ? wildCA : Object.entries(WILD).map(([c, x]) => ({ state: s, level: c, value: Math.round((1 + x * FIRE_W[s]) * 1000) / 1000 }))))) },
      rules: [R.decline('HO_CA_DECL_WILDFIRE', 'Very-high wildfire exposure is not eligible in California in this demo.', eq(i('risk.wildfire_risk'), 'very_high'))],
      limits: { minPremium: 600 },
    } },
    { state: 'TX', seq: 1, effectiveFrom: '2026-01-01', label: 'TX: percentage wind/hail credits, higher fee, older asphalt roofs referred', content: {
      tables: { WIND_DED: T.exact('Wind/hail deductible option (TX)', 'option', { flat: 1.0, '1pct': 0.9, '2pct': 0.84, '5pct': 0.74 }) },
      params: { policy_fee: 30 },
      rules: [R.refer('HO_TX_REF_OLD_ASPHALT', 'Asphalt roofs 20+ years old require underwriter review in Texas (hail).', E.and(eq(i('risk.roof_type'), 'asphalt_shingle'), gte(v('roof_age'), 20)))],
    } },
    { state: 'NY', seq: 1, effectiveFrom: '2025-01-01', label: 'NY: higher minimum premium', content: { limits: { minPremium: 700 }, params: { policy_fee: 20 } } },
  ];
}
