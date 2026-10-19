// Append-only audit trail with a SHA-256 hash chain (tamper-evident, not tamper-proof: a
// production deployment would also ship entries to write-once storage).
import { hashOf } from '../engine/util.js';

export class AuditLog {
  constructor(store, clock) {
    this.store = store;
    this.clock = clock;
    this.queue = Promise.resolve();
  }

  /** actor: {id, role}; entity: {type, id}. Returns the stored entry. */
  record(actor, action, entity, summary, detail = {}) {
    const run = async () => {
      const last = await this.store.get('meta', 'audit-head');
      const seq = (last?.seq ?? 0) + 1;
      const entry = {
        id: `A${String(seq).padStart(7, '0')}`,
        seq,
        ts: this.clock().toISOString(),
        actor: { id: actor?.id ?? 'system', role: actor?.role ?? 'system' },
        action,
        entity: entity ?? null,
        summary,
        detail,
        prevHash: last?.hash ?? 'GENESIS',
      };
      entry.hash = hashOf(entry);
      await this.store.put('audit', entry);
      await this.store.put('meta', { id: 'audit-head', seq, hash: entry.hash });
      return entry;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async list({ entityType, entityId, action, limit = 500 } = {}) {
    let all = await this.store.list('audit');
    all.sort((a, b) => b.seq - a.seq);
    if (entityType) all = all.filter((e) => e.entity?.type === entityType);
    if (entityId) all = all.filter((e) => e.entity?.id === entityId);
    if (action) all = all.filter((e) => e.action === action);
    return all.slice(0, limit);
  }

  async verify() {
    const all = (await this.store.list('audit')).sort((a, b) => a.seq - b.seq);
    let prev = 'GENESIS';
    for (const e of all) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prev || hashOf(rest) !== hash) return { ok: false, entries: all.length, brokenAt: e.id };
      prev = hash;
    }
    return { ok: true, entries: all.length, head: prev };
  }
}
