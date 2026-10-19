// "Pilot Rate Workbook Profile v1": safe inspection of an uploaded .xlsx.
// - ZIP-level safety scan BEFORE any spreadsheet parser sees the file (macros, external links,
//   OLE/ActiveX, data connections, oversize / zip-bomb shapes, path traversal).
// - Cells are read as DATA ONLY. Formulas are never evaluated and never trusted: any formula cell
//   is reported as unsupported, with its address, and blocks import.
// This supports the documented profile, not arbitrary insurer workbooks.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { sha256 } from '../engine/util.js';
import { createHash } from 'node:crypto';

export const PROFILE_ID = 'pilot-rate-workbook-v1';
export const LIMITS = { maxBytes: 5 * 1024 * 1024, maxEntries: 400, maxUncompressed: 60 * 1024 * 1024, maxSheets: 60, maxRowsPerSheet: 20000, maxColsPerSheet: 60 };
const IGNORED_SHEETS = ['README', 'META', 'NOTES'];

const issue = (severity, code, message, extra = {}) => ({ severity, code, message, ...extra });

/** ZIP-level safety scan. Returns {ok, findings[], zip?}. */
export async function safetyScan(buffer, fileName = '') {
  const findings = [];
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, findings: [issue('error', 'EMPTY_FILE', 'The file is empty.')] };
  if (buffer.length > LIMITS.maxBytes) return { ok: false, findings: [issue('error', 'FILE_TOO_LARGE', `The file is ${(buffer.length / 1048576).toFixed(1)} MB; the limit is ${LIMITS.maxBytes / 1048576} MB.`)] };
  if (/\.(xlsm|xlsb|xls|xltm|xlam)$/i.test(fileName)) findings.push(issue('error', 'UNSUPPORTED_FORMAT', `"${fileName}" is a macro-enabled or legacy Excel format. Only plain .xlsx is supported.`));
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    findings.push(issue('error', 'NOT_XLSX', 'The file is not a ZIP-based .xlsx workbook (legacy .xls and other formats are rejected, not converted).'));
    return { ok: false, findings };
  }
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { return { ok: false, findings: [...findings, issue('error', 'CORRUPT_ZIP', 'The workbook archive is corrupt or unreadable.')] }; }
  const names = Object.keys(zip.files);
  if (names.length > LIMITS.maxEntries) findings.push(issue('error', 'TOO_MANY_ENTRIES', `The archive has ${names.length} entries (limit ${LIMITS.maxEntries}).`));
  let total = 0;
  for (const n of names) {
    const entry = zip.files[n];
    total += entry._data?.uncompressedSize || 0;
    if (/(^|\/)\.\.(\/|$)|^\//.test(n) || n.includes('\\')) findings.push(issue('error', 'UNSAFE_PATH', `Archive entry "${n}" has an unsafe path.`));
    if (/(^|\/)vbaProject\.bin$/i.test(n) || /vbaData\.xml$/i.test(n)) findings.push(issue('error', 'MACROS', `Embedded macros detected (${n}). Macros are never executed or accepted.`));
    if (/^xl\/externalLinks\//i.test(n)) findings.push(issue('error', 'EXTERNAL_LINKS', `External workbook links detected (${n}). They are not followed or accepted.`));
    if (/^xl\/(embeddings|activeX|ctrlProps)\//i.test(n) || /oleObject/i.test(n)) findings.push(issue('error', 'EMBEDDED_OBJECTS', `Embedded OLE/ActiveX object detected (${n}).`));
    if (/^xl\/(connections|queryTables)/i.test(n) || /^xl\/connections\.xml$/i.test(n)) findings.push(issue('error', 'DATA_CONNECTIONS', `Data connection / query detected (${n}).`));
    if (/^xl\/(pivotCache|pivotTables)\//i.test(n)) findings.push(issue('warning', 'PIVOT_TABLES', `Pivot table parts (${n}) are ignored.`));
    if (/^xl\/(drawings|media)\//i.test(n)) findings.push(issue('info', 'DRAWINGS_IGNORED', `Drawing/media part (${n}) is ignored.`));
  }
  if (total > LIMITS.maxUncompressed) findings.push(issue('error', 'ZIP_BOMB', `The archive expands to ${(total / 1048576).toFixed(0)} MB (limit ${LIMITS.maxUncompressed / 1048576} MB).`));
  const ct = zip.files['[Content_Types].xml'];
  if (!ct) findings.push(issue('error', 'NOT_XLSX', 'Missing [Content_Types].xml; this is not a valid .xlsx.'));
  else { const xml = await ct.async('string'); if (/macroEnabled|vbaProject/i.test(xml)) findings.push(issue('error', 'MACROS', 'The workbook declares macro-enabled content types.')); }
  if (!zip.files['xl/workbook.xml']) findings.push(issue('error', 'NOT_XLSX', 'Missing xl/workbook.xml; this is not a spreadsheet workbook.'));
  const dedupe = []; const seen = new Set();
  for (const f of findings) { const k = f.code + (f.code === 'DRAWINGS_IGNORED' ? '' : f.message); if (!seen.has(k)) { seen.add(k); dedupe.push(f); } }
  return { ok: !dedupe.some((f) => f.severity === 'error'), findings: dedupe };
}

// ---- cell reading ----
export function readCell(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return { kind: 'empty', value: null };
  if (typeof v === 'number') return { kind: 'number', value: v };
  if (typeof v === 'boolean') return { kind: 'boolean', value: v };
  if (typeof v === 'string') return v.trim() === '' ? { kind: 'empty', value: null } : { kind: 'string', value: v.trim() };
  if (v instanceof Date) return { kind: 'date', value: v.toISOString().slice(0, 10) };
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return { kind: 'formula', value: v.result ?? null, formula: String(v.formula ?? `shared:${v.sharedFormula}`).slice(0, 120) };
    if ('error' in v) return { kind: 'error', value: String(v.error) };
    if ('richText' in v) { const t = v.richText.map((r) => r.text).join('').trim(); return t ? { kind: 'string', value: t } : { kind: 'empty', value: null }; }
    if ('text' in v) return { kind: 'string', value: String(v.text).trim() };
  }
  return { kind: 'string', value: String(v) };
}

const colLetter = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
export const addr = (col, row) => `${colLetter(col)}${row}`;

/** Parse the whole workbook into plain grids (never evaluates formulas). */
export async function parseWorkbook(buffer, fileName = 'workbook.xlsx') {
  const scan = await safetyScan(buffer, fileName);
  const report = { file: { name: fileName, size: buffer?.length ?? 0, sha256: buffer?.length ? createHash('sha256').update(buffer).digest('hex') : null }, profile: PROFILE_ID, safety: { ok: scan.ok, findings: scan.findings }, issues: [], sheets: [], grids: {} };
  report.issues.push(...scan.findings.filter((f) => f.severity !== 'info'));
  if (!scan.ok) return report;
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (e) {
    report.safety.ok = false;
    report.issues.push(issue('error', 'UNREADABLE', `The workbook could not be read: ${String(e.message).slice(0, 160)}`));
    return report;
  }
  if (wb.worksheets.length > LIMITS.maxSheets) { report.issues.push(issue('error', 'TOO_MANY_SHEETS', `The workbook has ${wb.worksheets.length} sheets (limit ${LIMITS.maxSheets}).`)); return report; }
  const definedNames = (wb.definedNames?.model || []).length;
  if (definedNames) report.issues.push(issue('info', 'DEFINED_NAMES', `${definedNames} defined name(s) are ignored.`));
  for (const ws of wb.worksheets) {
    const rows = Math.min(ws.actualRowCount || ws.rowCount || 0, LIMITS.maxRowsPerSheet + 1);
    if ((ws.rowCount || 0) > LIMITS.maxRowsPerSheet) report.issues.push(issue('error', 'SHEET_TOO_LARGE', `Sheet "${ws.name}" has ${ws.rowCount} rows (limit ${LIMITS.maxRowsPerSheet}).`, { sheet: ws.name }));
    const cols = Math.min(ws.columnCount || 0, LIMITS.maxColsPerSheet);
    const grid = []; // grid[r-1][c-1] = {kind,value,formula?}
    const formulas = []; const errors = [];
    for (let r = 1; r <= (ws.rowCount || 0) && r <= LIMITS.maxRowsPerSheet; r++) {
      const row = ws.getRow(r);
      const out = [];
      for (let c = 1; c <= cols; c++) {
        const cell = readCell(row.getCell(c));
        out.push(cell);
        if (cell.kind === 'formula') formulas.push({ cell: addr(c, r), formula: cell.formula, cached: cell.value });
        if (cell.kind === 'error') errors.push({ cell: addr(c, r), value: cell.value });
      }
      grid.push(out);
    }
    const merged = Object.keys(ws._merges || {});
    const info = { name: ws.name, state: ws.state || 'visible', rows: grid.length, cols, mergedRanges: merged.length, formulas: { count: formulas.length, examples: formulas.slice(0, 5) }, errorCells: errors.slice(0, 5), errorCount: errors.length };
    report.sheets.push(info);
    report.grids[ws.name] = grid;
    if (info.state !== 'visible') report.issues.push(issue('warning', 'HIDDEN_SHEET', `Sheet "${ws.name}" is ${info.state}. Hidden content is still read; review it.`, { sheet: ws.name }));
    if (formulas.length) report.issues.push(issue('error', 'FORMULAS_UNSUPPORTED', `Sheet "${ws.name}" contains ${formulas.length} formula cell(s) (e.g. ${formulas.slice(0, 3).map((f) => `${f.cell} =${f.formula}`).join('; ')}). Formulas are never executed or guessed; paste values instead.`, { sheet: ws.name, cell: formulas[0].cell }));
    if (errors.length) report.issues.push(issue('error', 'ERROR_VALUES', `Sheet "${ws.name}" contains error values (e.g. ${errors[0].cell} = ${errors[0].value}).`, { sheet: ws.name, cell: errors[0].cell }));
    if (merged.length) report.issues.push(issue(ws.name.startsWith('RT_') ? 'error' : 'warning', 'MERGED_CELLS', `Sheet "${ws.name}" has merged cells (${merged.slice(0, 3).join(', ')}); merged cells make columns ambiguous.`, { sheet: ws.name }));
  }
  return report;
}

// ---- table detection ----
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Find candidate tables in parsed grids: first non-empty row = header. Marks profile-conformant sheets. */
export function detectTables(report) {
  const tables = [];
  let paramsSheet = null; let meta = null;
  for (const info of report.sheets) {
    const grid = report.grids[info.name] || [];
    const upper = info.name.toUpperCase();
    if (upper === 'META') { meta = readMeta(grid); continue; }
    if (IGNORED_SHEETS.includes(upper)) continue;
    if (upper === 'PARAMS') { paramsSheet = info.name; continue; }
    const headerRow = grid.findIndex((r) => r.some((c) => c.kind !== 'empty'));
    if (headerRow < 0) { report.issues.push(issue('warning', 'EMPTY_SHEET', `Sheet "${info.name}" has no data.`, { sheet: info.name })); continue; }
    const header = grid[headerRow];
    const columns = [];
    const seen = new Set();
    header.forEach((cell, idx) => {
      if (cell.kind === 'empty') return;
      const name = String(cell.value);
      if (seen.has(name.toLowerCase())) report.issues.push(issue('error', 'DUPLICATE_HEADER', `Sheet "${info.name}" has the column header "${name}" more than once (${addr(idx + 1, headerRow + 1)}).`, { sheet: info.name, cell: addr(idx + 1, headerRow + 1) }));
      seen.add(name.toLowerCase());
      const values = grid.slice(headerRow + 1).map((r) => r[idx]).filter((c) => c && c.kind !== 'empty');
      const numeric = values.filter((c) => c.kind === 'number').length;
      columns.push({ name, index: idx, letter: addr(idx + 1, 1).replace(/\d+$/, ''), kind: values.length && numeric / values.length >= 0.9 ? 'numeric' : 'text', filled: values.length, samples: values.slice(0, 3).map((c) => c.value) });
    });
    const dataRows = grid.slice(headerRow + 1).filter((r) => r.some((c) => c.kind !== 'empty')).length;
    const synonyms = ['value', 'factor', 'relativity', 'rate', 'amount', 'premium'];
    const valueCol = columns.find((c) => c.kind === 'numeric' && synonyms.includes(norm(c.name))) || [...columns].reverse().find((c) => c.kind === 'numeric') || null;
    tables.push({ sheet: info.name, headerRow: headerRow + 1, columns, rowCount: dataRows, candidateValueColumn: valueCol?.name ?? null, profileSheet: upper.startsWith('RT_'), profileTable: upper.startsWith('RT_') ? info.name.slice(3) : null });
  }
  return { tables, paramsSheet, meta };
}

function readMeta(grid) {
  const meta = {};
  for (const row of grid) { const k = row[0]; const v = row[1]; if (k && k.kind === 'string' && v && v.kind !== 'empty') meta[k.value.trim()] = v.value; }
  return meta;
}

export { norm, IGNORED_SHEETS, sha256 };
