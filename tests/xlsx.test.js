// XLSX profile: inspect, mapping suggestions, import with provenance, diff, safety rejections, feedback loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { makeContext, actors, ROOT } from './helpers.js';
import { buildSamples } from '../server/xlsx/samples.js';
import { exportWorkbook } from '../server/xlsx/importer.js';
import { parseWorkbook, safetyScan, LIMITS } from '../server/xlsx/profile.js';
import { baselineScenario } from '../server/seed/scenarios.js';
import { hashOf } from '../server/engine/util.js';

let samples;
test.before(async () => { samples = await buildSamples(); });
const sample = (name) => samples.get(name).buffer;

const confirm = (suggested) => ({ ...suggested, tables: suggested.tables.map((t) => ({ ...t, confirmed: true, columns: Object.fromEntries(Object.entries(t.columns).map(([k, v]) => [k, v.source])) })), params: suggested.params ? { ...suggested.params, confirmed: true } : null });

test('the shipped samples match what the generator produces and are documented', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples', 'MANIFEST.json'), 'utf8'));
  for (const [file, { description }] of samples) {
    assert.ok(manifest[file], `${file} listed in MANIFEST.json (run npm run samples)`);
    assert.equal(manifest[file].description, description);
    assert.ok(fs.existsSync(path.join(ROOT, 'samples', file)));
  }
});

test('template export -> inspect: sheets, tables, columns and candidate values are detected; exact mapping is ready', async () => {
  const ctx = await makeContext();
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 'HO_NAT_v2_current.xlsx', buffer: sample('HO_NAT_v2_current.xlsx') });
  assert.equal(up.workbook.accepted, true);
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  const names = ins.report.sheets.map((s) => s.name);
  for (const n of ['README', 'META', 'PARAMS', 'RT_ROOF_AGE', 'RT_BASE_RATE', 'RT_TERRITORY']) assert.ok(names.includes(n), n);
  const roof = ins.detected.tables.find((t) => t.sheet === 'RT_ROOF_AGE');
  assert.deepEqual(roof.columns.map((c) => c.name), ['age_min', 'age_max', 'value']);
  assert.equal(roof.candidateValueColumn, 'value'); assert.equal(roof.rowCount, 4);
  assert.equal(ins.detected.meta.versionId, 'HO-NAT-v2');
  const sm = ins.suggestedMapping;
  assert.equal(sm.tables.length, Object.keys((await ctx.versions.mustGet('HO-NAT-v2')).content.tables).length);
  assert.ok(sm.tables.every((t) => t.status === 'ready' && t.confidence === 'exact'));
  assert.equal(sm.unmappedSheets.length, 0);
});

test('round trip: importing the template unchanged yields zero differences; draft keeps cell provenance', async () => {
  const ctx = await makeContext();
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 'HO_NAT_v2_current.xlsx', buffer: sample('HO_NAT_v2_current.xlsx') });
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  const mapping = confirm(ins.suggestedMapping);
  const prev = await ctx.workbooks.preview(up.workbook.id, mapping, 'HO-NAT-v2');
  assert.equal(prev.ok, true); assert.equal(prev.diff.summary.total, 0);
  const res = await ctx.workbooks.importDraft(actors.analyst, up.workbook.id, { mapping, baseVersionId: 'HO-NAT-v2', label: 'roundtrip' });
  assert.equal(res.draft.source.type, 'xlsx'); assert.equal(res.draft.source.sha256, up.workbook.sha256);
  assert.equal(hashOf(res.draft.content), hashOf((await ctx.versions.mustGet('HO-NAT-v2')).content));
  const prov = res.draft.provenance.tables.ROOF_AGE;
  assert.equal(prov.length, 4);
  assert.deepEqual(prov[3], { sheet: 'RT_ROOF_AGE', row: 5, cells: { age_min: 'RT_ROOF_AGE!A5', age_max: 'RT_ROOF_AGE!B5', value: 'RT_ROOF_AGE!C5' } });
});

test('normal rate change workbook: +4% base rates, valid, cell-level provenance, audit entry', async () => {
  const ctx = await makeContext();
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 'HO_NAT_rate_change_plus4pct.xlsx', buffer: sample('HO_NAT_rate_change_plus4pct.xlsx') });
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  const prev = await ctx.workbooks.preview(up.workbook.id, confirm(ins.suggestedMapping), 'HO-NAT-v2');
  assert.equal(prev.ok, true);
  assert.deepEqual([...new Set(prev.diff.changes.map((c) => c.path))], ['tables.BASE_RATE']);
  assert.equal(prev.diff.summary.total, 10);
  assert.ok(prev.diff.changes.every((c) => c.pct > 3.9 && c.pct < 4.1));
  assert.equal(prev.validation.valid, true);
  const res = await ctx.workbooks.importDraft(actors.analyst, up.workbook.id, { mapping: confirm(ins.suggestedMapping), baseVersionId: 'HO-NAT-v2', effectiveFrom: '2026-12-01', changeTicket: { reference: 'SYN-X', text: 'plus 4' } });
  const az = res.draft.provenance.tables.BASE_RATE.findIndex((_, i) => res.draft.content.tables.BASE_RATE.rows[i].state === 'AZ');
  assert.match(res.draft.provenance.tables.BASE_RATE[az].cells.value, /^RT_BASE_RATE!B\d+$/);
  assert.ok((await ctx.audit.list({ action: 'WORKBOOK_IMPORTED' })).length === 1);
  assert.equal(res.draft.status, 'draft', 'an import never activates anything');
});

test('silent defect workbook: exactly one changed cell, traced to its sheet and cell', async () => {
  const ctx = await makeContext();
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 'd.xlsx', buffer: sample('HO_NAT_defect_silent.xlsx') });
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  const prev = await ctx.workbooks.preview(up.workbook.id, confirm(ins.suggestedMapping), 'HO-NAT-v2');
  assert.equal(prev.diff.summary.total, 1);
  assert.deepEqual([prev.diff.changes[0].before, prev.diff.changes[0].after], [1.35, 1.25]);
  assert.equal(prev.validation.valid, true, 'passes structural validation – this is the demo defect');
  // workbook-to-workbook comparison finds the same single cell
  const base = await ctx.workbooks.upload(actors.analyst, { fileName: 'base.xlsx', buffer: sample('HO_NAT_v2_current.xlsx') });
  const cmp = await ctx.workbooks.compare(base.workbook.id, up.workbook.id);
  assert.equal(cmp.changes.length, 1);
  assert.deepEqual({ sheet: cmp.changes[0].sheet, cell: cmp.changes[0].cell, before: cmp.changes[0].before, after: cmp.changes[0].after }, { sheet: 'RT_ROOF_AGE', cell: 'C5', before: 1.35, after: 1.25 });
});

test('structural defect workbook imports as a draft but cannot pass validation', async () => {
  const ctx = await makeContext();
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 's.xlsx', buffer: sample('HO_NAT_defect_structural.xlsx') });
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  const prev = await ctx.workbooks.preview(up.workbook.id, confirm(ins.suggestedMapping), 'HO-NAT-v2');
  assert.equal(prev.validation.valid, false);
  assert.ok(prev.validation.errors.some((e) => e.code === 'RANGE_GAP') && prev.validation.errors.some((e) => e.code === 'VALUE_OUT_OF_BOUNDS') && prev.validation.errors.some((e) => e.code === 'INCOMPLETE_TABLE'));
  const res = await ctx.workbooks.importDraft(actors.analyst, up.workbook.id, { mapping: confirm(ins.suggestedMapping), baseVersionId: 'HO-NAT-v2' });
  const v = await ctx.versions.validate(actors.analyst, res.draft.id);
  assert.equal(v.report.valid, false); assert.equal(v.document.status, 'draft');
});

test('formulas are flagged with their cell address and block the import (never evaluated)', async () => {
  const ctx = await makeContext();
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 'f.xlsx', buffer: sample('HO_NAT_unsupported_formulas.xlsx') });
  assert.equal(up.workbook.accepted, true, 'a formula workbook is safe to read; it is just unsupported');
  const f = up.report.issues.find((i) => i.code === 'FORMULAS_UNSUPPORTED');
  assert.ok(f && f.cell === 'C5' && /C4\*1\.04/.test(f.message));
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  await assert.rejects(() => ctx.workbooks.importDraft(actors.analyst, up.workbook.id, { mapping: confirm(ins.suggestedMapping), baseVersionId: 'HO-NAT-v2' }), (e) => e.code === 'IMPORT_BLOCKED' && e.details.some((i) => i.code === 'FORMULAS_UNSUPPORTED'));
});

test('renamed columns are only SUGGESTED; import needs explicit confirmation; corrections become reviewable feedback', async () => {
  const ctx = await makeContext();
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 'r.xlsx', buffer: sample('HO_NAT_renamed_columns.xlsx') });
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  const t = ins.suggestedMapping.tables.find((x) => x.sheet === 'Roof Age');
  assert.equal(t.target, 'ROOF_AGE'); assert.equal(t.confidence, 'suggested'); assert.equal(t.status, 'needs_confirmation');
  assert.equal(t.columns.age_min.source, 'Age From'); assert.equal(t.columns.age_min.confidence, 'pattern'); assert.equal(t.columns.value.confidence, 'synonym');
  assert.ok(ins.suggestedMapping.unmappedSheets.some((u) => u.sheet === 'Notes from actuary'), 'free-text sheet is not guessed into a table');
  // unconfirmed -> blocked
  const unconfirmed = { ...ins.suggestedMapping, tables: ins.suggestedMapping.tables.map((x) => ({ ...x, columns: Object.fromEntries(Object.entries(x.columns).map(([k, v]) => [k, v.source])) })) };
  await assert.rejects(() => ctx.workbooks.importDraft(actors.analyst, up.workbook.id, { mapping: unconfirmed, baseVersionId: 'HO-NAT-v2' }), (e) => e.code === 'IMPORT_BLOCKED' && e.details.some((i) => i.code === 'UNCONFIRMED_MAPPING'));
  // confirmed, with one column flagged as a human correction
  const mapping = { ...ins.suggestedMapping, ignoreSheets: ['Notes from actuary'], tables: ins.suggestedMapping.tables.map((x) => ({ ...x, confirmed: true, columns: { age_min: { source: 'Age From', corrected: true }, age_max: 'Age To', value: 'Factor' } })) };
  const res = await ctx.workbooks.importDraft(actors.analyst, up.workbook.id, { mapping, baseVersionId: 'HO-NAT-v2' });
  assert.equal(hashOf(res.draft.content.tables.ROOF_AGE), hashOf((await ctx.versions.mustGet('HO-NAT-v2')).content.tables.ROOF_AGE), 'values identical to the base');
  assert.equal(res.feedbackCaptured.length, 1);
  const fb = (await ctx.feedback.list({ type: 'mapping_correction' }))[0];
  assert.equal(fb.status, 'submitted'); assert.equal(fb.versionId, res.draft.id); assert.equal(fb.productId, 'homeowners');

  // review: an approver (not the author) accepts -> versioned, product-scoped hint; premiums and configs are untouched
  const before = await ctx.quotes.quote(actors.admin, baselineScenario('homeowners', 'AZ'));
  const hashesBefore = (await ctx.versions.list({ kind: 'rating' })).map((d) => `${d.id}:${hashOf(d.content)}`).join();
  await assert.rejects(() => ctx.feedback.review(actors.analyst, fb.id, { decision: 'accept' }), (e) => e.code === 'FOUR_EYES');
  const rev = await ctx.feedback.review(actors.approver, fb.id, { decision: 'accept', comment: 'yes' });
  assert.equal(rev.hint.version, 1); assert.equal(rev.hint.productId, 'homeowners'); assert.equal(rev.hint.targetColumn, 'age_min');
  const after = await ctx.quotes.quote(actors.admin, baselineScenario('homeowners', 'AZ'));
  assert.equal(after.resultHash, before.resultHash, 'feedback never changes premiums');
  assert.equal((await ctx.versions.list({ kind: 'rating' })).map((d) => `${d.id}:${hashOf(d.content)}`).join(), hashesBefore, 'feedback never changes configuration');
  // the next inspection of a similar file shows the hint as a (still unconfirmed) suggestion for that product only
  const up2 = await ctx.workbooks.upload(actors.analyst, { fileName: 'r2.xlsx', buffer: sample('HO_NAT_renamed_columns.xlsx') });
  const ins2 = await ctx.workbooks.inspect(up2.workbook.id, 'HO-NAT-v2');
  assert.equal(ins2.suggestedMapping.tables[0].columns.age_min.confidence, 'hint');
  assert.equal(ins2.suggestedMapping.tables[0].confirmed, false);
  const pa = await ctx.feedback.activeHints('personal-auto'); assert.equal(pa.length, 0, 'hints do not leak across products');
});

test('ambiguous columns, blank values and unknown sheets are flagged, never guessed', async () => {
  const ctx = await makeContext();
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 'a.xlsx', buffer: sample('HO_NAT_ambiguous_columns.xlsx') });
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  const t = ins.suggestedMapping.tables.find((x) => x.sheet === 'Roof Age');
  assert.equal(t.status, 'incomplete');
  assert.ok(t.ambiguous.some((a) => a.target === 'value' && a.candidates.length === 2));
  assert.ok(ins.suggestedMapping.unmappedSheets.some((u) => u.sheet === 'Mystery'));
  const forced = { ...ins.suggestedMapping, tables: [{ sheet: 'Roof Age', target: 'ROOF_AGE', confirmed: true, columns: { age_min: 'age_min', age_max: 'age_max', value: 'relativity' } }] };
  const prev = await ctx.workbooks.preview(up.workbook.id, forced, 'HO-NAT-v2');
  assert.equal(prev.ok, false);
  const missing = prev.issues.find((i) => i.code === 'MISSING_VALUE');
  assert.ok(missing && missing.cell === 'D4', `blank cell reported at ${missing?.cell}`);
  assert.ok(prev.issues.some((i) => i.code === 'UNMAPPED_SHEET' && i.sheet === 'Mystery'));
  const bad = { ...forced, tables: [{ ...forced.tables[0], target: 'NOPE' }] };
  assert.ok((await ctx.workbooks.preview(up.workbook.id, bad, 'HO-NAT-v2')).issues.some((i) => i.code === 'UNKNOWN_TARGET'));
});

test('unsafe workbooks are rejected before any spreadsheet parser sees them and are not retained', async () => {
  const ctx = await makeContext();
  const mac = await ctx.workbooks.upload(actors.analyst, { fileName: 'macro.xlsx', buffer: sample('UNSAFE_macro_parts.xlsx') });
  assert.equal(mac.workbook.accepted, false);
  assert.ok(mac.report.issues.some((i) => i.code === 'MACROS'));
  const ext = await ctx.workbooks.upload(actors.analyst, { fileName: 'ext.xlsx', buffer: sample('UNSAFE_external_link.xlsx') });
  assert.ok(ext.report.issues.some((i) => i.code === 'EXTERNAL_LINKS'));
  await assert.rejects(() => ctx.workbooks.inspect(mac.workbook.id, 'HO-NAT-v2'), (e) => e.code === 'WORKBOOK_REJECTED');
  assert.equal(await ctx.blobs.get(mac.workbook.sha256), null, 'rejected files are not stored');
  assert.equal((await ctx.audit.list({ action: 'WORKBOOK_REJECTED' })).length, 2);

  const scan = (b, n) => safetyScan(b, n);
  assert.ok((await scan(Buffer.from('MZ not a zip'), 'x.xlsx')).findings.some((f) => f.code === 'NOT_XLSX'));
  assert.ok((await scan(sample('HO_NAT_v2_current.xlsx'), 'x.xlsm')).findings.some((f) => f.code === 'UNSUPPORTED_FORMAT'));
  assert.ok((await scan(Buffer.alloc(LIMITS.maxBytes + 1, 1), 'big.xlsx')).findings.some((f) => f.code === 'FILE_TOO_LARGE'));
  // path traversal entry
  const z = await JSZip.loadAsync(sample('HO_NAT_v2_current.xlsx')); z.file('../evil.txt', 'x');
  assert.ok((await scan(Buffer.from(await z.generateAsync({ type: 'nodebuffer' })), 'x.xlsx')).findings.some((f) => f.code === 'UNSAFE_PATH'));
  // zip bomb shape: tiny archive that expands past the limit
  const bomb = await JSZip.loadAsync(sample('HO_NAT_v2_current.xlsx')); bomb.file('xl/junk.bin', Buffer.alloc(LIMITS.maxUncompressed + 1024, 0));
  const bombBuf = Buffer.from(await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
  assert.ok(bombBuf.length < LIMITS.maxBytes);
  assert.ok((await scan(bombBuf, 'x.xlsx')).findings.some((f) => f.code === 'ZIP_BOMB'));
  // OLE/embedded and data connections
  for (const [entry, code] of [['xl/embeddings/oleObject1.bin', 'EMBEDDED_OBJECTS'], ['xl/connections.xml', 'DATA_CONNECTIONS']]) {
    const zz = await JSZip.loadAsync(sample('HO_NAT_v2_current.xlsx')); zz.file(entry, 'x');
    assert.ok((await scan(Buffer.from(await zz.generateAsync({ type: 'nodebuffer' })), 'x.xlsx')).findings.some((f) => f.code === code), code);
  }
});

test('hidden sheets, merged cells, error values and unknown parameters are reported', async () => {
  const ctx = await makeContext();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RT_ROOF_AGE');
  ws.addRow(['age_min', 'age_max', 'value']); ws.addRow([0, 11, 1]); ws.addRow([11, null, { error: '#REF!' }]); ws.mergeCells('A4:B4');
  wb.addWorksheet('Hidden stuff', { state: 'hidden' }).addRow(['x']);
  const params = wb.addWorksheet('PARAMS'); params.addRow(['key', 'value']); params.addRow(['hacker_param', 5]); params.addRow(['policy_fee', 'free']);
  const up = await ctx.workbooks.upload(actors.analyst, { fileName: 'w.xlsx', buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
  const codes = up.report.issues.map((i) => i.code);
  for (const c of ['HIDDEN_SHEET', 'MERGED_CELLS', 'ERROR_VALUES']) assert.ok(codes.includes(c), c);
  const ins = await ctx.workbooks.inspect(up.workbook.id, 'HO-NAT-v2');
  const prev = await ctx.workbooks.preview(up.workbook.id, confirm(ins.suggestedMapping), 'HO-NAT-v2');
  assert.equal(prev.ok, false);
  const pcodes = prev.issues.map((i) => i.code);
  assert.ok(pcodes.includes('UNKNOWN_PARAM') && pcodes.includes('NOT_NUMERIC'));
});

test('export of any rating version is parseable by the same profile (state overrides too)', async () => {
  const ctx = await makeContext();
  const fl = await ctx.versions.mustGet('HO-FL-v1');
  const rep = await parseWorkbook(await exportWorkbook(fl), 'fl.xlsx');
  assert.equal(rep.safety.ok, true);
  assert.deepEqual(rep.sheets.map((s2) => s2.name).filter((n) => n.startsWith('RT_')), Object.keys(fl.content.tables || {}).map((n) => 'RT_' + n));
  assert.ok(rep.sheets.some((s2) => s2.name === 'PARAMS'));
});
