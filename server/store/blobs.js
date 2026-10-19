// Binary artifact storage (uploaded synthetic workbooks). Local: memory or ./data/blobs.
// Cloud: swap for Cloud Storage (see docs/GOOGLE_CLOUD.md). Content-addressed by SHA-256.
import fs from 'node:fs';
import path from 'node:path';

export class MemoryBlobStore {
  constructor() { this.m = new Map(); }
  async put(key, buf) { this.m.set(key, Buffer.from(buf)); }
  async get(key) { return this.m.get(key) ?? null; }
}

export class FileBlobStore {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  file(key) { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('invalid blob key'); return path.join(this.dir, `${key}.xlsx`); }
  async put(key, buf) { fs.writeFileSync(this.file(key), buf); }
  async get(key) { const f = this.file(key); return fs.existsSync(f) ? fs.readFileSync(f) : null; }
}
