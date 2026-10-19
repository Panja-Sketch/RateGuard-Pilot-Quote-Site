// Developer aid: boots an in-memory server, drives the real UI in headless Chrome/Edge and saves
// screenshots (used to eyeball layouts). Usage: node scripts/ui-shots.js <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { startServer, PASSWORD } from '../tests/helpers.js';
import { launch } from '../tests/ui/browser.js';

const out = path.resolve(process.argv[2] || 'ui-shots');
fs.mkdirSync(out, { recursive: true });
const S = await startServer();
const browser = await launch();
if (!browser) { console.log('No browser found'); process.exit(1); }
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 900 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => logs.push(`requestfailed: ${r.url()}`));
const shot = async (name) => { await new Promise((r) => setTimeout(r, 500)); await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }); console.log('shot', name); };
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await new Promise((r) => setTimeout(r, 900)); };

await page.goto(`${S.base}/`, { waitUntil: 'networkidle0' });
await shot('01-login');
await page.type('#lg-user', 'analyst.demo', { delay: 0 }); await page.$eval('#lg-user', (el) => { el.value = ''; });
await page.type('#lg-user', 'analyst.demo'); await page.type('#lg-pass', PASSWORD);
await page.click('button[type=submit]');
await new Promise((r) => setTimeout(r, 1200));
await shot('02-home');
for (const [name, hash] of [['03-start', '#/start/homeowners'], ['04-submissions', '#/submissions'], ['05-quote', '#/s/SUB-00003/quote'], ['06-wizard', '#/s/SUB-00001'], ['07-wb', '#/wb'], ['08-version-tables', '#/wb/v/HO-NAT-v4?tab=Tables'], ['08b-steps', '#/wb/v/HO-NAT-v2?tab=Calculation%20sequence'], ['08c-validation', '#/wb/v/HO-NAT-v5?tab=Validation'], ['09-diff', '#/wb/diff/HO-NAT-v2/HO-NAT-v4'], ['10-xlsx', '#/wb/xlsx'], ['11-impact', '#/wb/impact?candidate=HO-NAT-v4&baseline=HO-NAT-v2'], ['12-feedback', '#/wb/feedback'], ['13-audit', '#/wb/audit'], ['14-api', '#/api']]) {
  await go(hash); await shot(name);
}
console.log(logs.length ? `CONSOLE ISSUES:\n${[...new Set(logs)].join('\n')}` : 'no console issues');
await browser.close(); await S.close();
