// Builds the synthetic sample workbooks shipped in ./samples (and used by the tests).
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { exportWorkbook } from './importer.js';
import { paNational } from '../seed/rating-pa.js';
import { hoNational } from '../seed/rating-ho.js';
import { cpNational } from '../seed/rating-cp.js';
import { bopNational } from '../seed/rating-bop.js';
import { applyRateChange, applySilentDefect, applyStructuralDefect } from '../seed/defects.js';
import { clone } from '../engine/util.js';

const NAT = { 'personal-auto': ['PA', paNational], homeowners: ['HO', hoNational], 'commercial-property': ['CP', cpNational], bop: ['BOP', bopNational] };

const docFor = (productId, content, label) => ({ id: `${NAT[productId][0]}-NAT-v2`, productId, scope: { level: 'national' }, effectiveFrom: '2026-07-01', createdAt: '2026-06-15T09:00:00.000Z', content, label });

async function withExtraEntry(buffer, name, data) {
  const zip = await JSZip.loadAsync(buffer);
  zip.file(name, data);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

export async function buildSamples() {
  const out = new Map();
  const put = (file, buffer, description, expect) => out.set(file, { buffer, description, expect });

  // 1) templates: current national v2 of every product
  for (const [productId, [abbr, fn]] of Object.entries(NAT)) {
    put(`${abbr}_NAT_v2_current.xlsx`, await exportWorkbook(docFor(productId, fn(2))), `Template / baseline: the current synthetic national rate tables for ${productId} in Pilot Rate Workbook Profile v1. Importing it unchanged produces no changes.`, 'imports cleanly; zero changes');
  }
  // 2) normal rate change (HO + PA)
  for (const productId of ['homeowners', 'personal-auto']) {
    const [abbr, fn] = NAT[productId];
    put(`${abbr}_NAT_rate_change_plus4pct.xlsx`, await exportWorkbook(docFor(productId, applyRateChange(productId, fn(2), 4))), `Normal synthetic rate change: base rates +4.0% for ${productId}.`, 'imports cleanly; validates; base-rate rows change by +4%');
  }
  // 3) silent + structural defects (HO + PA)
  for (const productId of ['homeowners', 'personal-auto']) {
    const [abbr, fn] = NAT[productId];
    const sd = applySilentDefect(productId, fn(2));
    put(`${abbr}_NAT_defect_silent.xlsx`, await exportWorkbook(docFor(productId, sd.content)), `INTENTIONAL DEFECT (silent): ${sd.note.change}. Structurally valid, so the pilot's own validation passes it (with an impact warning).`, 'imports; validates; one table row changed');
    const st = applyStructuralDefect(productId, fn(2));
    put(`${abbr}_NAT_defect_structural.xlsx`, await exportWorkbook(docFor(productId, st.content)), `INTENTIONAL DEFECTS (structural): ${st.notes.join('; ')}.`, 'imports as a draft but FAILS validation');
  }
  // 4) unsupported formulas (HO)
  {
    const wb = new ExcelJS.Workbook();
    const base = hoNational(2);
    const ws = wb.addWorksheet('RT_ROOF_AGE');
    ws.addRow(['age_min', 'age_max', 'value']);
    base.tables.ROOF_AGE.rows.forEach((r, i) => { ws.addRow([r.age_min, r.age_max, i === 3 ? { formula: 'C4*1.04', result: Math.round(r.value * 1.04 * 1000) / 1000 } : r.value]); });
    put('HO_NAT_unsupported_formulas.xlsx', Buffer.from(await wb.xlsx.writeBuffer()), 'A value cell contains a formula (=C4*1.04). Formulas are never executed or guessed.', 'import BLOCKED: FORMULAS_UNSUPPORTED');
  }
  // 5) renamed columns needing confirmation (HO)
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Roof Age');
    ws.addRow(['Age From', 'Age To', 'Factor']);
    hoNational(2).tables.ROOF_AGE.rows.forEach((r) => ws.addRow([r.age_min, r.age_max, r.value]));
    const notes = wb.addWorksheet('Notes from actuary');
    notes.addRow(['Free text that must never be guessed into rates.']);
    put('HO_NAT_renamed_columns.xlsx', Buffer.from(await wb.xlsx.writeBuffer()), 'Non-profile layout: sheet "Roof Age" with headers "Age From/Age To/Factor". The pilot SUGGESTS a mapping but a person must confirm it.', 'suggestions need confirmation; correcting a suggestion is captured as feedback');
  }
  // 6) ambiguous columns + missing value (HO)
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Roof Age');
    ws.addRow(['age_min', 'age_max', 'factor', 'relativity']);
    hoNational(2).tables.ROOF_AGE.rows.forEach((r, i) => ws.addRow([r.age_min, r.age_max, r.value, i === 2 ? null : r.value]));
    const w2 = wb.addWorksheet('Mystery');
    w2.addRow(['thing', 'amount']); w2.addRow(['x', 12]);
    put('HO_NAT_ambiguous_columns.xlsx', Buffer.from(await wb.xlsx.writeBuffer()), 'Two candidate value columns ("factor" and "relativity"), one blank cell, and an unrecognised sheet. Nothing is guessed.', 'ambiguous mapping flagged; MISSING_VALUE; unmapped sheet warning');
  }
  // 7) unsafe files (built from a valid workbook by adding forbidden parts)
  {
    const valid = await exportWorkbook(docFor('homeowners', hoNational(2)));
    put('UNSAFE_macro_parts.xlsx', await withExtraEntry(valid, 'xl/vbaProject.bin', Buffer.from('not-real-macro-bytes')), 'A valid workbook with an embedded macro part added. Always rejected; never opened by the spreadsheet parser.', 'REJECTED at upload: MACROS');
    put('UNSAFE_external_link.xlsx', await withExtraEntry(valid, 'xl/externalLinks/externalLink1.xml', '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'), 'A valid workbook with an external link part added. Links are never followed.', 'REJECTED at upload: EXTERNAL_LINKS');
  }
  return out;
}

export { clone };
