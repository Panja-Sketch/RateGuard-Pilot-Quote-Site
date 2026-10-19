// XLSX workbench: upload -> inspect -> map (human-confirmed) -> preview -> import as draft.
import { h, mount, notice, toast, spinner, downloadBlob } from '../../lib/dom.js';
import { api, can } from '../../lib/api.js';
import { wbLayout } from './index.js';
import { renderDiff, renderReport, stat } from './report.js';
import { when, shortHash } from '../../lib/format.js';

const CONF = { exact: ['ok', 'exact'], hint: ['info', 'reviewed hint'], normalized: ['warn', 'normalized'], pattern: ['warn', 'pattern'], synonym: ['warn', 'synonym'], suggested: ['warn', 'suggested'] };

function tableColumns(table) {
  const cols = [];
  for (const k of table.keys) { if (k.kind === 'range') cols.push({ target: `${k.name}_min`, label: `${k.name} (min, inclusive)` }, { target: `${k.name}_max`, label: `${k.name} (max, exclusive)` }); else cols.push({ target: k.name, label: k.name }); }
  cols.push({ target: 'value', label: 'value' });
  return cols;
}

export async function xlsxPage() {
  const { versions } = await api.get('/rating-versions');
  const writable = can('workbook:write');
  const S = { wb: null, uploadReport: null, baseId: '', inspection: null, mapping: null, baseDoc: null, preview: null };
  const stage = h('div');
  const compareBox = h('div');
  const listBox = h('div');

  // ---------------- templates & samples ----------------
  async function download(fetchBlob, name) { try { downloadBlob(await fetchBlob(), name); } catch (e) { toast(e.message, 'bad'); } }
  async function samplesCard() {
    const { samples } = await api.get('/workbooks/samples');
    const nat = versions.filter((v) => v.scope.level === 'national' && v.status === 'active');
    return h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' }, h('h3', null, 'Documented workbook profile'),
        h('ul', { style: { margin: '0 0 0 1.1rem', padding: 0 } },
          h('li', null, h('strong', null, 'One sheet per rate table'), ', named ', h('span', { class: 'inline-code' }, 'RT_<TABLE>'), '; header in row 1.'),
          h('li', null, 'Exact keys: one column. Range keys: ', h('span', { class: 'inline-code' }, '<name>_min'), ' (inclusive) and ', h('span', { class: 'inline-code' }, '<name>_max'), ' (exclusive; blank = no bound).'),
          h('li', null, 'Rates go in ', h('span', { class: 'inline-code' }, 'value'), ' as plain numbers. ', h('span', { class: 'inline-code' }, 'PARAMS'), ' updates existing parameters only.'),
          h('li', null, 'Formulas, macros, external links, OLE objects, merged cells and unknown sheets are flagged — never executed or guessed.')),
        h('p', { class: 'small muted', style: { marginTop: '.6rem' } }, 'Support is for this documented profile, not every arbitrary insurer workbook. Anything else is flagged for a person to map or ignore.'),
        h('p', { class: 'small' }, 'Export a current version as a template:'),
        h('div', { class: 'row' }, nat.map((v) => h('button', { class: 'btn btn-sm', onclick: () => download(() => api.blob(`/rating-versions/${v.id}/export.xlsx`), `${v.id}.xlsx`) }, v.id)))),
      h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Synthetic sample workbooks')),
        h('div', { class: 'scroll-y', style: { maxHeight: '320px' } }, h('table', { class: 't' }, h('tbody', null, samples.map((s) => h('tr', null, h('td', null, h('strong', { class: 'mono small' }, s.file), h('div', { class: 'small muted' }, s.description), s.expect ? h('div', { class: 'small' }, '→ ', s.expect) : null),
          h('td', { class: 'nowrap' }, h('button', { class: 'btn btn-sm', onclick: () => download(() => api.blob(`/workbooks/samples/${s.file}`), s.file) }, 'Download'), ' ', writable ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => useSample(s.file) }, 'Use') : null))))))));
  }

  // ---------------- step 1: upload ----------------
  async function useSample(file) {
    try { const blob = await api.blob(`/workbooks/samples/${file}`); await upload(new Uint8Array(await blob.arrayBuffer()), file); } catch (e) { toast(e.message, 'bad'); }
  }
  async function upload(bytes, name) {
    mount(stage, h('div', { class: 'empty' }, spinner(), ' Scanning and reading the workbook…'));
    try {
      const out = await api.upload('/workbooks', bytes, name);
      S.wb = out.workbook; S.uploadReport = out.report; S.inspection = null; S.mapping = null; S.preview = null;
      S.baseId = out.workbook.meta?.versionId && versions.some((v) => v.id === out.workbook.meta.versionId) ? out.workbook.meta.versionId : '';
      drawUpload(); loadList();
    } catch (e) { mount(stage, notice('bad', e.message)); }
  }
  function drawUpload() {
    const r = S.uploadReport; const wb = S.wb;
    const issues = r.issues.filter((i) => i.severity !== 'info');
    mount(stage,
      h('div', { class: 'card' }, h('h3', null, `Workbook ${wb.id}: ${wb.fileName}`),
        h('dl', { class: 'kv' }, h('dt', null, 'Size'), h('dd', null, `${wb.size.toLocaleString()} bytes`), h('dt', null, 'SHA-256'), h('dd', { class: 'mono' }, wb.sha256 ?? '—')),
        wb.accepted ? notice('ok', 'Safety scan passed: no macros, external links, embedded objects or data connections. The file was read as data only.') : notice('bad', h('strong', null, 'Rejected. '), 'This file was not opened by the spreadsheet parser and is not stored.'),
        issues.length ? h('div', { class: 'notice warn' }, h('strong', null, `Findings (${issues.length})`), h('ul', null, issues.map((i) => h('li', null, h('span', { class: `badge ${i.severity === 'error' ? 'bad' : 'warn'}`, style: { marginRight: '.4rem' } }, i.code), i.message)))) : null,
        wb.accepted ? sheetsTable(r.sheets) : null),
      wb.accepted ? basePicker() : null);
  }
  function sheetsTable(sheets) {
    return h('div', { class: 'scroll-x' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Sheet', 'Visibility', 'Rows', 'Columns', 'Formula cells', 'Merged ranges'].map((c) => h('th', null, c)))),
      h('tbody', null, sheets.map((s) => h('tr', null, h('td', { class: 'mono' }, s.name), h('td', null, s.state), h('td', null, s.rows), h('td', null, s.cols), h('td', null, s.formulas.count ? h('span', { class: 'badge bad' }, s.formulas.count) : '0'), h('td', null, s.mergedRanges || 0))))));
  }
  function basePicker() {
    const sel = h('select', { 'aria-label': 'Base version', onchange: (e) => { S.baseId = e.target.value; } },
      h('option', { value: '' }, 'Choose the version this workbook updates…'),
      versions.slice().sort((a, b) => (a.productId + a.id).localeCompare(b.productId + b.id)).map((v) => h('option', { value: v.id, selected: v.id === S.baseId }, `${v.id} — ${v.label} [${v.status}]`)));
    return h('div', { class: 'card' }, h('h3', null, '2. Choose the base version and inspect'),
      h('p', { class: 'muted' }, 'The import creates a new DRAFT from the base version, replacing only the tables and parameters you map. Nothing is activated.'), h('div', { class: 'row' }, sel, h('button', { class: 'btn btn-primary', onclick: inspect }, 'Inspect & suggest mapping')));
  }

  // ---------------- step 2/3: inspect + mapping ----------------
  async function inspect() {
    if (!S.baseId) { toast('Choose a base version first.', 'bad'); return; }
    try {
      const ins = await api.post(`/workbooks/${S.wb.id}/inspect`, { baseVersionId: S.baseId });
      S.inspection = ins; S.mapping = JSON.parse(JSON.stringify(ins.suggestedMapping));
      S.baseDoc = (await api.get(`/rating-versions/${S.baseId}`)).version;
      S.mapping.tables.forEach((t) => { t.suggested = JSON.parse(JSON.stringify(t.columns)); });
      S.preview = null; drawMapping();
    } catch (e) { toast(e.message, 'bad'); }
  }

  function drawMapping() {
    const ins = S.inspection; const m = S.mapping;
    const targets = Object.keys(S.baseDoc.content.tables || {});
    const det = (sheet) => ins.detected.tables.find((t) => t.sheet === sheet);
    const mappedSheets = new Set(m.tables.map((t) => t.sheet));
    const unmapped = ins.detected.tables.filter((t) => !mappedSheets.has(t.sheet) && !(m.ignoreSheets || []).includes(t.sheet));

    const tableCard = (t, idx) => {
      const d = det(t.sheet);
      const def = S.baseDoc.content.tables[t.target];
      const cols = def ? tableColumns(def) : [];
      const conf = CONF[t.confidence] || ['warn', t.confidence];
      return h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('div', null, h('strong', { class: 'mono' }, t.sheet), ' → ',
          h('select', { 'aria-label': `Target table for ${t.sheet}`, onchange: (e) => retarget(idx, e.target.value) }, h('option', { value: '' }, '— ignore this sheet —'), targets.map((n) => h('option', { value: n, selected: n === t.target }, n))),
          ' ', h('span', { class: `badge ${conf[0]}` }, `sheet match: ${conf[1]}`)),
          h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!t.confirmed, onchange: (e) => { t.confirmed = e.target.checked; } }), h('span', null, 'I confirm this mapping'))),
        t.ambiguous?.length ? notice('warn', 'Ambiguous: ', t.ambiguous.map((a) => `${a.target} could be ${a.candidates.join(' or ')}`).join('; '), '. Choose explicitly below.') : null,
        h('table', { class: 't' }, h('thead', null, h('tr', null, ['Target column', 'Source column (from your sheet)', 'Match'].map((c) => h('th', null, c)))),
          h('tbody', null, cols.map((c) => {
            const cur = t.columns[c.target];
            const sel = h('select', { 'aria-label': `Source for ${c.target}`, onchange: (e) => { const v = e.target.value; if (!v) delete t.columns[c.target]; else t.columns[c.target] = { source: v, confidence: 'exact', corrected: t.suggested?.[c.target]?.source !== v }; drawMapping(); } },
              h('option', { value: '' }, '— not mapped —'), (d?.columns || []).map((x) => h('option', { value: x.name, selected: cur?.source === x.name }, `${x.name}${x.kind === 'numeric' ? '  (numbers)' : ''}`)));
            return h('tr', null, h('td', { class: 'mono' }, c.label), h('td', null, sel), h('td', null, cur ? h('span', { class: `badge ${cur.corrected ? 'info' : CONF[cur.confidence]?.[0]}` }, cur.corrected ? 'your correction' : (CONF[cur.confidence]?.[1] || cur.confidence)) : h('span', { class: 'badge bad' }, 'missing')));
          }))));
    };
    function retarget(idx, target) {
      const t = m.tables[idx];
      if (!target) { m.ignoreSheets = [...(m.ignoreSheets || []), t.sheet]; m.tables.splice(idx, 1); drawMapping(); return; }
      t.target = target; t.confidence = 'suggested'; t.confirmed = false; t.columns = {}; t.ambiguous = [];
      drawMapping();
    }
    mount(stage, ...uploadHeader(),
      h('div', { class: 'card' }, h('h3', null, '3. Review the mapping'),
        notice('info', 'Suggestions are NOT applied automatically. Confirm every table, and pick source columns yourself where the match is not exact. Corrections you make are saved as reviewable feedback with this import.'),
        ins.warnings?.map((w) => notice('warn', w.message)),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { m.tables.forEach((t) => { if (t.status === 'ready') t.confirmed = true; }); if (m.params) m.params.confirmed = true; drawMapping(); } }, 'Confirm exact matches'),
          h('span', { class: 'small muted' }, `${m.tables.filter((t) => t.confirmed).length}/${m.tables.length} tables confirmed`))),
      m.tables.map(tableCard),
      unmapped.length ? h('div', { class: 'card' }, h('h4', null, 'Sheets that were not mapped (never guessed)'), unmapped.map((u) => h('div', { class: 'row', style: { marginBottom: '.4rem' } }, h('strong', { class: 'mono' }, u.sheet), h('span', { class: 'small muted' }, `columns: ${u.columns.map((c) => c.name).join(', ')}`),
        h('select', { 'aria-label': `Map ${u.sheet}`, onchange: (e) => { if (e.target.value === '__ignore') (m.ignoreSheets ||= []).push(u.sheet); else if (e.target.value) m.tables.push({ sheet: u.sheet, target: e.target.value, confidence: 'suggested', columns: {}, confirmed: false, suggested: {} }); drawMapping(); } },
          h('option', { value: '' }, 'Map to table…'), targets.map((n) => h('option', { value: n }, n)), h('option', { value: '__ignore' }, '— ignore this sheet —'))))) : null,
      m.params ? h('div', { class: 'card' }, h('div', { class: 'row between' }, h('div', null, h('strong', { class: 'mono' }, m.params.sheet), ' → parameters of the base version (existing keys only)'), h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!m.params.confirmed, onchange: (e) => { m.params.confirmed = e.target.checked; } }), h('span', null, 'I confirm')))) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: previewImport }, '4. Preview changes')));
  }
  const uploadHeader = () => [h('div', { class: 'card' }, h('strong', null, `${S.wb.id} · ${S.wb.fileName}`), ' ', h('span', { class: 'small muted' }, `base ${S.baseId} · sha256 ${shortHash(S.wb.sha256)}`), sheetsTable(S.uploadReport.sheets))];

  // ---------------- step 4/5: preview + import ----------------
  async function previewImport() {
    try {
      const m = JSON.parse(JSON.stringify(S.mapping));
      m.tables = m.tables.map((t) => ({ sheet: t.sheet, target: t.target, confirmed: !!t.confirmed, columns: Object.fromEntries(Object.entries(t.columns).map(([k, v]) => [k, { source: v.source, corrected: !!v.corrected }])) }));
      S.sendMapping = m;
      const p = await api.post(`/workbooks/${S.wb.id}/preview`, { mapping: m, baseVersionId: S.baseId });
      S.preview = p; drawPreview();
    } catch (e) { toast(e.message, 'bad'); }
  }
  function drawPreview() {
    const p = S.preview;
    const errs = p.issues.filter((i) => i.severity === 'error'); const warns = p.issues.filter((i) => i.severity !== 'error');
    const label = h('input', { type: 'text', value: `XLSX import: ${S.wb.fileName}`, 'aria-label': 'Draft label' });
    const date = h('input', { type: 'date', value: S.baseDoc.effectiveFrom > '2026-12-01' ? S.baseDoc.effectiveFrom : '2026-12-01', 'aria-label': 'Effective date' });
    const tref = h('input', { type: 'text', placeholder: 'SYN-…', 'aria-label': 'Ticket reference' }); const ttext = h('textarea', { rows: 2, style: { fontFamily: 'inherit' }, 'aria-label': 'Ticket text', placeholder: 'Change description (stored, not analysed)' });
    const err = h('div');
    previewBox.replaceChildren(
      h('h3', null, '4. Preview'),
      p.ok ? notice('ok', `Import is possible: ${p.tablesImported} table(s), ${p.rowsImported} row(s).`) : notice('bad', h('strong', null, 'Import is blocked. '), 'Nothing was guessed. Fix the workbook or the mapping.'),
      errs.length ? h('div', { class: 'notice bad' }, h('strong', null, `Errors (${errs.length})`), h('ul', null, errs.slice(0, 40).map((i) => h('li', null, h('span', { class: 'badge', style: { marginRight: '.4rem' } }, i.code), i.message)))) : null,
      warns.length ? h('div', { class: 'notice warn' }, h('strong', null, `Warnings (${warns.length})`), h('ul', null, warns.map((i) => h('li', null, h('span', { class: 'badge', style: { marginRight: '.4rem' } }, i.code), i.message)))) : null,
      p.diff ? h('div', null, h('h4', null, `Changes versus ${S.baseId}`), renderDiff(p.diff)) : null,
      p.validation ? h('div', null, h('h4', null, 'Validation of the would-be draft'), renderReport(p.validation)) : null,
      p.ok && writable ? h('div', { class: 'card' }, h('h3', null, '5. Import as a draft'), notice('info', 'This creates a new draft with the source file and cell provenance attached. It still needs validation, submission and a different person\'s approval.'),
        h('div', { class: 'fields-grid' }, h('div', { class: 'field' }, h('label', null, 'Draft label'), label), h('div', { class: 'field' }, h('label', null, 'Effective date'), date), h('div', { class: 'field' }, h('label', null, 'Ticket reference'), tref), h('div', { class: 'field' }, h('label', null, 'Ticket text'), ttext)), err,
        h('button', { class: 'btn btn-primary', onclick: async () => {
          try {
            const out = await api.post(`/workbooks/${S.wb.id}/import`, { mapping: S.sendMapping, baseVersionId: S.baseId, label: label.value, effectiveFrom: date.value, changeTicket: tref.value || ttext.value ? { reference: tref.value || null, text: ttext.value || null } : undefined });
            previewBox.replaceChildren(notice('ok', h('strong', null, `Draft ${out.draft.id} created. `), `${out.tablesImported} table(s), ${out.rowsImported} row(s) with cell provenance.`, out.feedbackCaptured.length ? ` ${out.feedbackCaptured.length} corrected mapping(s) were captured as feedback for review.` : ''), h('a', { class: 'btn btn-primary', href: `#/wb/v/${out.draft.id}` }, 'Open the draft'));
          } catch (e) { err.replaceChildren(notice('bad', e.message, e.details ? h('ul', null, e.details.slice(0, 10).map((d) => h('li', null, d.message))) : null)); }
        } }, 'Create draft')) : null);
  }
  const previewBox = h('div');

  // ---------------- compare workbooks ----------------
  async function loadList() {
    const { workbooks } = await api.get('/workbooks');
    const ok = workbooks.filter((w) => w.accepted);
    const a = h('select', { 'aria-label': 'Workbook A' }, ok.map((w) => h('option', { value: w.id }, `${w.id} · ${w.fileName}`))); const b = h('select', { 'aria-label': 'Workbook B' }, ok.map((w, i) => h('option', { value: w.id, selected: i === 0 }, `${w.id} · ${w.fileName}`)));
    const out = h('div');
    mount(compareBox, h('div', { class: 'card' }, h('h3', null, 'Compare two uploaded workbooks'), ok.length >= 2 ? h('div', null, h('div', { class: 'row' }, a, '→', b, h('button', { class: 'btn', onclick: async () => {
      try {
        const r = await api.post('/workbooks/compare', { a: a.value, b: b.value });
        mount(out, h('div', { class: 'grid grid-4', style: { margin: '.6rem 0' } }, stat(r.summary.cellsChanged, 'cells changed'), stat(r.summary.sheetsAdded, 'sheets added'), stat(r.summary.sheetsRemoved, 'sheets removed'), stat(r.truncated ? 'yes' : 'no', 'truncated')),
          r.changes.length ? h('div', { class: 'scroll-y' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Sheet', 'Cell', 'Column', 'Row', 'Before', 'After'].map((c) => h('th', null, c)))), h('tbody', null, r.changes.map((c) => h('tr', null, h('td', { class: 'mono' }, c.sheet), h('td', { class: 'mono' }, c.cell), h('td', null, String(c.column ?? '')), h('td', { class: 'small' }, c.rowKey), h('td', null, String(c.before ?? '—')), h('td', null, h('strong', null, String(c.after ?? '—')))))))) : notice('ok', 'The workbooks are identical.'));
      } catch (e) { mount(out, notice('bad', e.message)); }
    } }, 'Compare')), out) : h('p', { class: 'muted' }, 'Upload at least two accepted workbooks to compare them cell by cell.')));
    mount(listBox, h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Uploaded workbooks')),
      workbooks.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, ['ID', 'File', 'Uploaded', 'By', 'Result'].map((c) => h('th', null, c)))), h('tbody', null, workbooks.slice(0, 20).map((w) => h('tr', null, h('td', null, w.id), h('td', null, w.fileName), h('td', { class: 'small' }, when(w.uploadedAt)), h('td', null, w.uploadedBy), h('td', null, h('span', { class: `badge ${w.accepted ? 'ok' : 'bad'}` }, w.accepted ? 'accepted' : 'rejected')))))) : h('div', { class: 'empty' }, 'None yet.')));
  }

  const file = h('input', { type: 'file', accept: '.xlsx', 'aria-label': 'Choose an .xlsx file', onchange: async (e) => { const f = e.target.files[0]; if (f) await upload(new Uint8Array(await f.arrayBuffer()), f.name); } });
  const root = h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'XLSX import'), h('p', null, 'Bring approved rate tables in from a documented workbook profile — with mapping you confirm, cell-level provenance and a diff before anything becomes a draft.'))),
    await samplesCard(),
    writable ? h('div', { class: 'card' }, h('h3', null, '1. Upload'), h('p', { class: 'muted' }, 'Use only synthetic workbooks. Files are scanned before parsing; unsafe features are rejected, not repaired.'), file) : notice('info', 'Your role can inspect but not upload.'),
    stage, previewBox, compareBox, listBox);
  await loadList();
  return wbLayout('#/wb/xlsx', root);
}
