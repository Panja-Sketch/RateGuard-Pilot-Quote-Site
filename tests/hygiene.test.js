// Repository hygiene: safe rating model, XSS-safe frontend, no secrets, separation from RateGuard Enhanced,
// persistence behaviour, and honest documentation of what is simulated / not built.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, makeContext } from './helpers.js';
import { FileStore } from '../server/store/store.js';
import { createContext } from '../server/context.js';

const SKIP_DIRS = new Set(['node_modules', 'data', '.git', 'coverage', '.firebase']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const text = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const srcFiles = (dirs) => files.filter((f) => /\.(js|mjs)$/.test(f) && dirs.some((d) => rel(f).startsWith(`${d}/`)));

test('the rating engine and server never execute dynamic code', () => {
  const bad = [/\beval\s*\(/, /new\s+Function\s*\(/, /\bchild_process\b/, /\brequire\(['"]vm['"]\)|from ['"]node:vm['"]|from ['"]vm['"]/, /\bFunction\s*\(\s*['"`]/];
  for (const f of srcFiles(['server', 'shared', 'public/js'])) {
    const t = text(f);
    for (const re of bad) assert.ok(!re.test(t), `${rel(f)} matches ${re}`);
  }
});

test('the frontend never injects HTML strings (all user text goes through textContent / text nodes)', () => {
  for (const f of srcFiles(['public/js'])) {
    const t = text(f);
    for (const re of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write\s*\(/, /dangerouslySetInnerHTML/]) assert.ok(!re.test(t), `${rel(f)} uses ${re}`);
  }
});

test('no credentials, tokens, private keys or service-account files are committed', () => {
  const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AIza[0-9A-Za-z_-]{35}/, /ya29\.[0-9A-Za-z_-]{20,}/, /"type"\s*:\s*"service_account"/, /AKIA[0-9A-Z]{16}/, /xox[baprs]-[0-9A-Za-z-]{10,}/, /ghp_[0-9A-Za-z]{30,}/, /sk-[A-Za-z0-9]{32,}/];
  for (const f of files) {
    if (/\.(xlsx|png|jpg|ico)$/i.test(f) || rel(f) === 'package-lock.json') continue;
    const t = text(f);
    for (const re of patterns) assert.ok(!re.test(t), `${rel(f)} looks like it contains a secret (${re})`);
  }
  assert.ok(!files.some((f) => /service-account.*\.json$|\.pem$|\.key$|(^|\/)\.env$/.test(rel(f))), 'no key/env files');
  const gi = text(path.join(ROOT, '.gitignore'));
  for (const must of ['data/', '.env', 'service-account*.json', '*.pem']) assert.ok(gi.includes(must), `.gitignore covers ${must}`);
});

test('the pilot is independent of RateGuard Enhanced: no imports, paths or copied modules', () => {
  for (const f of srcFiles(['server', 'shared', 'public/js', 'scripts', 'tests'])) {
    if (rel(f) === 'tests/hygiene.test.js') continue;
    const t = text(f);
    assert.ok(!/rateguard-enhanced/i.test(t), `${rel(f)} references the rateguard-enhanced repository`);
    assert.ok(!/from\s+['"][^'"]*\.\.\/\.\.\/rateguard/i.test(t), `${rel(f)} imports from outside the repository`);
  }
  const pkg = JSON.parse(text(path.join(ROOT, 'package.json')));
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /rateguard/i.test(d)));
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'INTEGRATION_CONTRACT.md')));
});

test('documentation is explicit about separation, simulation and what is not built', () => {
  const readme = text(path.join(ROOT, 'README.md'));
  assert.match(readme, /not integrated/i);
  assert.match(readme, /RateGuard v3/);
  assert.match(readme, /does not (yet )?exist|has not been (built|implemented)|not been implemented/i);
  assert.match(readme, /simulated/i);
  assert.match(readme, /What is not built/i);
  const contract = text(path.join(ROOT, 'docs', 'INTEGRATION_CONTRACT.md'));
  assert.match(contract, /future/i); assert.match(contract, /not (yet )?(built|implemented|exist)/i);
  for (const f of ['ARCHITECTURE.md', 'API.md', 'RATING_MODEL.md', 'XLSX_PROFILE.md', 'GOOGLE_CLOUD.md', 'SECURITY.md', 'ASSUMPTIONS.md', 'ROADMAP.md', 'DEMO_SCRIPT.md']) assert.ok(fs.existsSync(path.join(ROOT, 'docs', f)), `docs/${f}`);
});

test('every seeded rate value and example is synthetic (no real insurer/customer data markers)', async () => {
  const ctx = await makeContext();
  const blob = JSON.stringify(await ctx.store.list('documents')) + JSON.stringify(await ctx.store.list('submissions'));
  for (const re of [/\b\d{3}-\d{2}-\d{4}\b/, /@[a-z0-9-]+\.(com|net|org)\b/i, /progressive|geico|allstate|state farm|nationwide|chubb|hartford|usaa|liberty mutual|guidewire|duck creek/i]) assert.ok(!re.test(blob), `seed data must not match ${re}`);
  assert.ok((await ctx.store.list('submissions')).every((s) => s.synthetic === true));
});

// ---------------- persistence ----------------
test('file store persists across restarts and seeding happens only once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-store-'));
  const file = path.join(dir, 'pilot-store.json');
  try {
    const s1 = new FileStore(file);
    const c1 = await createContext({ store: s1 });
    const n1 = await s1.count('documents');
    const sub = await c1.submissions.create({ id: 'agent.demo', role: 'agent' }, { productId: 'bop', state: 'NY', effectiveDate: '2026-11-01' });
    s1.flush();
    assert.ok(fs.existsSync(file));
    const s2 = new FileStore(file);
    const c2 = await createContext({ store: s2 });
    assert.equal(await s2.count('documents'), n1, 'no second seeding');
    assert.equal((await c2.submissions.get(sub.id)).id, sub.id, 'submission survived restart');
    assert.equal((await c2.audit.verify()).ok, true, 'audit chain survived restart');
    fs.writeFileSync(file, '{broken');
    assert.throws(() => new FileStore(file), /Could not read data file/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('audit entries are written in order under concurrency', async () => {
  const ctx = await makeContext();
  await Promise.all(Array.from({ length: 25 }, (_, i) => ctx.audit.record({ id: 'u', role: 'agent' }, 'TEST', { type: 'x', id: String(i) }, `n${i}`)));
  const v = await ctx.audit.verify();
  assert.equal(v.ok, true);
  const entries = (await ctx.audit.list({ action: 'TEST' })).sort((a, b) => a.seq - b.seq);
  assert.equal(entries.length, 25); assert.deepEqual(entries.map((e) => e.seq), [...entries.map((e) => e.seq)].sort((a, b) => a - b));
});
