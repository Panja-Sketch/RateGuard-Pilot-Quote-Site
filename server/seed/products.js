// Synthetic product definitions (input schemas that drive both the UI wizard and API validation).
// Illustrative only. Field sets are modelled on the kinds of questions common online quote flows ask;
// they are not copied from, and do not represent, any insurer's product.
import { DEMO_STATES } from '../engine/geo.js';
import { E, F } from './helpers.js';

const { i, eq, ne, gte, lte, gt, or, sub, add } = E;
const ageOf = (path) => E.op('years_between', i(path), i('sys.effectiveDate'));
const COAST = [['gt10', 'More than 10 miles'], ['5to10', '5–10 miles'], ['1to5', '1–5 miles'], ['lt1', 'Under 1 mile']];
const THREE = ['none', 'local', 'central'];
const PPC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [String(n), `Class ${n}${n === 1 ? ' (best)' : n === 10 ? ' (none/worst)' : ''}`]);
const CRED = [['excellent', 'Excellent'], ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['unknown', 'Not available']];
const DED_WIND = [['flat', 'Same as standard deductible'], ['1pct', '1% of limit'], ['2pct', '2% of limit'], ['5pct', '5% of limit']];
const yearNow = 2027;

export const PRODUCTS = [
  { id: 'personal-auto', lob: 'PERSONAL_AUTO', name: 'Personal Auto', tagline: 'Drivers, vehicles, limits and discounts', icon: 'car', referenceStudy: ['Progressive', 'GEICO', 'Allstate'] },
  { id: 'homeowners', lob: 'HOMEOWNERS', name: 'Homeowners (HO-3 style)', tagline: 'Home details, protection, coverages and endorsements', icon: 'home', referenceStudy: ['State Farm', 'Progressive', 'Liberty Mutual'] },
  { id: 'commercial-property', lob: 'COMMERCIAL_PROPERTY', name: 'Commercial Property', tagline: 'Building, contents, income and protection', icon: 'building', referenceStudy: ['Progressive Commercial', 'The Hartford', 'USAA'] },
  { id: 'bop', lob: 'BOP', name: 'Business Owners Policy (BOP)', tagline: 'Property and liability bundled for small business', icon: 'briefcase', referenceStudy: ['Nationwide', 'Chubb', 'Progressive Commercial'] },
];

// ---------------- Personal Auto ----------------
const paContent = {
  states: DEMO_STATES,
  termMonths: 12,
  sections: [
    { id: 'garaging', group: 'risk', title: 'Where is the car kept?', intro: 'Garaging location drives the rating territory.', fields: [
      F.zip('garaging_zip', 'Garaging ZIP code', { help: '5-digit ZIP in the selected state' }),
      F.select('residence_type', 'Residence type', [['own_home', 'Own home'], ['own_condo', 'Own condo / townhome'], ['rent', 'Rent'], ['other', 'Other']]),
      F.int('years_at_address', 'Years at current address', 0, 80),
      F.select('prior_insurance', 'Prior auto insurance', [['continuous_6plus', 'Continuously insured 6+ months'], ['continuous_lt6', 'Continuously insured under 6 months'], ['lapse_lt30', 'Lapse under 30 days'], ['lapse_30plus', 'Lapse 30+ days'], ['none', 'No prior insurance']]),
    ] },
    { id: 'drivers', group: 'risk', title: 'Drivers', intro: 'Add everyone in the household who will drive. Synthetic data only — do not enter real people.',
      repeat: { key: 'drivers', min: 1, max: 6, itemLabel: 'Driver', fields: [
        F.text('first_name', 'First name or nickname', { help: 'Use a made-up name' }),
        F.date('birth_date', 'Date of birth'),
        F.select('marital_status', 'Marital status', [['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed']]),
        F.select('license_status', 'License status', [['valid', 'Valid license'], ['permit', 'Learner permit'], ['foreign', 'Foreign license'], ['suspended', 'Suspended / revoked']]),
        F.int('years_licensed', 'Years licensed', 0, 70),
        F.int('at_fault_accidents_3yr', 'At-fault accidents (last 3 years)', 0, 9),
        F.int('minor_violations_3yr', 'Minor violations (last 3 years)', 0, 9, { help: 'e.g. speeding under 15 mph over' }),
        F.int('major_violations_3yr', 'Major violations (last 3 years)', 0, 5, { help: 'e.g. DUI, reckless driving' }),
        F.select('credit_tier', 'Insurance score tier (synthetic)', CRED),
        F.bool('good_student', 'Good student (B average or better)'),
        F.bool('defensive_driving', 'Completed approved defensive driving course'),
        F.bool('sr22', 'SR-22 / FR-44 filing required'),
      ] },
      checks: [
        { id: 'min_age', field: 'birth_date', check: gte(ageOf('item.birth_date'), 15), message: 'drivers must be at least 15 years old.' },
        { id: 'max_age', field: 'birth_date', check: lte(ageOf('item.birth_date'), 100), message: 'please check the date of birth (age over 100).' },
        { id: 'lic_years', field: 'years_licensed', check: lte(i('item.years_licensed'), sub(ageOf('item.birth_date'), 13)), message: 'years licensed is higher than is possible for this age.' },
      ] },
    { id: 'vehicles', group: 'risk', title: 'Vehicles', intro: 'Add each vehicle to insure. Deductibles are chosen per vehicle.',
      repeat: { key: 'vehicles', min: 1, max: 6, itemLabel: 'Vehicle', fields: [
        F.int('year', 'Model year', 1990, yearNow),
        F.text('make', 'Make', { required: true }),
        F.text('model', 'Model', { required: true }),
        F.select('body_type', 'Body type', [['sedan', 'Sedan / hatchback'], ['suv', 'SUV / crossover'], ['pickup', 'Pickup truck'], ['coupe', 'Coupe'], ['van', 'Minivan / van'], ['sports', 'Sports car']]),
        F.select('value_class', 'Vehicle value class', [['economy', 'Economy'], ['standard', 'Standard'], ['premium', 'Premium'], ['luxury', 'Luxury'], ['exotic', 'Exotic / collector']]),
        F.select('ownership', 'Ownership', [['owned', 'Owned outright'], ['financed', 'Financed'], ['leased', 'Leased']]),
        F.select('use', 'Primary use', [['pleasure', 'Pleasure / errands'], ['commute', 'Commute to work or school'], ['business', 'Business use'], ['rideshare', 'Rideshare / delivery']]),
        F.int('commute_miles_one_way', 'One-way commute miles', 0, 200, { showIf: eq(i('item.use'), 'commute') }),
        F.int('annual_mileage', 'Estimated annual mileage', 500, 60000),
        F.select('garaged', 'Where is it parked overnight?', [['garage', 'Garage'], ['driveway', 'Driveway / carport'], ['street', 'On the street']]),
        F.bool('anti_theft', 'Anti-theft device'),
        F.bool('adas', 'Collision-avoidance / driver-assist features'),
        F.int('primary_driver', 'Primary driver (driver number)', 1, 6, { help: 'Which driver listed above drives this vehicle most?', default: 1, optionsFrom: 'risk.drivers' }),
        F.select('comp_deductible', 'Comprehensive deductible', [['none', 'No comprehensive'], '250', '500', '1000']),
        F.select('coll_deductible', 'Collision deductible', [['none', 'No collision'], '250', '500', '1000', '2000']),
      ] },
      checks: [
        { id: 'veh_year', field: 'year', check: lte(i('item.year'), add(i('sys.effectiveYear'), 1)), message: 'model year is later than the policy effective year.' },
        { id: 'primary_exists', field: 'primary_driver', check: lte(i('item.primary_driver'), E.op('len', i('risk.drivers'))), message: 'primary driver number does not match a listed driver.' },
      ] },
    { id: 'coverage', group: 'coverage', title: 'Coverage limits', intro: 'Choose liability and optional protections. Physical-damage deductibles were chosen per vehicle.', fields: [
      F.select('bi_limit', 'Bodily injury liability (per person / per accident)', ['25/50', '50/100', '100/300', '250/500', '500/500'], { default: '50/100' }),
      F.select('pd_limit', 'Property damage liability', [['25000', '$25,000'], ['50000', '$50,000'], ['100000', '$100,000'], ['250000', '$250,000']], { default: '50000' }),
      F.select('um_limit', 'Uninsured / underinsured motorist', [['none', 'Reject'], '25/50', '50/100', '100/300'], { default: '50/100' }),
      F.select('med_limit', 'Medical payments', [['none', 'None'], ['1000', '$1,000'], ['5000', '$5,000'], ['10000', '$10,000']], { default: 'none' }),
      F.select('rental', 'Rental reimbursement (per day)', [['none', 'None'], ['30', '$30'], ['40', '$40'], ['50', '$50']], { default: 'none' }),
      F.bool('roadside', 'Roadside assistance'),
    ] },
    { id: 'discounts', group: 'coverage', title: 'Discounts', intro: 'Select the discounts that apply. Eligibility is self-declared in this demo.', fields: [
      F.bool('multi_policy', 'Bundle with a home or renters policy'),
      F.bool('paid_in_full', 'Pay in full'),
      F.bool('autopay', 'Automatic payments'),
      F.bool('paperless', 'Paperless documents'),
      F.bool('early_shopper', 'Quoted 7+ days before the policy starts'),
      F.bool('telematics', 'Enroll in usage-based (telematics) program'),
    ] },
  ],
  crossChecks: [],
};

// ---------------- Homeowners ----------------
const hoContent = {
  states: DEMO_STATES,
  termMonths: 12,
  sections: [
    { id: 'property', group: 'risk', title: 'About the home', intro: 'Use a fictional address. Estimated replacement cost is computed from these details.', fields: [
      F.text('address_line', 'Street address', { required: true }),
      F.text('city', 'City', { required: true }),
      F.zip('zip', 'ZIP code'),
      F.select('home_type', 'Home type', [['single_family', 'Single-family'], ['townhouse', 'Townhouse / rowhouse'], ['duplex', 'Duplex (owner-occupied unit)']]),
      F.int('year_built', 'Year built', 1850, yearNow),
      F.int('square_feet', 'Finished square feet', 400, 15000),
      F.int('stories', 'Number of stories', 1, 4),
      F.select('construction', 'Exterior construction', [['frame', 'Frame (wood siding)'], ['masonry_veneer', 'Masonry veneer'], ['masonry', 'Solid masonry'], ['fire_resistive', 'Superior / fire-resistive']]),
      F.select('foundation', 'Foundation', [['slab', 'Slab'], ['crawlspace', 'Crawlspace'], ['basement', 'Basement'], ['pier', 'Pier / post']]),
      F.select('occupancy', 'Occupancy', [['owner_occupied', 'Owner-occupied'], ['secondary', 'Secondary / seasonal'], ['tenant_occupied', 'Rented to tenants'], ['vacant', 'Vacant']]),
    ] },
    { id: 'systems', group: 'risk', title: 'Roof and systems', intro: 'Roof age and building systems are major rating drivers.', fields: [
      F.select('roof_type', 'Roof material', [['asphalt_shingle', 'Asphalt shingle'], ['tile', 'Clay / concrete tile'], ['metal', 'Metal'], ['slate', 'Slate'], ['wood_shake', 'Wood shake'], ['flat_membrane', 'Flat / membrane']]),
      F.int('roof_year', 'Year roof was last replaced', 1950, yearNow, { help: 'Use the year built if never replaced' }),
      F.select('wiring_type', 'Main wiring', [['copper', 'Copper'], ['aluminum_branch', 'Aluminum branch wiring'], ['knob_and_tube', 'Knob-and-tube']]),
      F.select('plumbing_type', 'Plumbing', [['copper_pex', 'Copper / PEX / CPVC'], ['galvanized', 'Galvanized steel'], ['polybutylene', 'Polybutylene']]),
      F.select('heating', 'Primary heating', [['central', 'Central / forced air'], ['wood_stove', 'Wood stove / fireplace insert'], ['space_heater', 'Space heaters']]),
    ] },
    { id: 'protection', group: 'risk', title: 'Protection devices', intro: 'Protective devices can earn credits.', fields: [
      F.select('ppc', 'Public fire protection class', PPC),
      F.num('distance_fire_station_mi', 'Miles to nearest fire station', 0, 25),
      F.bool('hydrant_within_1000ft', 'Fire hydrant within 1,000 feet'),
      F.select('burglar_alarm', 'Burglar alarm', THREE),
      F.select('fire_alarm', 'Fire alarm', THREE),
      F.select('sprinkler', 'Sprinkler system', ['none', 'partial', 'full']),
      F.bool('water_leak_sensors', 'Automatic water-leak shutoff / sensors'),
      F.bool('gated_community', 'Gated community'),
    ] },
    { id: 'hazards', group: 'risk', title: 'Hazards and location', fields: [
      F.select('pool', 'Swimming pool', ['none', 'fenced', 'unfenced']),
      F.bool('trampoline', 'Trampoline on premises'),
      F.select('dog', 'Dogs', ['none', 'standard', ['restricted_breed', 'Restricted breed']]),
      F.select('distance_to_coast', 'Distance to coast', COAST),
      F.select('wildfire_risk', 'Wildfire exposure', ['low', 'moderate', 'high', 'very_high']),
      F.select('flood_zone', 'FEMA flood zone (eligibility only; flood is not covered)', [['x', 'Zone X (minimal)'], ['a', 'Zone A (special hazard)'], ['v', 'Zone V (coastal)']]),
    ] },
    { id: 'history', group: 'risk', title: 'Insurance history', fields: [
      F.int('claims_5yr', 'Claims in the last 5 years', 0, 9),
      F.select('prior_insurance', 'Prior homeowners insurance', [['continuous_3plus', 'Continuous 3+ years'], ['continuous_lt3', 'Continuous under 3 years'], ['lapse', 'Lapse in coverage'], ['none', 'New purchase / none']]),
      F.select('credit_tier', 'Insurance score tier (synthetic)', CRED),
    ] },
    { id: 'coverage', group: 'coverage', title: 'Coverage and deductibles', intro: 'Coverage A (dwelling) is the cost to rebuild, not market value.', fields: [
      F.money('dwelling_limit', 'Dwelling limit (Coverage A)', 50000, 3000000, { help: 'Estimated rebuild cost' }),
      F.select('other_structures_pct', 'Other structures (Coverage B)', [['10', '10% of A'], ['15', '15% of A'], ['20', '20% of A']], { default: '10' }),
      F.select('personal_property_pct', 'Personal property (Coverage C)', [['50', '50% of A'], ['60', '60% of A'], ['70', '70% of A'], ['80', '80% of A']], { default: '50' }),
      F.select('liability_limit', 'Personal liability (Coverage E)', [['100000', '$100,000'], ['300000', '$300,000'], ['500000', '$500,000']], { default: '300000' }),
      F.select('med_pay', 'Medical payments (Coverage F)', [['1000', '$1,000'], ['2000', '$2,000'], ['5000', '$5,000']], { default: '1000' }),
      F.select('aop_deductible', 'All other perils deductible', [['1000', '$1,000'], ['2500', '$2,500'], ['5000', '$5,000'], ['10000', '$10,000']], { default: '1000' }),
      F.select('wind_hail_ded', 'Wind / hail (or hurricane) deductible', DED_WIND, { default: 'flat' }),
    ] },
    { id: 'endorsements', group: 'coverage', title: 'Optional coverages', fields: [
      F.select('water_backup', 'Water backup', [['none', 'None'], ['5000', '$5,000'], ['10000', '$10,000'], ['25000', '$25,000']], { default: 'none' }),
      F.select('ordinance_or_law', 'Ordinance or law', [['10', '10% (included)'], ['25', '25%'], ['50', '50%']], { default: '10' }),
      F.select('extended_replacement', 'Extended replacement cost', [['none', 'None'], ['25', '25%'], ['50', '50%']], { default: 'none' }),
      F.money('scheduled_property', 'Scheduled personal property total', 0, 100000, { required: false, default: 0 }),
      F.bool('equipment_breakdown', 'Equipment / service line breakdown'),
      F.bool('identity_theft', 'Identity theft expense'),
      F.bool('roof_acv', 'Roof surfaces settled at actual cash value (credit)'),
    ] },
    { id: 'discounts', group: 'coverage', title: 'Discounts', fields: [
      F.bool('bundled_auto', 'Bundle with an auto policy'),
      F.bool('paperless', 'Paperless documents'),
      F.bool('autopay', 'Automatic payments'),
    ] },
  ],
  crossChecks: [
    { id: 'roof_after_built', path: 'risk.roof_year', check: gte(i('risk.roof_year'), i('risk.year_built')), message: 'Roof year cannot be earlier than the year built.' },
  ],
};

// ---------------- Commercial Property ----------------
const OCC_CP = [['office', 'Office – general'], ['retail_apparel', 'Retail – apparel / gifts'], ['retail_grocery', 'Grocery / convenience'], ['restaurant', 'Restaurant – full service'], ['warehouse', 'Warehouse – dry goods'], ['light_mfg', 'Light manufacturing'], ['salon_spa', 'Salon / spa'], ['medical_office', 'Medical / dental office'], ['auto_repair', 'Auto repair shop'], ['self_storage', 'Self-storage'], ['mixed_use', 'Mixed use (retail + apartments)'], ['fitness', 'Fitness / studio']];
const cpContent = {
  states: DEMO_STATES,
  termMonths: 12,
  sections: [
    { id: 'business', group: 'risk', title: 'Business information', intro: 'Use a fictional business. Occupancy class drives base rates.', fields: [
      F.text('business_name', 'Business name', { required: true }),
      F.select('occupancy_class', 'Occupancy / use', OCC_CP),
      F.int('years_in_business', 'Years in business', 0, 150),
      F.text('operations', 'Brief description of operations', { maxLength: 200 }),
    ] },
    { id: 'location', group: 'risk', title: 'Insured location', fields: [
      F.text('address_line', 'Street address', { required: true }),
      F.text('city', 'City', { required: true }),
      F.zip('zip', 'ZIP code'),
      F.int('square_feet', 'Total building square feet', 200, 500000),
    ] },
    { id: 'building', group: 'risk', title: 'Building characteristics', fields: [
      F.int('year_built', 'Year built', 1850, yearNow),
      F.select('construction_class', 'Construction class', [['frame', 'Frame'], ['joisted_masonry', 'Joisted masonry'], ['noncombustible', 'Non-combustible'], ['masonry_noncombustible', 'Masonry non-combustible'], ['modified_fire_resistive', 'Modified fire resistive'], ['fire_resistive', 'Fire resistive']]),
      F.int('stories', 'Number of stories', 1, 30),
      F.select('roof_type', 'Roof type', [['asphalt_shingle', 'Asphalt shingle'], ['metal', 'Metal'], ['tile', 'Tile'], ['flat_membrane', 'Flat / membrane (built-up)']]),
      F.int('roof_year', 'Year roof last replaced', 1950, yearNow),
      F.int('electrical_update_year', 'Year electrical was last updated', 1950, yearNow),
      F.int('vacancy_pct', 'Percent of building vacant', 0, 100, { default: 0 }),
      F.select('cooking', 'Cooking operations', [['none', 'None'], ['light', 'Light (microwave, toaster)'], ['heavy', 'Commercial cooking (fryers, grills)']]),
      F.bool('hood_suppression', 'UL-300 hood / duct fire suppression', { showIf: eq(i('risk.cooking'), 'heavy') }),
    ] },
    { id: 'protection', group: 'risk', title: 'Protection and exposure', fields: [
      F.select('ppc', 'Public fire protection class', PPC),
      F.select('sprinkler', 'Automatic sprinklers', ['none', 'partial', 'full']),
      F.select('fire_alarm', 'Fire alarm', THREE),
      F.select('burglar_alarm', 'Burglar alarm', THREE),
      F.bool('security_cameras', 'Security cameras'),
      F.select('distance_to_coast', 'Distance to coast', COAST),
      F.select('flood_zone', 'FEMA flood zone (eligibility only)', [['x', 'Zone X'], ['a', 'Zone A'], ['v', 'Zone V']]),
    ] },
    { id: 'claims', group: 'risk', title: 'Loss history', fields: [
      F.int('claims_5yr', 'Property claims in last 5 years', 0, 9),
      F.money('claims_5yr_total', 'Total incurred (last 5 years)', 0, 50000000, { default: 0, required: false }),
    ] },
    { id: 'values', group: 'coverage', title: 'Values to insure', intro: 'Enter replacement cost values. Coinsurance penalties apply if values are understated.', fields: [
      F.bool('insure_building', 'Insure the building (owner, or lease requires it)', { default: true }),
      F.money('building_value', 'Building value', 0, 30000000, { requiredIf: eq(i('cov.insure_building'), true), default: 0, showIf: eq(i('cov.insure_building'), true) }),
      F.money('bpp_value', 'Business personal property (furniture, equipment)', 0, 30000000, { default: 0 }),
      F.money('stock_value', 'Stock / inventory', 0, 30000000, { default: 0, required: false }),
      F.money('tenant_improvements', 'Tenant improvements & betterments', 0, 10000000, { default: 0, required: false }),
      F.money('business_income_limit', 'Business income (12-month gross earnings)', 0, 30000000, { default: 0, required: false }),
      F.money('extra_expense_limit', 'Extra expense limit', 0, 10000000, { default: 0, required: false }),
      F.select('valuation', 'Valuation basis', [['replacement_cost', 'Replacement cost'], ['actual_cash_value', 'Actual cash value']], { default: 'replacement_cost' }),
      F.select('coinsurance', 'Coinsurance', [['80', '80%'], ['90', '90%'], ['100', '100%']], { default: '80' }),
      F.select('cause_of_loss', 'Causes of loss form', [['basic', 'Basic'], ['broad', 'Broad'], ['special', 'Special (open perils)']], { default: 'special' }),
    ] },
    { id: 'deductibles', group: 'coverage', title: 'Deductibles', fields: [
      F.select('deductible', 'All other perils deductible', [['1000', '$1,000'], ['2500', '$2,500'], ['5000', '$5,000'], ['10000', '$10,000'], ['25000', '$25,000']], { default: '2500' }),
      F.select('wind_hail_ded', 'Wind / hail deductible', DED_WIND.slice(0, 3), { default: 'flat' }),
    ] },
    { id: 'options', group: 'coverage', title: 'Optional coverages', fields: [
      F.bool('equipment_breakdown', 'Equipment breakdown'),
      F.bool('ordinance_or_law', 'Ordinance or law (increased cost of construction)'),
      F.bool('utility_services', 'Utility services – time element'),
      F.money('spoilage', 'Spoilage (refrigerated stock) limit', 0, 500000, { default: 0, required: false }),
      F.money('signs', 'Outdoor signs limit', 0, 500000, { default: 0, required: false }),
      F.money('outdoor_property', 'Outdoor property limit', 0, 500000, { default: 0, required: false }),
    ] },
  ],
  crossChecks: [
    { id: 'some_value', path: 'coverages.bpp_value', check: gt(add(E.op('coalesce', i('cov.building_value'), 0), E.op('coalesce', i('cov.bpp_value'), 0), E.op('coalesce', i('cov.stock_value'), 0)), 0), message: 'Enter a value for the building, business personal property or stock.' },
    { id: 'roof_after_built', path: 'risk.roof_year', check: gte(i('risk.roof_year'), i('risk.year_built')), message: 'Roof year cannot be earlier than the year built.' },
  ],
};

// ---------------- BOP ----------------
const BOP_CLASSES = [['office_professional', 'Professional office (consulting, accounting)'], ['retail_apparel', 'Retail – apparel / accessories'], ['retail_gift', 'Retail – gifts / florist'], ['restaurant_limited', 'Restaurant – limited cooking / café'], ['salon_barber', 'Salon / barber shop'], ['medical_dental', 'Medical / dental office'], ['fitness_studio', 'Fitness / yoga studio'], ['photography', 'Photography studio'], ['it_services', 'IT / software services'], ['auto_repair', 'Auto repair'], ['contractor_interior', 'Interior contractor'], ['bar_tavern', 'Bar / tavern'], ['mobile_food', 'Mobile food vendor']];
const bopContent = {
  states: DEMO_STATES,
  termMonths: 12,
  sections: [
    { id: 'business', group: 'risk', title: 'Your business', intro: 'Business class and size drive the liability rate. Use fictional data.', fields: [
      F.text('business_name', 'Business name', { required: true }),
      F.select('business_class', 'Business type / class', BOP_CLASSES),
      F.int('years_in_business', 'Years in business', 0, 150),
      F.money('annual_revenue', 'Annual gross sales / revenue', 0, 100000000),
      F.int('full_time_employees', 'Full-time employees', 0, 500),
      F.int('part_time_employees', 'Part-time employees', 0, 500),
      F.money('subcontractor_cost', 'Annual subcontractor cost', 0, 50000000, { default: 0, required: false }),
      F.int('owned_vehicles', 'Business-owned vehicles', 0, 50, { default: 0 }),
      F.bool('hood_suppression', 'UL-300 hood fire suppression', { showIf: eq(i('risk.business_class'), 'restaurant_limited') }),
    ] },
    { id: 'location', group: 'risk', title: 'Location and building', fields: [
      F.int('locations_count', 'Number of locations', 1, 10, { default: 1 }),
      F.text('address_line', 'Primary location address', { required: true }),
      F.text('city', 'City', { required: true }),
      F.zip('zip', 'ZIP code'),
      F.select('building_ownership', 'Do you own or lease?', [['owner', 'Own the building'], ['tenant', 'Lease the space']]),
      F.int('square_feet', 'Square feet occupied', 100, 200000),
      F.int('year_built', 'Year built', 1850, yearNow),
      F.select('construction', 'Construction', [['frame', 'Frame'], ['joisted_masonry', 'Joisted masonry'], ['noncombustible', 'Non-combustible'], ['masonry_noncombustible', 'Masonry non-combustible'], ['fire_resistive', 'Fire resistive']]),
      F.int('stories', 'Stories', 1, 30),
      F.int('roof_year', 'Year roof last replaced', 1950, yearNow, { showIf: eq(i('risk.building_ownership'), 'owner'), requiredIf: eq(i('risk.building_ownership'), 'owner') , required: false }),
      F.int('electrical_update_year', 'Year electrical last updated', 1950, yearNow),
      F.select('ppc', 'Public fire protection class', PPC),
      F.select('sprinkler', 'Sprinklers', ['none', 'partial', 'full']),
      F.select('fire_alarm', 'Fire alarm', THREE),
      F.select('burglar_alarm', 'Burglar alarm', THREE),
      F.select('distance_to_coast', 'Distance to coast', COAST),
      F.select('flood_zone', 'FEMA flood zone (eligibility only)', [['x', 'Zone X'], ['a', 'Zone A'], ['v', 'Zone V']]),
    ] },
    { id: 'history', group: 'risk', title: 'Loss history', fields: [
      F.select('prior_claims_3yr', 'Claims in the last 3 years', [['none', 'None'], ['one', 'One'], ['two_plus', 'Two or more']]),
      F.money('prior_claims_amount', 'Total paid on prior claims', 0, 50000000, { showIf: ne(i('risk.prior_claims_3yr'), 'none'), requiredIf: ne(i('risk.prior_claims_3yr'), 'none'), required: false }),
      F.bool('prior_cancellation', 'Coverage cancelled or non-renewed in the last 3 years'),
    ] },
    { id: 'property', group: 'coverage', title: 'Property coverage', intro: 'Business income coverage is bundled in the BOP form.', fields: [
      F.money('building_limit', 'Building limit', 0, 20000000, { showIf: eq(i('risk.building_ownership'), 'owner'), requiredIf: eq(i('risk.building_ownership'), 'owner'), required: false, default: 0 }),
      F.money('bpp_limit', 'Business personal property limit', 0, 20000000),
      F.select('business_income_months', 'Business income', [['none', 'Excluded'], ['6', '6 months'], ['12', '12 months']], { default: '12' }),
      F.select('property_deductible', 'Property deductible', [['500', '$500'], ['1000', '$1,000'], ['2500', '$2,500'], ['5000', '$5,000']], { default: '1000' }),
      F.select('wind_hail_ded', 'Wind / hail deductible', DED_WIND.slice(0, 3), { default: 'flat' }),
    ] },
    { id: 'liability', group: 'coverage', title: 'Liability coverage', fields: [
      F.select('gl_occurrence', 'General liability – each occurrence', [['500000', '$500,000'], ['1000000', '$1,000,000'], ['2000000', '$2,000,000']], { default: '1000000' }),
      F.select('med_exp', 'Medical expense', [['5000', '$5,000'], ['10000', '$10,000']], { default: '5000' }),
      F.select('tenant_fire_legal', 'Damage to premises rented to you', [['100000', '$100,000'], ['300000', '$300,000'], ['1000000', '$1,000,000']], { default: '300000', showIf: eq(i('risk.building_ownership'), 'tenant') }),
      F.bool('hired_nonowned_auto', 'Hired & non-owned auto liability'),
    ] },
    { id: 'optional', group: 'coverage', title: 'Optional coverages', fields: [
      F.select('cyber', 'Cyber liability / data breach', [['none', 'None'], ['50000', '$50,000'], ['100000', '$100,000'], ['250000', '$250,000']], { default: 'none' }),
      F.select('epli', 'Employment practices liability', [['none', 'None'], ['100000', '$100,000'], ['250000', '$250,000'], ['500000', '$500,000']], { default: 'none' }),
      F.select('employee_dishonesty', 'Employee dishonesty', [['none', 'None'], ['10000', '$10,000'], ['25000', '$25,000'], ['50000', '$50,000']], { default: 'none' }),
      F.bool('equipment_breakdown', 'Equipment breakdown'),
      F.bool('utility_interruption', 'Utility services interruption'),
      F.money('signs', 'Outdoor signs limit', 0, 100000, { default: 0, required: false }),
    ] },
    { id: 'uw', group: 'coverage', title: 'Schedule rating (demo underwriter field)', intro: 'Underwriters can apply a discretionary schedule credit/debit. In the demo anyone can; the rating plan caps it.', fields: [
      F.int('schedule_mod_pct', 'Schedule debit(+) / credit(−) percent', -40, 40, { default: 0, required: false }),
    ] },
  ],
  crossChecks: [
    { id: 'roof_after_built', path: 'risk.roof_year', check: or(E.op('eq', E.op('coalesce', i('risk.roof_year'), 0), 0), gte(i('risk.roof_year'), i('risk.year_built'))), message: 'Roof year cannot be earlier than the year built.' },
  ],
};

export const PRODUCT_CONTENT = { 'personal-auto': paContent, homeowners: hoContent, 'commercial-property': cpContent, bop: bopContent };
