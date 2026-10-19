// Repository interface used by every service. All methods are async so the same services can run
// on Firestore later (see docs/GOOGLE_CLOUD.md). Two local backends are provided:
//   MemoryStore – tests / ephemeral demo
//   FileStore   – JSON file under ./data (default for local development)
import fs from 'node:fs';
import path from 'node:path';
import { clone } from '../engine/util.js';

export const COLLECTIONS = ['products', 'documents', 'audit', 'submissions', 'quotes', 'workbooks', 'feedback', 'hints', 'scenarioRuns', 'meta'];

export class MemoryStore {
  constructor() { this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])); }
  async get(col, id) { const v = this.data[col].get(id); return v === undefined ? null : clone(v); }
  async put(col, doc) {
    if (!doc || typeof doc.id !== 'string') throw new Error('documents need a string id');
    this.data[col].set(doc.id, clone(doc));
    this._changed();
    return doc;
  }
  async delete(col, id) { this.data[col].delete(id); this._changed(); }
  async list(col, filter) { const all = [...this.data[col].values()].map(clone); return filter ? all.filter(filter) : all; }
  async count(col) { return this.data[col].size; }
  async clear() { for (const c of COLLECTIONS) this.data[c].clear(); this._changed(); }
  _changed() {}
}

export class FileStore extends MemoryStore {
  constructor(file) {
    super();
    this.file = file;
    this._timer = null;
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const c of COLLECTIONS) for (const doc of raw[c] || []) this.data[c].set(doc.id, doc);
      } catch (e) {
        throw new Error(`Could not read data file ${file}: ${e.message}. Delete it or run "npm run seed:reset".`);
      }
    }
  }
  _changed() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 50);
    this._timer.unref?.();
  }
  flush() {
    const out = {};
    for (const c of COLLECTIONS) out[c] = [...this.data[c].values()];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, this.file);
  }
}
