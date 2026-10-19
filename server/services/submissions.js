// Synthetic submissions: save/retrieve, rate (persisting immutable quote records), simulated bind,
// and renewal / endorsement test scenarios. Nothing here creates real coverage.
import { HttpError, clone, isPlainObject, isIsoDate } from '../engine/util.js';
import { parseIsoDate } from '../../shared/expr.js';

const STATUSES = ['DRAFT', 'QUOTED', 'REFERRED', 'DECLINED', 'INFO_REQUIRED', 'BOUND_SIMULATED'];

export class SubmissionService {
  constructor(ctx) { this.ctx = ctx; }
  get store() { return this.ctx.store; }

  async nextId() {
    const seq = ((await this.store.get('meta', 'submission-seq'))?.n ?? 0) + 1;
    await this.store.put('meta', { id: 'submission-seq', n: seq });
    return `SUB-${String(seq).padStart(5, '0')}`;
  }

  checkBody(b, partial = false) {
    if (!isPlainObject(b)) throw new HttpError(400, 'BAD_REQUEST', 'Body must be a JSON object.');
    if (!partial) {
      if (typeof b.productId !== 'string') throw new HttpError(400, 'BAD_REQUEST', 'productId is required.');
      if (typeof b.state !== 'string') throw new HttpError(400, 'BAD_REQUEST', 'state is required.');
    }
    if (b.effectiveDate !== undefined && !isIsoDate(b.effectiveDate)) throw new HttpError(400, 'BAD_REQUEST', 'effectiveDate must be YYYY-MM-DD.');
    if (b.risk !== undefined && !isPlainObject(b.risk)) throw new HttpError(400, 'BAD_REQUEST', 'risk must be an object.');
    if (b.coverages !== undefined && !isPlainObject(b.coverages)) throw new HttpError(400, 'BAD_REQUEST', 'coverages must be an object.');
  }

  async create(actor, b) {
    this.checkBody(b);
    const product = await this.store.get('products', b.productId);
    if (!product) throw new HttpError(404, 'UNKNOWN_PRODUCT', `Unknown product "${b.productId}".`);
    const at = this.ctx.clock().toISOString();
    const sub = {
      id: await this.nextId(), productId: b.productId, lob: product.lob, state: b.state, name: (b.name || '').toString().slice(0, 80) || null,
      transactionType: b.transactionType || 'NEW_BUSINESS', effectiveDate: b.effectiveDate || at.slice(0, 10), policyEffectiveDate: b.policyEffectiveDate || null,
      risk: b.risk || {}, coverages: b.coverages || {}, endorsement: b.endorsement || null, priorTermPremium: b.priorTermPremium ?? null,
      changeTicket: b.changeTicket || null, parentSubmissionId: b.parentSubmissionId || null,
      status: 'DRAFT', createdAt: at, createdBy: actor.id, updatedAt: at, updatedBy: actor.id, latestQuoteId: null, quoteIds: [], bind: null, synthetic: true,
    };
    await this.store.put('submissions', sub);
    await this.ctx.audit.record(actor, 'SUBMISSION_CREATED', { type: 'submission', id: sub.id }, `Created ${sub.transactionType} submission for ${product.name} (${sub.state})`, {});
    return sub;
  }

  async get(id) {
    const s = await this.store.get('submissions', id);
    if (!s) throw new HttpError(404, 'NOT_FOUND', `Submission ${id} was not found.`);
    return s;
  }

  async list({ productId, status, q, state } = {}) {
    let all = await this.store.list('submissions');
    if (productId) all = all.filter((s) => s.productId === productId);
    if (status) all = all.filter((s) => s.status === status);
    if (state) all = all.filter((s) => s.state === state);
    if (q) { const n = q.toLowerCase(); all = all.filter((s) => `${s.id} ${s.name || ''} ${s.risk?.business_name || ''} ${s.risk?.address_line || ''}`.toLowerCase().includes(n)); }
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return all.map(({ risk, coverages, ...rest }) => rest);
  }

  async update(actor, id, b) {
    this.checkBody(b, true);
    const s = await this.get(id);
    if (s.status === 'BOUND_SIMULATED') throw new HttpError(409, 'LOCKED', 'A simulated-bound submission cannot be edited; create an endorsement or renewal scenario instead.');
    for (const k of ['name', 'state', 'effectiveDate', 'policyEffectiveDate', 'risk', 'coverages', 'endorsement', 'priorTermPremium', 'transactionType', 'changeTicket']) if (k in b) s[k] = clone(b[k]);
    s.status = 'DRAFT'; s.updatedAt = this.ctx.clock().toISOString(); s.updatedBy = actor.id;
    await this.store.put('submissions', s);
    await this.ctx.audit.record(actor, 'SUBMISSION_UPDATED', { type: 'submission', id }, `Edited ${id}`, {});
    return s;
  }

  async remove(actor, id) {
    const s = await this.get(id);
    if (s.status === 'BOUND_SIMULATED') throw new HttpError(409, 'LOCKED', 'Simulated-bound submissions are kept for the audit trail.');
    await this.store.delete('submissions', id);
    await this.ctx.audit.record(actor, 'SUBMISSION_DELETED', { type: 'submission', id }, `Deleted ${id}`, {});
  }

  /** Rate the saved inputs, store an immutable quote record, and update the submission status. */
  async rate(actor, id, { allowPins = false, pin } = {}) {
    const s = await this.get(id);
    const result = await this.ctx.quotes.quote(actor, {
      scenarioId: s.id, productId: s.productId, state: s.state, transactionType: s.transactionType, effectiveDate: s.effectiveDate, policyEffectiveDate: s.policyEffectiveDate || undefined,
      risk: s.risk, coverages: s.coverages, endorsement: s.endorsement || undefined, priorTermPremium: s.priorTermPremium ?? undefined, ratingVersionIds: pin,
    }, { persist: true, submissionId: s.id, allowPins });
    s.latestQuoteId = result.quoteId; s.quoteIds = [...s.quoteIds, result.quoteId];
    s.status = ['QUOTED', 'REFERRED', 'DECLINED', 'INFO_REQUIRED'].includes(result.status) ? result.status : 'DRAFT';
    s.updatedAt = this.ctx.clock().toISOString(); s.updatedBy = actor.id;
    await this.store.put('submissions', s);
    return { submission: s, quote: result };
  }

  async quotes(id) {
    const s = await this.get(id);
    const qs = [];
    for (const qid of s.quoteIds) { const q = await this.store.get('quotes', qid); if (q) qs.push(q); }
    return qs;
  }

  /** SIMULATED bind: records a pretend issuance against the latest QUOTED quote. Never real coverage. */
  async bindSimulated(actor, id) {
    const s = await this.get(id);
    if (s.status === 'BOUND_SIMULATED') throw new HttpError(409, 'ALREADY_BOUND', 'Already bound (simulated).');
    const q = s.latestQuoteId ? await this.store.get('quotes', s.latestQuoteId) : null;
    if (!q || q.status !== 'QUOTED') throw new HttpError(409, 'NOT_QUOTED', 'Only a successfully quoted submission can be bound (simulated). Rate it first.');
    const seq = ((await this.store.get('meta', 'policy-seq'))?.n ?? 0) + 1;
    await this.store.put('meta', { id: 'policy-seq', n: seq });
    s.status = 'BOUND_SIMULATED';
    s.bind = { simulated: true, simulatedPolicyNumber: `SIM-${String(seq).padStart(6, '0')}`, quoteId: q.id, premium: q.premium.total, boundAt: this.ctx.clock().toISOString(), boundBy: actor.id, notice: 'SIMULATED: no coverage exists. This record is for testing only.' };
    s.updatedAt = s.bind.boundAt; s.updatedBy = actor.id;
    await this.store.put('submissions', s);
    await this.ctx.audit.record(actor, 'BIND_SIMULATED', { type: 'submission', id }, `Simulated bind of ${id} as ${s.bind.simulatedPolicyNumber} (NO real coverage)`, { quoteId: q.id });
    return s;
  }

  /** Create a renewal or endorsement test scenario from a bound/quoted submission. */
  async createScenario(actor, id, { type, effectiveDate }) {
    const s = await this.get(id);
    if (!['RENEWAL', 'ENDORSEMENT'].includes(type)) throw new HttpError(400, 'BAD_REQUEST', 'type must be RENEWAL or ENDORSEMENT.');
    if (!isIsoDate(effectiveDate)) throw new HttpError(400, 'BAD_REQUEST', 'effectiveDate must be YYYY-MM-DD.');
    const q = s.latestQuoteId ? await this.store.get('quotes', s.latestQuoteId) : null;
    if (!q || q.status !== 'QUOTED') throw new HttpError(409, 'NOT_QUOTED', 'Rate the source submission successfully first.');
    const base = { productId: s.productId, state: s.state, name: `${type === 'RENEWAL' ? 'Renewal' : 'Endorsement'} of ${s.id}`, risk: clone(s.risk), coverages: clone(s.coverages), parentSubmissionId: s.id, transactionType: type, effectiveDate };
    if (type === 'RENEWAL') {
      const d = parseIsoDate(s.policyEffectiveDate || s.effectiveDate); d.setUTCFullYear(d.getUTCFullYear() + 1);
      return this.create(actor, { ...base, effectiveDate: isIsoDate(effectiveDate) ? effectiveDate : d.toISOString().slice(0, 10), priorTermPremium: q.premium.total });
    }
    return this.create(actor, { ...base, policyEffectiveDate: s.effectiveDate, endorsement: { priorRisk: clone(s.risk), priorCoverages: clone(s.coverages) } });
  }
}

export { STATUSES };
