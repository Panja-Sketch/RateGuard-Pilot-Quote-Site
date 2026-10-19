// Synthetic baseline risks and scenario sets. Used for config smoke-validation, the pilot's own
// scenario runner (test tooling), seed submissions and tests. All data is invented.
import { DEMO_STATES, STATE_INFO } from '../engine/geo.js';
import { clone } from '../engine/util.js';

export const SCENARIO_EFFECTIVE_DATE = '2026-10-15';

const deepMerge = (base, patch) => {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = clone(v);
  }
  return out;
};

const DRIVER = { first_name: 'Alex', birth_date: '1985-04-12', marital_status: 'married', license_status: 'valid', years_licensed: 20, at_fault_accidents_3yr: 0, minor_violations_3yr: 0, major_violations_3yr: 0, credit_tier: 'good', good_student: false, defensive_driving: false, sr22: false };
const VEHICLE = { year: 2021, make: 'Synthia', model: 'Cruiser', body_type: 'suv', value_class: 'standard', ownership: 'financed', use: 'commute', commute_miles_one_way: 12, annual_mileage: 11000, garaged: 'garage', anti_theft: true, adas: true, primary_driver: 1, comp_deductible: '500', coll_deductible: '500' };

const BASELINES = {
  'personal-auto': (state) => ({
    risk: { garaging_zip: STATE_INFO[state].sampleZip, residence_type: 'own_home', years_at_address: 6, prior_insurance: 'continuous_6plus', drivers: [clone(DRIVER), { ...clone(DRIVER), first_name: 'Sam', birth_date: '1987-09-03' }], vehicles: [clone(VEHICLE)] },
    coverages: { bi_limit: '100/300', pd_limit: '100000', um_limit: '50/100', med_limit: '5000', rental: '30', roadside: false, multi_policy: true, paid_in_full: false, autopay: true, paperless: true, early_shopper: true, telematics: false },
  }),
  homeowners: (state) => ({
    risk: { address_line: '100 Example Way', city: 'Synthville', zip: STATE_INFO[state].sampleZip, home_type: 'single_family', year_built: 2005, square_feet: 2200, stories: 2, construction: 'masonry_veneer', foundation: 'slab', occupancy: 'owner_occupied',
      roof_type: 'asphalt_shingle', roof_year: 2016, wiring_type: 'copper', plumbing_type: 'copper_pex', heating: 'central',
      ppc: '4', distance_fire_station_mi: 2.5, hydrant_within_1000ft: true, burglar_alarm: 'central', fire_alarm: 'local', sprinkler: 'none', water_leak_sensors: true, gated_community: false,
      pool: 'none', trampoline: false, dog: 'none', distance_to_coast: 'gt10', wildfire_risk: 'low', flood_zone: 'x', claims_5yr: 0, prior_insurance: 'continuous_3plus', credit_tier: 'good' },
    coverages: { dwelling_limit: 420000, other_structures_pct: '10', personal_property_pct: '50', liability_limit: '300000', med_pay: '1000', aop_deductible: '2500', wind_hail_ded: 'flat', water_backup: 'none', ordinance_or_law: '10', extended_replacement: 'none', scheduled_property: 0, equipment_breakdown: false, identity_theft: false, roof_acv: false, bundled_auto: true, paperless: true, autopay: true },
  }),
  'commercial-property': (state) => ({
    risk: { business_name: 'Example Office Partners', occupancy_class: 'office', years_in_business: 8, operations: 'Professional offices', address_line: '200 Sample Plaza', city: 'Synthville', zip: STATE_INFO[state].sampleZip, square_feet: 12000,
      year_built: 1998, construction_class: 'masonry_noncombustible', stories: 2, roof_type: 'flat_membrane', roof_year: 2015, electrical_update_year: 2010, vacancy_pct: 0, cooking: 'none',
      ppc: '4', sprinkler: 'full', fire_alarm: 'central', burglar_alarm: 'central', security_cameras: true, distance_to_coast: 'gt10', flood_zone: 'x', claims_5yr: 0, claims_5yr_total: 0 },
    coverages: { insure_building: true, building_value: 2200000, bpp_value: 350000, stock_value: 0, tenant_improvements: 0, business_income_limit: 400000, extra_expense_limit: 100000, valuation: 'replacement_cost', coinsurance: '90', cause_of_loss: 'special', deductible: '5000', wind_hail_ded: 'flat', equipment_breakdown: true, ordinance_or_law: true, utility_services: false, spoilage: 0, signs: 0, outdoor_property: 0 },
  }),
  bop: (state) => ({
    risk: { business_name: 'Example Consulting LLC', business_class: 'office_professional', years_in_business: 6, annual_revenue: 900000, full_time_employees: 8, part_time_employees: 2, subcontractor_cost: 0, owned_vehicles: 0,
      locations_count: 1, address_line: '300 Demo Street', city: 'Synthville', zip: STATE_INFO[state].sampleZip, building_ownership: 'tenant', square_feet: 3200, year_built: 2001, construction: 'masonry_noncombustible', stories: 2, electrical_update_year: 2012,
      ppc: '3', sprinkler: 'full', fire_alarm: 'central', burglar_alarm: 'local', distance_to_coast: 'gt10', flood_zone: 'x', prior_claims_3yr: 'none', prior_cancellation: false },
    coverages: { bpp_limit: 180000, business_income_months: '12', property_deductible: '1000', wind_hail_ded: 'flat', gl_occurrence: '1000000', med_exp: '5000', tenant_fire_legal: '300000', hired_nonowned_auto: false, cyber: '100000', epli: 'none', employee_dishonesty: 'none', equipment_breakdown: false, utility_interruption: false, signs: 0, schedule_mod_pct: 0 },
  }),
};

/** Variation patches applied on top of the baseline: [name, patch, expected status] */
const VARIATIONS = {
  'personal-auto': [
    ['young-driver', { risk: { drivers: [{ birth_date: '2007-03-01', years_licensed: 2, marital_status: 'single', good_student: true }] } }],
    ['senior-driver', { risk: { drivers: [{ birth_date: '1948-06-01', years_licensed: 55 }, { birth_date: '1950-02-02', years_licensed: 55 }] } }],
    ['one-accident', { risk: { drivers: [{ at_fault_accidents_3yr: 1, minor_violations_3yr: 1 }] } }],
    ['major-violation', { risk: { drivers: [{ major_violations_3yr: 1 }] } }],
    ['poor-credit-lapse', { risk: { prior_insurance: 'lapse_30plus', drivers: [{ credit_tier: 'poor' }] } }],
    ['high-mileage-business', { risk: { vehicles: [{ use: 'business', annual_mileage: 24000 }] } }],
    ['luxury-sports', { risk: { vehicles: [{ body_type: 'sports', value_class: 'luxury', year: 2025 }] } }],
    ['old-economy', { risk: { vehicles: [{ body_type: 'sedan', value_class: 'economy', year: 2009, ownership: 'owned', coll_deductible: 'none', comp_deductible: '1000' }] } }],
    ['min-limits', { coverages: { bi_limit: '25/50', pd_limit: '25000', um_limit: 'none', med_limit: 'none', rental: 'none' } }],
    ['max-limits-all-options', { coverages: { bi_limit: '500/500', pd_limit: '250000', um_limit: '100/300', med_limit: '10000', rental: '50', roadside: true } }],
    ['two-vehicles-no-discounts', { risk: { vehicles: [{}, { ...VEHICLE, year: 2017, model: 'Hatch', body_type: 'sedan', ownership: 'owned', primary_driver: 2, use: 'pleasure', annual_mileage: 6000 }] }, coverages: { multi_policy: false, autopay: false, paperless: false, early_shopper: false, telematics: true, paid_in_full: true } }],
    ['REFER-sr22', { risk: { drivers: [{ sr22: true }] } }, 'REFERRED'],
    ['DECLINE-suspended', { risk: { drivers: [{ license_status: 'suspended' }] } }, 'DECLINED'],
    ['INFO-lender-requires-coverage', { risk: { vehicles: [{ coll_deductible: 'none' }] } }, 'INFO_REQUIRED'],
  ],
  homeowners: [
    ['roof-age-5', { risk: { roof_year: 2021 } }],
    ['roof-age-12', { risk: { roof_year: 2014 } }],
    ['roof-age-18', { risk: { roof_year: 2008 } }],
    ['roof-age-21', { risk: { roof_year: 2005 } }],
    ['roof-age-30', { risk: { year_built: 1985, roof_year: 1996 } }],
    ['metal-roof-new', { risk: { roof_type: 'metal', roof_year: 2023 } }],
    ['older-frame-home', { risk: { year_built: 1962, construction: 'frame', roof_year: 2012, foundation: 'crawlspace', plumbing_type: 'galvanized' } }],
    ['claims-and-pool', { risk: { claims_5yr: 2, pool: 'fenced', trampoline: true, credit_tier: 'fair' } }],
    ['high-deductible', { coverages: { aop_deductible: '10000' } }],
    ['full-options', { coverages: { other_structures_pct: '20', personal_property_pct: '70', liability_limit: '500000', med_pay: '5000', water_backup: '25000', ordinance_or_law: '50', extended_replacement: '50', scheduled_property: 15000, equipment_breakdown: true, identity_theft: true, roof_acv: true } }],
    ['coastal-1-5mi', { risk: { distance_to_coast: '1to5' }, coverages: { wind_hail_ded: '2pct' } }],
    ['wildfire-high', { risk: { wildfire_risk: 'high' } }],
    ['REFER-restricted-dog', { risk: { dog: 'restricted_breed' } }, 'REFERRED'],
    ['DECLINE-knob-tube', { risk: { wiring_type: 'knob_and_tube' } }, 'DECLINED'],
    ['INFO-low-dwelling-limit', { coverages: { dwelling_limit: 250000 } }, 'INFO_REQUIRED'],
  ],
  'commercial-property': [
    ['restaurant', { risk: { occupancy_class: 'restaurant', cooking: 'heavy', hood_suppression: true } }],
    ['retail-frame-building', { risk: { occupancy_class: 'retail_apparel', construction_class: 'frame', sprinkler: 'none', fire_alarm: 'local' } }],
    ['warehouse-inventory', { risk: { occupancy_class: 'warehouse', square_feet: 20000 }, coverages: { building_value: 2600000, bpp_value: 200000, stock_value: 900000 } }],
    ['older-building', { risk: { year_built: 1955, roof_year: 2010, electrical_update_year: 2005 } }],
    ['tenant-bpp-only', { coverages: { insure_building: false, building_value: 0, bpp_value: 450000, tenant_improvements: 120000 } }],
    ['high-deductible-100-coins', { coverages: { deductible: '25000', coinsurance: '100' } }],
    ['basic-form-acv', { coverages: { cause_of_loss: 'basic', valuation: 'actual_cash_value' } }],
    ['claims-history', { risk: { claims_5yr: 2, claims_5yr_total: 85000 } }],
    ['all-options', { coverages: { equipment_breakdown: true, ordinance_or_law: true, utility_services: true, spoilage: 25000, signs: 15000, outdoor_property: 20000 } }],
    ['coastal', { risk: { distance_to_coast: '1to5' }, coverages: { wind_hail_ded: '2pct' } }],
    ['REFER-vacancy-30', { risk: { vacancy_pct: 30 } }, 'REFERRED'],
    ['REFER-tiv-over-5m', { coverages: { building_value: 4500000, bpp_value: 800000, business_income_limit: 900000 } }, 'REFERRED'],
    ['DECLINE-cooking-no-hood', { risk: { occupancy_class: 'restaurant', cooking: 'heavy', hood_suppression: false } }, 'DECLINED'],
    ['INFO-low-building-value', { coverages: { building_value: 900000 } }, 'INFO_REQUIRED'],
  ],
  bop: [
    ['retail-owner', { risk: { business_class: 'retail_apparel', building_ownership: 'owner', roof_year: 2014, annual_revenue: 1400000, full_time_employees: 6 }, coverages: { building_limit: 650000, bpp_limit: 220000, tenant_fire_legal: '100000' } }],
    ['restaurant-café', { risk: { business_class: 'restaurant_limited', hood_suppression: true, annual_revenue: 1100000, full_time_employees: 9, part_time_employees: 6 } }],
    ['salon-small', { risk: { business_class: 'salon_barber', annual_revenue: 300000, full_time_employees: 2, part_time_employees: 3 } }],
    ['medical-office', { risk: { business_class: 'medical_dental', annual_revenue: 2200000, full_time_employees: 12 }, coverages: { gl_occurrence: '2000000' } }],
    ['fitness-studio', { risk: { business_class: 'fitness_studio', annual_revenue: 700000, square_feet: 5000 } }],
    ['prior-claim', { risk: { prior_claims_3yr: 'one', prior_claims_amount: 18000 } }],
    ['all-optionals', { coverages: { cyber: '250000', epli: '500000', employee_dishonesty: '50000', hired_nonowned_auto: true, equipment_breakdown: true, utility_interruption: true, signs: 8000 } }],
    ['two-locations', { risk: { locations_count: 2 } }],
    ['subcontractors', { risk: { subcontractor_cost: 120000 } }],
    ['schedule-debit', { coverages: { schedule_mod_pct: 20 } }],
    ['schedule-credit-capped', { coverages: { schedule_mod_pct: -35 } }],
    ['REFER-contractor', { risk: { business_class: 'contractor_interior' } }, 'REFERRED'],
    ['REFER-owned-vehicles', { risk: { owned_vehicles: 2 } }, 'REFERRED'],
    ['DECLINE-bar', { risk: { business_class: 'bar_tavern' } }, 'DECLINED'],
    ['INFO-medical-low-limit', { risk: { business_class: 'medical_dental' }, coverages: { gl_occurrence: '500000' } }, 'INFO_REQUIRED'],
  ],
};

export function baselineScenario(productId, state = 'AZ', overrides = {}) {
  const base = BASELINES[productId](state);
  const merged = deepMerge(base, overrides);
  return { scenarioId: `${productId}:${state}:baseline`, productId, state, transactionType: 'NEW_BUSINESS', effectiveDate: SCENARIO_EFFECTIVE_DATE, risk: merged.risk, coverages: merged.coverages };
}

/** Merge helper where an array patch element merges into the same-index element of the base array. */
function applyPatch(base, patch) {
  const out = clone(base);
  const merge = (target, p) => {
    for (const [k, v] of Object.entries(p)) {
      if (Array.isArray(v) && Array.isArray(target[k])) v.forEach((pv, idx) => {
        if (target[k][idx] && typeof pv === 'object') merge(target[k][idx], pv); else target[k][idx] = clone(pv);
      });
      else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') merge(target[k], v);
      else target[k] = clone(v);
    }
  };
  merge(out, patch);
  return out;
}

/** One baseline per demo state plus product-specific variations in AZ, FL and NY. */
export function scenarioSet(productId, { states = DEMO_STATES, variationStates = ['AZ', 'FL', 'NY'] } = {}) {
  const set = [];
  for (const s of states) set.push(baselineScenario(productId, s));
  for (const s of variationStates) {
    for (const [name, patch, expect] of VARIATIONS[productId]) {
      const base = BASELINES[productId](s);
      const m = applyPatch(base, patch);
      set.push({ scenarioId: `${productId}:${s}:${name}`, productId, state: s, transactionType: 'NEW_BUSINESS', effectiveDate: SCENARIO_EFFECTIVE_DATE, risk: m.risk, coverages: m.coverages, expectStatus: expect || 'QUOTED' });
    }
  }
  for (const sc of set) sc.expectStatus ||= 'QUOTED';
  return set;
}

export const patchScenario = (productId, state, patch) => {
  const m = applyPatch(BASELINES[productId](state), patch);
  return { scenarioId: `${productId}:${state}:custom`, productId, state, transactionType: 'NEW_BUSINESS', effectiveDate: SCENARIO_EFFECTIVE_DATE, risk: m.risk, coverages: m.coverages };
};
export const variationNames = (productId) => VARIATIONS[productId].map(([n]) => n);
