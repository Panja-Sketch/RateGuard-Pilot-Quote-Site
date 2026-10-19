// XLSX workbench glue: upload/inspect, mapping preview, import-as-draft with provenance, compare, export.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, isPlainObject } from '../engine/util.js';
import { parseWorkbook, detectTables, PROFILE_ID } from '../xlsx/profile.js';
import { suggestMapping, buildImport, exportWorkbook, compareWorkbooks } from '../xlsx/importer.js';
import { diffContent } from '../engine/diff.js';

export class WorkbookService {
  constructor(ctx) { this.ctx = ctx; }
  get store() { return this.ctx.store; }
  get blobs() { return this.ctx.blobs; }

  async nextId() {
    const seq = ((await this.store.get('meta', 'workbook-seq'))?.n ?? 0) + 1;
    await this.store.put('meta', { id: 'workbook-seq', n: seq });
    return `WB-${String(seq).padStart(4, '0')}`;
  }

  async upload(actor, { fileName, buffer }) {
    const name = String(fileName || 'workbook.xlsx').replace(/[^\w.\- ]/g, '_').slice(0, 120);
    const report = await parseWorkbook(buffer, name);
    const rec = {
      id: await this.nextId(), fileName: name, size: report.file.size, sha256: report.file.sha256,
      uploadedAt: this.ctx.clock().toISOString(), uploadedBy: actor.id, profile: PROFILE_ID,
      accepted: report.safety.ok, issueCounts: countIssues(report.issues),
    };
    if (report.safety.ok) { await this.blobs.put(report.file.sha256, buffer); rec.meta = detectTables(report).meta; }
    await this.store.put('workbooks', rec);
    await this.ctx.audit.record(actor, report.safety.ok ? 'WORKBOOK_UPLOADED' : 'WORKBOOK_REJECTED', { type: 'workbook', id: rec.id }, `${report.safety.ok ? 'Uploaded' : 'Rejected unsafe/unsupported'} workbook ${name} (${rec.size} bytes, sha256 ${String(rec.sha256).slice(0, 12)}…)`, { issues: rec.issueCounts, safetyFindings: report.safety.findings.filter((f) => f.severity === 'error').map((f) => f.code) });
    return { workbook: rec, report: publicReport(report) };
  }

  async load(id) {
    const rec = await this.store.get('workbooks', id);
    if (!rec) throw new HttpError(404, 'NOT_FOUND', `Workbook ${id} was not found.`);
    if (!rec.accepted) throw new HttpError(422, 'WORKBOOK_REJECTED', `Workbook ${id} was rejected at upload and is not retained.`);
    const buf = await this.blobs.get(rec.sha256);
    if (!buf) throw new HttpError(410, 'BLOB_MISSING', 'The stored workbook file is no longer available.');
    const report = await parseWorkbook(buf, rec.fileName);
    return { rec, report, buf };
  }

  async baseFor(rec, baseVersionId) {
    let id = baseVersionId;
    if (!id && rec.meta?.versionId) id = rec.meta.versionId;
    if (!id) throw new HttpError(400, 'BASE_REQUIRED', 'Choose the base version the workbook should update (baseVersionId).');
    const doc = await this.ctx.versions.mustGet(id);
    if (doc.kind !== 'rating') throw new HttpError(400, 'BAD_BASE', 'The base must be a rating version.');
    return doc;
  }

  async inspect(id, baseVersionId) {
    const { rec, report } = await this.load(id);
    const base = await this.baseFor(rec, baseVersionId);
    const hints = await this.ctx.feedback.activeHints(base.productId);
    const detected = detectTables(report);
    const warnings = [];
    if (detected.meta?.productId && detected.meta.productId !== base.productId) warnings.push(issue('warning', 'META_PRODUCT_MISMATCH', `The workbook META says product "${detected.meta.productId}" but the base version is for "${base.productId}".`));
    if (detected.meta?.profile && detected.meta.profile !== PROFILE_ID) warnings.push(issue('warning', 'META_PROFILE_MISMATCH', `The workbook declares profile "${detected.meta.profile}"; this pilot supports "${PROFILE_ID}" only.`));
    return { workbook: rec, base: { id: base.id, productId: base.productId, scope: base.scope, status: base.status }, report: publicReport(report), detected, suggestedMapping: suggestMapping(report, base, hints), hints: hints.length, warnings };
  }

  async preview(id, mapping, baseVersionId) {
    const { rec, report } = await this.load(id);
    const base = await this.baseFor(rec, baseVersionId);
    const built = buildImport(report, mapping, base, { workbookId: rec.id, name: rec.fileName, sha256: rec.sha256 });
    const out = { baseVersionId: base.id, ok: built.ok, issues: built.issues, tablesImported: built.tablesImported ?? 0, rowsImported: built.rowsImported ?? 0 };
    if (built.content) {
      const d = diffContent(base.content, built.content);
      out.diff = d;
      const candidate = { ...base, id: 'candidate', status: 'draft', content: built.content, basedOn: base.id };
      out.validation = await this.ctx.versions.validateDocument(candidate);
    }
    return out;
  }

  async importDraft(actor, id, { mapping, baseVersionId, label, effectiveFrom, changeTicket }) {
    const { rec, report } = await this.load(id);
    const base = await this.baseFor(rec, baseVersionId);
    if (!isPlainObject(mapping)) throw new HttpError(400, 'BAD_REQUEST', 'mapping is required.');
    const built = buildImport(report, mapping, base, { workbookId: rec.id, name: rec.fileName, sha256: rec.sha256 });
    if (!built.ok) throw new HttpError(422, 'IMPORT_BLOCKED', 'The workbook cannot be imported. Fix the listed issues; nothing was guessed.', built.issues);
    const draft = await this.ctx.versions.createDraft(actor, {
      productId: base.productId, scope: base.scope, fromVersionId: base.id, content: built.content, provenance: built.provenance,
      label: label || `XLSX import from ${rec.fileName}`, effectiveFrom: effectiveFrom || base.effectiveFrom, changeTicket: changeTicket || null,
      source: { type: 'xlsx', workbookId: rec.id, fileName: rec.fileName, sha256: rec.sha256, profile: PROFILE_ID, mappingConfirmedBy: actor.id },
    });
    await this.ctx.audit.record(actor, 'WORKBOOK_IMPORTED', { type: 'workbook', id: rec.id }, `Imported ${rec.fileName} into draft ${draft.id}: ${built.tablesImported} table(s), ${built.rowsImported} row(s)`, { draftId: draft.id, baseVersionId: base.id, tables: Object.keys(built.provenance.tables) });
    // corrected mappings are captured as reviewable feedback; they do not alter anything by themselves
    const captured = [];
    for (const t of mapping.tables || []) {
      for (const [target, col] of Object.entries(t.columns || {})) {
        if (col && typeof col === 'object' && col.corrected === true) {
          captured.push(await this.ctx.feedback.create(actor, { type: 'mapping_correction', productId: base.productId, versionId: draft.id, comment: 'Captured automatically when the mapping suggestion was changed during import.', payload: { sourceSheet: t.sheet, sourceColumn: col.source, targetTable: t.target, targetColumn: target } }));
        }
      }
    }
    return { draft, tablesImported: built.tablesImported, rowsImported: built.rowsImported, warnings: built.issues.filter((i) => i.severity !== 'error'), feedbackCaptured: captured.map((f) => f.id) };
  }

  async compare(aId, bId) {
    const a = await this.load(aId); const b = await this.load(bId);
    return compareWorkbooks({ id: aId, report: a.report }, { id: bId, report: b.report });
  }

  async exportVersion(versionId) {
    const doc = await this.ctx.versions.mustGet(versionId);
    if (doc.kind !== 'rating') throw new HttpError(400, 'BAD_REQUEST', 'Only rating versions can be exported to the workbook profile.');
    return { doc, buffer: await exportWorkbook(doc) };
  }

  async list() { return (await this.store.list('workbooks')).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)); }

  samplesDir() { return path.resolve(this.ctx.samplesDir || 'samples'); }
  listSamples() {
    const dir = this.samplesDir();
    if (!fs.existsSync(dir)) return [];
    const readme = path.join(dir, 'MANIFEST.json');
    const manifest = fs.existsSync(readme) ? JSON.parse(fs.readFileSync(readme, 'utf8')) : {};
    return fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx')).sort().map((f) => ({ file: f, size: fs.statSync(path.join(dir, f)).size, ...(manifest[f] || {}) }));
  }
  readSample(file) {
    if (!/^[\w.\- ]+\.xlsx$/.test(file)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid sample file name.');
    const p = path.join(this.samplesDir(), file);
    if (!fs.existsSync(p)) throw new HttpError(404, 'NOT_FOUND', 'Sample not found.');
    return fs.readFileSync(p);
  }
}

const issue = (severity, code, message) => ({ severity, code, message });
function countIssues(issues) { const c = { error: 0, warning: 0, info: 0 }; for (const i of issues) c[i.severity] = (c[i.severity] || 0) + 1; return c; }
export function publicReport(report) {
  const { grids, ...rest } = report;
  return { ...rest, sheets: report.sheets };
}
