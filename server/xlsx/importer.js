// Mapping suggestion, validated import (with cell provenance), template export and workbook diff.
// Nothing here guesses: suggestions are labelled with a confidence and must be confirmed by a
// person; unsupported or ambiguous input produces issues and blocks the import.
import ExcelJS from 'exceljs';
import { clone } from '../engine/util.js';
import { norm, addr, PROFILE_ID, detectTables } from './profile.js';

const VALUE_SYNONYMS = ['value', 'factor', 'relativity', 'rate', 'amount', 'premium'];
const issue = (severity, code, message, extra = {}) => ({ severity, code, message, ...extra });

/** Columns a profile sheet must provide for a table: exact -> name; range -> name_min, name_max; plus value. */
export function tableColumns(table) {
  const cols = [];
  for (const k of table.keys) { if (k.kind === 'range') cols.push({ target: `${k.name}_min`, role: 'range_min', key: k.name }, { target: `${k.name}_max`, role: 'range_max', key: k.name }); else cols.push({ target: k.name, role: 'exact', key: k.name }); }
  cols.push({ target: 'value', role: 'value', key: 'value' });
  return cols;
}

// ---------------- mapping suggestions ----------------
export function suggestMapping(report, baseDoc, hints = []) {
  const detected = detectTables(report);
  const tables = baseDoc.content.tables || {};
  const out = { baseVersionId: baseDoc.id, profile: PROFILE_ID, tables: [], params: null, ignoreSheets: [], unmappedSheets: [], meta: detected.meta || null };
  const used = new Set();
  for (const t of detected.tables) {
    let target = null; let confidence = null;
    if (t.profileTable && tables[t.profileTable]) { target = t.profileTable; confidence = 'exact'; }
    if (!target) {
      const hint = hints.find((h) => h.sourceSheet === t.sheet && tables[h.targetTable]);
      if (hint) { target = hint.targetTable; confidence = 'hint'; }
    }
    if (!target) {
      const hit = Object.keys(tables).find((name) => norm(name) === norm(t.sheet) || norm(`RT_${name}`) === norm(t.sheet));
      if (hit) { target = hit; confidence = 'suggested'; }
    }
    if (!target) { out.unmappedSheets.push({ sheet: t.sheet, columns: t.columns.map((c) => c.name), candidateValueColumn: t.candidateValueColumn, reason: 'No rate table with a matching name; choose a target manually or ignore the sheet.' }); continue; }
    if (used.has(target)) { out.unmappedSheets.push({ sheet: t.sheet, columns: t.columns.map((c) => c.name), reason: `Table ${target} is already mapped from another sheet (ambiguous).` }); continue; }
    used.add(target);
    out.tables.push(suggestColumns(t, target, tables[target], confidence, hints));
  }
  if (detected.paramsSheet) out.params = { sheet: detected.paramsSheet, confirmed: false };
  out.ignoreSheets = report.sheets.map((s) => s.name).filter((n) => ['README', 'META', 'NOTES'].includes(n.toUpperCase()));
  return out;
}

function suggestColumns(det, target, table, sheetConfidence, hints) {
  const wanted = tableColumns(table);
  const columns = {}; const ambiguous = [];
  for (const w of wanted) {
    const candidates = [];
    for (const c of det.columns) {
      const hint = hints.find((h) => h.sourceSheet === det.sheet && h.sourceColumn === c.name && h.targetTable === target && h.targetColumn === w.target);
      if (hint) candidates.push({ source: c.name, confidence: 'hint' });
      else if (c.name === w.target) candidates.push({ source: c.name, confidence: 'exact' });
      else if (norm(c.name) === norm(w.target)) candidates.push({ source: c.name, confidence: 'normalized' });
      else if (w.role === 'value' && VALUE_SYNONYMS.includes(norm(c.name))) candidates.push({ source: c.name, confidence: 'synonym' });
      else if (w.role === 'range_min' && [`${w.key}from`, `${w.key}lower`, `${w.key}start`, `${w.key}low`].includes(norm(c.name))) candidates.push({ source: c.name, confidence: 'pattern' });
      else if (w.role === 'range_max' && [`${w.key}to`, `${w.key}upper`, `${w.key}end`, `${w.key}high`].includes(norm(c.name))) candidates.push({ source: c.name, confidence: 'pattern' });
    }
    const best = ['hint', 'exact', 'normalized', 'pattern', 'synonym'];
    candidates.sort((a, b) => best.indexOf(a.confidence) - best.indexOf(b.confidence));
    const top = candidates.filter((c) => c.confidence === candidates[0]?.confidence);
    if (top.length > 1) { ambiguous.push({ target: w.target, candidates: top.map((c) => c.source) }); continue; }
    if (candidates[0]) columns[w.target] = candidates[0];
  }
  // a source column must not be used twice
  const usedSource = new Map();
  for (const [t, m] of Object.entries(columns)) { if (usedSource.has(m.source)) { ambiguous.push({ target: t, candidates: [m.source, usedSource.get(m.source)] }); delete columns[t]; delete columns[usedSource.get(m.source)]; } else usedSource.set(m.source, t); }
  const missing = wanted.filter((w) => !columns[w.target]).map((w) => w.target);
  const allExact = Object.values(columns).every((m) => m.confidence === 'exact');
  const status = missing.length || ambiguous.length ? 'incomplete' : sheetConfidence === 'exact' && allExact ? 'ready' : 'needs_confirmation';
  return { sheet: det.sheet, target, confidence: sheetConfidence, columns, missing, ambiguous, status, confirmed: false, headerRow: det.headerRow };
}

// ---------------- import ----------------
function typedKey(cell) {
  if (cell.kind === 'number') return String(cell.value);
  if (cell.kind === 'string') return cell.value;
  if (cell.kind === 'boolean') return String(cell.value);
  return null;
}

/**
 * Build a candidate content from a confirmed mapping. Returns {ok, issues, content, provenance, tablesImported, rowsImported}.
 * `report` is the server-side parsed workbook (never client-supplied).
 */
export function buildImport(report, mapping, baseDoc, fileMeta = {}) {
  const issues = [];
  const base = baseDoc.content;
  const content = clone(base);
  const detected = detectTables(report);
  const prov = { profile: PROFILE_ID, file: fileMeta, tables: {}, params: {} };
  let rowsImported = 0; let tablesImported = 0;
  const err = (code, message, extra) => issues.push(issue('error', code, message, extra));

  // workbook-level problems already block (formulas, macros...)
  for (const i of report.issues) if (i.severity === 'error') issues.push(i);

  if (!mapping || !Array.isArray(mapping.tables)) { err('NO_MAPPING', 'A mapping is required. Run inspect first and confirm each table mapping.'); return { ok: false, issues }; }
  const seenTargets = new Set();
  const mappedSheets = new Set((mapping.tables || []).map((t) => t.sheet));
  for (const sheet of report.sheets) {
    const up = sheet.name.toUpperCase();
    if (['README', 'META', 'NOTES', 'PARAMS'].includes(up)) continue;
    if (!mappedSheets.has(sheet.name) && !(mapping.ignoreSheets || []).includes(sheet.name)) issues.push(issue('warning', 'UNMAPPED_SHEET', `Sheet "${sheet.name}" is neither mapped nor ignored; its data was not imported.`, { sheet: sheet.name }));
  }

  for (const m of mapping.tables) {
    const tableDef = base.tables?.[m.target];
    if (!m.confirmed) { err('UNCONFIRMED_MAPPING', `Mapping of sheet "${m.sheet}" to ${m.target || '(none)'} has not been confirmed by a person.`, { sheet: m.sheet }); continue; }
    if (!tableDef) { err('UNKNOWN_TARGET', `Target table "${m.target}" is not part of ${baseDoc.id}. Only existing rate tables of the base version can be updated.`, { sheet: m.sheet }); continue; }
    if (seenTargets.has(m.target)) { err('AMBIGUOUS_MAPPING', `Table ${m.target} is mapped from more than one sheet.`, { sheet: m.sheet }); continue; }
    seenTargets.add(m.target);
    const det = detected.tables.find((t) => t.sheet === m.sheet);
    const grid = report.grids[m.sheet];
    if (!det || !grid) { err('MISSING_SHEET', `Sheet "${m.sheet}" was not found in the workbook.`, { sheet: m.sheet }); continue; }
    const wanted = tableColumns(tableDef);
    const colIndex = {}; let colOk = true;
    for (const w of wanted) {
      const src = m.columns?.[w.target];
      const srcName = typeof src === 'string' ? src : src?.source;
      const col = det.columns.find((c) => c.name === srcName);
      if (!srcName || !col) { err('MISSING_COLUMN', `Sheet "${m.sheet}": no source column mapped to ${m.target}.${w.target}${srcName ? ` (column "${srcName}" not found)` : ''}.`, { sheet: m.sheet }); colOk = false; } else colIndex[w.target] = col.index;
    }
    if (!colOk) continue;
    const newRows = []; const rowProv = [];
    for (let r = det.headerRow; r < grid.length; r++) {
      const row = grid[r];
      if (!row.some((c) => c.kind !== 'empty')) continue;
      const excelRow = r + 1; const out = {}; const cells = {}; let bad = false;
      for (const w of wanted) {
        const cell = row[colIndex[w.target]] || { kind: 'empty' };
        const at = addr(colIndex[w.target] + 1, excelRow);
        cells[w.target] = `${m.sheet}!${at}`;
        if (cell.kind === 'formula') { bad = true; continue; } // already reported as FORMULAS_UNSUPPORTED
        if (w.role === 'exact') {
          const k = typedKey(cell);
          if (k === null || k === '') { err('MISSING_KEY', `${m.sheet}!${at}: key "${w.target}" is empty.`, { sheet: m.sheet, cell: at }); bad = true; } else out[w.target] = k;
        } else if (w.role === 'range_min' || w.role === 'range_max') {
          if (cell.kind === 'empty') out[w.target] = null;
          else if (cell.kind === 'number') out[w.target] = cell.value;
          else { err('BAD_RANGE', `${m.sheet}!${at}: "${cell.value}" is not a number (range bound).`, { sheet: m.sheet, cell: at }); bad = true; }
        } else if (cell.kind === 'number') out.value = cell.value;
        else { err(cell.kind === 'empty' ? 'MISSING_VALUE' : 'NOT_NUMERIC', `${m.sheet}!${at}: ${cell.kind === 'empty' ? 'the rate value is missing' : `"${cell.value}" is not a number`}.`, { sheet: m.sheet, cell: at }); bad = true; }
      }
      if (!bad) { newRows.push(out); rowProv.push({ sheet: m.sheet, row: excelRow, cells }); }
    }
    if (!newRows.length) err('EMPTY_TABLE', `Sheet "${m.sheet}" produced no rows for ${m.target}.`, { sheet: m.sheet });
    else { content.tables[m.target].rows = newRows; prov.tables[m.target] = rowProv; tablesImported++; rowsImported += newRows.length; }
  }

  // PARAMS
  if (mapping.params?.sheet) {
    if (!mapping.params.confirmed) err('UNCONFIRMED_MAPPING', 'The PARAMS sheet mapping has not been confirmed.', { sheet: mapping.params.sheet });
    else {
      const grid = report.grids[mapping.params.sheet];
      const head = grid.findIndex((r) => r.some((c) => c.kind !== 'empty'));
      const header = (grid[head] || []).map((c) => norm(c.value));
      const kI = header.indexOf('key'); const vI = header.indexOf('value');
      if (kI < 0 || vI < 0) err('PARAMS_HEADER', 'PARAMS sheet needs "key" and "value" column headers.', { sheet: mapping.params.sheet });
      else for (let r = head + 1; r < grid.length; r++) {
        const k = grid[r][kI]; const v = grid[r][vI];
        if (!k || k.kind === 'empty') continue;
        const key = String(k.value); const at = addr(vI + 1, r + 1);
        if (!(key in (base.params || {}))) { err('UNKNOWN_PARAM', `PARAMS!${at}: "${key}" is not a parameter of ${baseDoc.id}.`, { sheet: mapping.params.sheet, cell: at }); continue; }
        const want = typeof base.params[key];
        if (want === 'number' && v.kind !== 'number') { err('NOT_NUMERIC', `PARAMS!${at}: parameter ${key} must be a number.`, { sheet: mapping.params.sheet, cell: at }); continue; }
        if (want === 'boolean' && v.kind !== 'boolean') { err('NOT_BOOLEAN', `PARAMS!${at}: parameter ${key} must be TRUE/FALSE.`, { sheet: mapping.params.sheet, cell: at }); continue; }
        if (want === 'string' && v.kind === 'empty') { err('MISSING_VALUE', `PARAMS!${at}: parameter ${key} is empty.`, { sheet: mapping.params.sheet, cell: at }); continue; }
        content.params[key] = v.value; prov.params[key] = { sheet: mapping.params.sheet, cell: `${mapping.params.sheet}!${at}` };
      }
    }
  }
  if (!tablesImported && !Object.keys(prov.params).length && !issues.some((i) => i.severity === 'error')) err('NOTHING_IMPORTED', 'The mapping did not import any table or parameter.');
  return { ok: !issues.some((i) => i.severity === 'error'), issues, content, provenance: prov, tablesImported, rowsImported };
}

// ---------------- template / export ----------------
const numericString = (s) => typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s);

export async function exportWorkbook(doc, { includeReadme = true } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RateGuard Pilot Quote Site (synthetic)';
  wb.created = new Date(doc.createdAt || '2025-01-01T00:00:00Z');
  wb.modified = wb.created;
  if (includeReadme) {
    const ws = wb.addWorksheet('README');
    [
      ['Pilot Rate Workbook Profile v1 (SYNTHETIC)'],
      ['This workbook was exported from the Pilot Quote Site. All numbers are invented demonstration values.'],
      [''],
      ['Rules of the profile'],
      ['• One sheet per rate table, named RT_<TABLE>. Row 1 holds column headers; data starts in row 2.'],
      ['• Exact keys use one column. Range keys use <name>_min (inclusive) and <name>_max (exclusive; leave blank for no upper bound).'],
      ['• The rate/factor goes in the "value" column and must be a plain number.'],
      ['• PARAMS holds scalar parameters as key/value pairs; only existing keys can be updated.'],
      ['• Formulas, macros, external links, merged cells and embedded objects are NOT supported and block import. Paste values.'],
      ['• Unknown sheets are never guessed; they must be mapped or ignored by a person.'],
    ].forEach((r) => ws.addRow(r));
    ws.getColumn(1).width = 110; ws.getRow(1).font = { bold: true, size: 14 };
  }
  const meta = wb.addWorksheet('META');
  [['profile', PROFILE_ID], ['productId', doc.productId], ['scope', doc.scope?.level], ['state', doc.scope?.state ?? ''], ['versionId', doc.id], ['effectiveFrom', doc.effectiveFrom], ['contentHash', doc.contentHash ?? ''], ['synthetic', 'true']].forEach((r) => meta.addRow(r));
  meta.getColumn(1).width = 18; meta.getColumn(2).width = 60;
  const params = wb.addWorksheet('PARAMS');
  params.addRow(['key', 'value', 'description']);
  for (const [k, v] of Object.entries(doc.content.params || {})) params.addRow([k, v, '']);
  styleHeader(params, 3);
  for (const [name, t] of Object.entries(doc.content.tables || {})) {
    const ws = wb.addWorksheet(`RT_${name}`.slice(0, 31));
    const cols = tableColumns(t);
    ws.addRow(cols.map((c) => c.target));
    for (const row of t.rows) ws.addRow(cols.map((c) => { const v = row[c.target]; if (v === null || v === undefined) return null; return numericString(v) ? Number(v) : v; }));
    styleHeader(ws, cols.length);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function styleHeader(ws, n) {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (let c = 1; c <= n; c++) ws.getColumn(c).width = 22;
}

// ---------------- workbook comparison ----------------
const same = (a, b) => a.kind === b.kind && a.value === b.value && (a.formula ?? null) === (b.formula ?? null);

export function compareWorkbooks(a, b, { maxChanges = 2000 } = {}) {
  const A = a.report; const B = b.report;
  const out = { a: { id: a.id, file: A.file }, b: { id: b.id, file: B.file }, sheetsAdded: [], sheetsRemoved: [], changes: [], truncated: false };
  const na = new Set(A.sheets.map((s) => s.name)); const nb = new Set(B.sheets.map((s) => s.name));
  out.sheetsAdded = [...nb].filter((n) => !na.has(n)); out.sheetsRemoved = [...na].filter((n) => !nb.has(n));
  for (const name of [...na].filter((n) => nb.has(n))) {
    const ga = A.grids[name] || []; const gb = B.grids[name] || [];
    const rows = Math.max(ga.length, gb.length); const cols = Math.max(ga[0]?.length ?? 0, gb[0]?.length ?? 0);
    const header = (gb[0] || ga[0] || []).map((c) => c?.value);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ca = ga[r]?.[c] ?? { kind: 'empty', value: null }; const cb = gb[r]?.[c] ?? { kind: 'empty', value: null };
        if (same(ca, cb)) continue;
        if (out.changes.length >= maxChanges) { out.truncated = true; return finish(out); }
        const rowKey = (gb[r] || ga[r] || []).slice(0, Math.max(1, Math.min(3, cols - 1))).map((x) => x?.value).filter((x) => x !== null && x !== undefined).join(' | ');
        out.changes.push({ sheet: name, cell: addr(c + 1, r + 1), column: header[c] ?? null, rowKey, before: ca.kind === 'empty' ? null : (ca.kind === 'formula' ? `=${ca.formula}` : ca.value), after: cb.kind === 'empty' ? null : (cb.kind === 'formula' ? `=${cb.formula}` : cb.value), kind: ca.kind === 'empty' ? 'added' : cb.kind === 'empty' ? 'removed' : 'changed' });
      }
    }
  }
  return finish(out);
}
function finish(out) { out.summary = { sheetsAdded: out.sheetsAdded.length, sheetsRemoved: out.sheetsRemoved.length, cellsChanged: out.changes.length }; return out; }
