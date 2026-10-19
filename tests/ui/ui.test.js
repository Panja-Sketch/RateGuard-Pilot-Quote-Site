// End-to-end UI tests in a real headless browser against the real server (in-memory data).
// Skipped automatically when no Chromium-based browser is installed (set PILOT_BROWSER to point at one).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startServer, PASSWORD, ROOT } from '../helpers.js';
import { launch, findBrowser } from './browser.js';
import { baselineScenario, patchScenario } from '../../server/seed/scenarios.js';

const skip = findBrowser() ? false : 'no local Chromium-based browser found';
let S; let browser; let page; const consoleProblems = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickText(text, sel = 'button, a') {
  const ok = await page.evaluate((t, s) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t && !e.disabled && e.offsetParent !== null); if (el) { el.click(); return true; } return false; }, text, sel);
  assert.ok(ok, `no enabled "${text}" control found`);
}
const exists = (text, sel = 'body') => page.evaluate((t, s) => (document.querySelector(s)?.innerText || '').includes(t), text, sel);
async function waitText(text, sel = 'body', timeout = 8000) {
  await page.waitForFunction((t, s) => (document.querySelector(s)?.innerText || '').includes(t), { timeout }, text, sel).catch(async () => { throw new Error(`Timed out waiting for "${text}". Page text: ${(await page.evaluate(() => document.body.innerText)).slice(0, 700)}`); });
}
async function login(user) {
  await page.goto(`${S.base}/#/login`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });
  await page.goto(`${S.base}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#lg-user');
  await page.$eval('#lg-user', (el, v) => { el.value = v; }, user);
  await page.type('#lg-pass', user === 'rateguard.client' ? 'test-client-456' : PASSWORD);
  await clickText('Sign in');
  await page.waitForSelector('.topbar', { timeout: 8000 });
}
const hash = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await sleep(400); };
async function createSubmission(body) {
  const r = await S.request('POST', '/api/v1/submissions', { user: 'agent.demo', body });
  return r.data.submission.id;
}

test.before(async () => {
  if (skip) return;
  S = await startServer();
  browser = await launch();
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('console', (m) => { if (m.type() === 'error') consoleProblems.push(m.text()); });
  page.on('pageerror', (e) => consoleProblems.push(`pageerror ${e.message}`));
});
test.after(async () => { if (browser) await browser.close(); if (S) await S.close(); });

test('sign-in: wrong password is explained; demo user signs in and sees role-appropriate navigation', { skip }, async () => {
  await page.goto(`${S.base}/#/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#lg-user');
  await page.$eval('#lg-user', (el) => { el.value = 'agent.demo'; });
  await page.type('#lg-pass', 'wrong-password');
  await clickText('Sign in');
  await waitText('Unknown user or wrong password');
  await login('agent.demo');
  assert.ok(await exists('Get an illustrative quote'));
  assert.ok(await exists('SYNTHETIC DEMO', '.banner'));
  assert.equal(await exists('Pricing workbench', '.nav'), false, 'agents do not see the workbench');
  await login('analyst.demo');
  assert.ok(await exists('Pricing workbench', '.nav'));
});

for (const [productId, label, state] of [['personal-auto', 'Personal Auto', 'AZ'], ['homeowners', 'Homeowners', 'FL'], ['commercial-property', 'Commercial Property', 'IL'], ['bop', 'BOP', 'NY']]) {
  test(`${label}: wizard journey through every step to a rated quote with breakdown, trace and versions`, { skip }, async () => {
    await login('agent.demo');
    const sc = baselineScenario(productId, state);
    const id = await createSubmission({ productId, state, name: `UI ${label}`, effectiveDate: '2026-10-15', risk: sc.risk, coverages: sc.coverages });
    await hash(`#/s/${id}`);
    await page.waitForSelector('.steps');
    const stepCount = await page.$$eval('.steps li', (l) => l.length);
    assert.ok(stepCount >= 6, `${label} has ${stepCount} steps`);
    for (let i = 0; i < stepCount - 2; i++) { await clickText('Next'); await sleep(250); assert.equal(await exists('Please fix', '.toasts'), false, `step ${i + 1} should validate`); }
    await clickText('Review');
    await waitText('Inputs are valid and eligible', 'body', 10000);
    await clickText('Get quote');
    await page.waitForSelector('.premium-hero .amt', { timeout: 10000 });
    const shown = await page.$eval('.premium-hero .amt', (e) => e.textContent);
    const api = (await S.request('POST', '/api/v1/quotes', { user: 'agent.demo', body: { ...sc, effectiveDate: '2026-10-15' } })).data;
    assert.equal(shown, `$${api.premium.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    assert.ok(await exists('SYNTHETIC · NOT AN OFFER'));
    assert.ok(await exists('Total illustrative premium'));
    await clickText('Rating trace'); await sleep(200);
    assert.ok(await page.$$eval('.trace-item', (l) => l.length) > 10);
    await clickText('Versions & configuration'); await sleep(200);
    assert.ok(await exists(api.versions.product.id) && await exists(api.versions.rating[0].id));
    await clickText('Why this price'); await sleep(200);
    assert.ok(await exists('Rating factors'));
  });
}

test('wizard: required fields and format errors are shown next to the field; server-side ZIP/state check is explained', { skip }, async () => {
  await login('agent.demo');
  await hash('#/start/homeowners');
  await page.waitForSelector('#st-state');
  await page.select('#st-state', 'FL');
  await clickText('Start quote');
  await page.waitForSelector('.steps');
  await clickText('Next'); await sleep(300);   // policy step -> property
  await clickText('Next'); await sleep(300);   // empty property step must not pass
  assert.ok(await exists('Street address is required'), 'required message');
  assert.ok(await exists('Please fix', '.toasts'));
  assert.ok(await page.$$eval('.field.invalid', (l) => l.length) >= 5);
  // fill the property step with a wrong-state ZIP
  const sc = baselineScenario('homeowners', 'FL');
  const id = location_hash_id(await page.url());
  const put = await S.request('PUT', `/api/v1/submissions/${id}`, { user: 'agent.demo', body: { risk: { ...sc.risk, zip: '90210' }, coverages: sc.coverages } });
  assert.equal(put.status, 200);
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.steps');   // reload so the wizard does not autosave stale in-memory data over the PUT
  await page.click('.steps li:last-child button');
  await waitText('to fix before we can rate this');
  assert.ok(await exists('is outside the ZIP ranges used for FL'));
  await clickText('Go to field'); await sleep(300);
  assert.ok(await exists('About the home'), 'link jumps to the section holding the field');
});

test('non-quoted outcomes: referral shows reasons and no premium; info-required guides the user', { skip }, async () => {
  await login('agent.demo');
  const sc = patchScenario('personal-auto', 'AZ', { risk: { drivers: [{ sr22: true }] } });
  const id = await createSubmission({ productId: 'personal-auto', state: 'AZ', effectiveDate: '2026-10-15', risk: sc.risk, coverages: sc.coverages });
  await S.request('POST', `/api/v1/submissions/${id}/rate`, { user: 'agent.demo', body: {} });
  await hash(`#/s/${id}/quote`);
  await waitText('This risk needs an underwriter');
  assert.equal(await page.$('.premium-hero .amt'), null, 'no premium for a referral');
  assert.ok(await exists('SR-22'));
  const sc2 = patchScenario('homeowners', 'FL', { risk: { distance_to_coast: 'lt1' } });
  const id2 = await createSubmission({ productId: 'homeowners', state: 'FL', effectiveDate: '2026-10-15', risk: sc2.risk, coverages: sc2.coverages });
  await S.request('POST', `/api/v1/submissions/${id2}/rate`, { user: 'agent.demo', body: {} });
  await hash(`#/s/${id2}/quote`);
  await waitText('We need a little more information');
  assert.ok(await exists('percentage hurricane/wind deductible'));
});

test('quote actions: simulated bind is labelled, locks the submission; endorsement scenario pro-rates', { skip }, async () => {
  await login('agent.demo');
  const sc = baselineScenario('homeowners', 'GA');
  const id = await createSubmission({ productId: 'homeowners', state: 'GA', effectiveDate: '2026-11-01', risk: sc.risk, coverages: sc.coverages });
  await S.request('POST', `/api/v1/submissions/${id}/rate`, { user: 'agent.demo', body: {} });
  await hash(`#/s/${id}/quote`);
  await page.waitForSelector('.premium-hero .amt');
  await clickText('Endorsement scenario'); await sleep(300);
  await clickText('Create scenario');
  await page.waitForSelector('.steps', { timeout: 8000 });
  assert.ok(await exists('Endorsement test scenario'));
  await hash(`#/s/${id}/quote`); await page.waitForSelector('.premium-hero .amt');
  await clickText('Simulate bind'); await sleep(300);
  assert.ok(await exists('No policy, binder or coverage is created', '.modal'));
  await clickText('Simulate bind', '.modal button');
  await waitText('SIMULATED bind SIM-', 'body', 8000);
  assert.ok(await exists('no coverage'));
});

test('workbench: validation failure is explained; four-eyes disables self-approval', { skip }, async () => {
  await login('analyst.demo');
  await hash('#/wb/v/HO-NAT-v5?tab=Validation');
  await page.waitForSelector('.tabs');
  await clickText('Run validation now');
  await waitText('Validation failed');
  assert.ok(await exists('RANGE_GAP') && await exists('VALUE_OUT_OF_BOUNDS') && await exists('INCOMPLETE_TABLE'));
  // the clean rate change passes, can be submitted, but the creator cannot approve it
  await hash('#/wb/v/HO-NAT-v3');
  await page.waitForSelector('.tabs');
  await clickText('Validate'); await sleep(1200);
  await waitText('validated', 'h1');
  await clickText('Submit for approval'); await sleep(300);
  await clickText('Submit', '.modal button'); await sleep(1200);
  await waitText('pending approval', 'h1');
  await login('analyst.demo'); await hash('#/wb/v/HO-NAT-v3'); await page.waitForSelector('.tabs');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Approve')), false, 'the analyst has no approve control');
  await login('approver.demo'); await hash('#/wb/v/HO-NAT-v3'); await page.waitForSelector('.tabs');
  await clickText('Approve'); await sleep(300); await clickText('Approve', '.modal button'); await sleep(1200);
  await waitText('approved', 'h1');
  await clickText('Promote to active'); await sleep(300); await clickText('Promote', '.modal button'); await sleep(1500);
  await waitText('active', 'h1');
  assert.ok(await exists('immutable'));
});

test('workbench: edit a rate table cell, see it highlighted against the base, and save', { skip }, async () => {
  await login('analyst.demo');
  await hash('#/wb/v/PA-NAT-v3?tab=Tables');
  await page.waitForSelector('.cell-edit');
  const before = await page.$eval('.cell-edit[aria-label*="row 1 value"]', (el) => el.value);
  await page.click('.cell-edit[aria-label*="row 1 value"]', { clickCount: 3 });
  await page.type('.cell-edit[aria-label*="row 1 value"]', String(Number(before) * 2));
  await sleep(200);
  assert.ok(await page.$('td.changed'), 'changed cell highlighted');
  await clickText('Save changes'); await sleep(1500);
  await hash('#/wb/v/PA-NAT-v3?tab=Tables'); await page.waitForSelector('.cell-edit');
  const after = await page.$eval('.cell-edit[aria-label*="row 1 value"]', (el) => el.value);
  assert.equal(Number(after), Number(before) * 2);
  await hash('#/wb/diff/PA-NAT-v2/PA-NAT-v3'); await waitText('Rate table values');
  assert.ok(await exists('BASE_RATE'));
});

test('XLSX: upload, inspect, confirm mapping, preview the diff, import as a draft with provenance', { skip }, async () => {
  await login('analyst.demo');
  await hash('#/wb/xlsx');
  await page.waitForSelector('input[type=file]');
  const input = await page.$('input[type=file]');
  await input.uploadFile(path.join(ROOT, 'samples', 'HO_NAT_rate_change_plus4pct.xlsx'));
  await waitText('Safety scan passed');
  await page.select('select[aria-label="Base version"]', 'HO-NAT-v2');
  await clickText('Inspect & suggest mapping');
  await waitText('Review the mapping');
  await clickText('Confirm exact matches');
  await sleep(200);
  await clickText('4. Preview changes');
  await waitText('Import is possible');
  assert.ok(await exists('BASE_RATE'));
  assert.ok(await exists('Validation passed'));
  await clickText('Create draft');
  await waitText('created.');
  const link = await page.$eval('a.btn-primary[href^="#/wb/v/"]', (a) => a.getAttribute('href'));
  await hash(link.replace(/^#/, '#') + '?tab=Provenance');
  await page.waitForSelector('.tabs');
  await waitText('RT_BASE_RATE');
  assert.ok(await exists('sha256'));
});

test('XLSX: unsafe and formula workbooks are rejected / blocked with specific messages', { skip }, async () => {
  await login('analyst.demo');
  await hash('#/wb/xlsx'); await page.waitForSelector('input[type=file]');
  let input = await page.$('input[type=file]');
  await input.uploadFile(path.join(ROOT, 'samples', 'UNSAFE_macro_parts.xlsx'));
  await waitText('Rejected.'); assert.ok(await exists('MACROS'));
  await hash('#/wb/xlsx'); await page.waitForSelector('input[type=file]');
  input = await page.$('input[type=file]');
  await input.uploadFile(path.join(ROOT, 'samples', 'HO_NAT_unsupported_formulas.xlsx'));
  await waitText('Safety scan passed'); assert.ok(await exists('FORMULAS_UNSUPPORTED'));
  await page.select('select[aria-label="Base version"]', 'HO-NAT-v2');
  await clickText('Inspect & suggest mapping'); await waitText('Review the mapping');
  await clickText('Confirm exact matches'); await clickText('4. Preview changes');
  await waitText('Import is blocked');
  assert.ok(await exists('Formulas are never executed'));
});

test('scenario runner: a +x% change stays inside expectation; the silent defect is flagged', { skip }, async () => {
  await login('analyst.demo');
  await hash('#/wb/impact?candidate=HO-NAT-v4&baseline=HO-NAT-v2');
  await page.waitForSelector('button');
  await page.$$eval('input[type=number][placeholder^="e.g."]', (els) => { els[0].value = '0'; els[0].dispatchEvent(new Event('input', { bubbles: true })); });
  await clickText('Run scenarios');
  await waitText('moved by something other than the expected 0%', 'body', 20000);
  assert.ok(await exists('outside expectation'));
  assert.ok(await exists('roof-age'), 'the affected scenarios are the roof-age ones');
});

test('audit trail page shows entries and verifies the hash chain', { skip }, async () => {
  await login('approver.demo');
  await hash('#/wb/audit'); await waitText('Audit trail');
  assert.ok(await exists('CONFIG_PROMOTED') || await exists('QUOTE_CREATED') || await exists('CONFIG_CREATED'));
  await clickText('Verify hash chain');
  await waitText('Chain verified');
});

test('layout works at phone width and the app produced no console errors', { skip }, async () => {
  await page.setViewport({ width: 390, height: 800 });
  for (const h of ['#/', '#/submissions', '#/start/bop', '#/api']) { await login('agent.demo'); await hash(h); await sleep(700); const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(overflow <= 2, `${h} overflows by ${overflow}px`); }
  await page.setViewport({ width: 1280, height: 900 });
  const real = consoleProblems.filter((m) => !/Failed to load resource.*(401|403|404|409|422)/.test(m));
  assert.deepEqual(real, [], `console problems: ${real.join(' | ')}`);
});

function location_hash_id(url) { return url.match(/#\/s\/(SUB-\d+)/)[1]; }
