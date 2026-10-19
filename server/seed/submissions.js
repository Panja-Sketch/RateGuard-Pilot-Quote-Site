// A few synthetic saved submissions so the UI is not empty on first run.
import { baselineScenario, patchScenario } from './scenarios.js';

const DEMO_USER = { id: 'agent.demo', role: 'agent' };

export async function seedSubmissions(ctx) {
  const specs = [
    ['personal-auto', 'AZ', 'Demo family – 2 drivers, 1 SUV', {}],
    ['personal-auto', 'CA', 'Demo – young driver (CA, no insurance score)', { risk: { drivers: [{ birth_date: '2006-05-20', years_licensed: 2, marital_status: 'single', good_student: true }] } }],
    ['homeowners', 'FL', 'Demo – coastal home, percentage wind deductible', { risk: { distance_to_coast: '1to5' }, coverages: { wind_hail_ded: '2pct' } }],
    ['homeowners', 'TX', 'Demo – older asphalt roof in TX (referral)', { risk: { year_built: 1995, roof_year: 2005 } }],
    ['commercial-property', 'IL', 'Demo – professional office building', {}],
    ['bop', 'NY', 'Demo – consulting LLC (BOP)', {}],
  ];
  for (const [productId, state, name, patch] of specs) {
    const sc = patch && Object.keys(patch).length ? patchScenario(productId, state, patch) : baselineScenario(productId, state);
    const sub = await ctx.submissions.create(DEMO_USER, { productId, state, name, effectiveDate: '2026-11-01', risk: sc.risk, coverages: sc.coverages });
    await ctx.submissions.rate(DEMO_USER, sub.id);
  }
}
