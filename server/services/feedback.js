// Internal feedback workflow. Feedback is DATA ABOUT the workbench; it never edits rates, premium
// calculations or validation outcomes. Accepted mapping corrections become *suggestions* shown in
// the next import's mapping step (profile- and product-scoped); a human still confirms every mapping.
import { HttpError, isPlainObject } from '../engine/util.js';

export const FEEDBACK_TYPES = ['mapping_correction', 'terminology', 'scenario_useful', 'scenario_missed_case', 'explanation_comment'];
const PROFILE = 'pilot-rate-workbook-v1';

export class FeedbackService {
  constructor(ctx) { this.ctx = ctx; }
  get store() { return this.ctx.store; }

  async create(actor, b) {
    if (!isPlainObject(b)) throw new HttpError(400, 'BAD_REQUEST', 'Body must be a JSON object.');
    if (!FEEDBACK_TYPES.includes(b.type)) throw new HttpError(400, 'BAD_REQUEST', `type must be one of ${FEEDBACK_TYPES.join(', ')}.`);
    if (typeof b.productId !== 'string' || !(await this.store.get('products', b.productId))) throw new HttpError(400, 'BAD_REQUEST', 'A valid productId is required so feedback stays scoped.');
    const text = typeof b.comment === 'string' ? b.comment.trim().slice(0, 2000) : '';
    const payload = isPlainObject(b.payload) ? b.payload : {};
    if (b.type === 'mapping_correction') {
      for (const k of ['sourceSheet', 'sourceColumn', 'targetTable', 'targetColumn']) if (typeof payload[k] !== 'string' || !payload[k]) throw new HttpError(400, 'BAD_REQUEST', `mapping_correction needs payload.${k}.`);
    }
    if (b.type === 'terminology' && (typeof payload.term !== 'string' || typeof payload.meaning !== 'string')) throw new HttpError(400, 'BAD_REQUEST', 'terminology needs payload.term and payload.meaning.');
    if (b.type === 'scenario_useful' && typeof payload.useful !== 'boolean') throw new HttpError(400, 'BAD_REQUEST', 'scenario_useful needs payload.useful (boolean).');
    if (!text && !Object.keys(payload).length) throw new HttpError(400, 'BAD_REQUEST', 'Provide a comment or payload.');
    const seq = ((await this.store.get('meta', 'feedback-seq'))?.n ?? 0) + 1;
    await this.store.put('meta', { id: 'feedback-seq', n: seq });
    const fb = {
      id: `FB-${String(seq).padStart(5, '0')}`, type: b.type, productId: b.productId, profile: PROFILE,
      versionId: typeof b.versionId === 'string' ? b.versionId : null, quoteId: typeof b.quoteId === 'string' ? b.quoteId : null, scenarioId: typeof b.scenarioId === 'string' ? b.scenarioId : null,
      state: typeof b.state === 'string' ? b.state : null, comment: text, payload, status: 'submitted',
      createdAt: this.ctx.clock().toISOString(), createdBy: actor.id, review: null,
      note: 'Feedback is data about the tooling. It does not change rates, premiums or validation results.',
    };
    await this.store.put('feedback', fb);
    await this.ctx.audit.record(actor, 'FEEDBACK_SUBMITTED', { type: 'feedback', id: fb.id }, `${fb.type} feedback for ${fb.productId}${fb.versionId ? ` / ${fb.versionId}` : ''}`, { type: fb.type });
    return fb;
  }

  async list({ productId, type, status } = {}) {
    let all = await this.store.list('feedback');
    if (productId) all = all.filter((f) => f.productId === productId);
    if (type) all = all.filter((f) => f.type === type);
    if (status) all = all.filter((f) => f.status === status);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async review(actor, id, { decision, comment }) {
    const fb = await this.store.get('feedback', id);
    if (!fb) throw new HttpError(404, 'NOT_FOUND', `Feedback ${id} was not found.`);
    if (fb.status !== 'submitted') throw new HttpError(409, 'ALREADY_REVIEWED', `Feedback ${id} was already ${fb.status}.`);
    if (!['accept', 'reject'].includes(decision)) throw new HttpError(400, 'BAD_REQUEST', 'decision must be accept or reject.');
    if (fb.createdBy === actor.id) throw new HttpError(403, 'FOUR_EYES', 'You cannot review your own feedback.');
    fb.status = decision === 'accept' ? 'accepted' : 'rejected';
    fb.review = { by: actor.id, at: this.ctx.clock().toISOString(), decision, comment: (comment || '').toString().slice(0, 1000) };
    await this.store.put('feedback', fb);
    let hint = null;
    if (decision === 'accept' && fb.type === 'mapping_correction') {
      const hints = await this.store.list('hints', (h) => h.productId === fb.productId && h.sourceSheet === fb.payload.sourceSheet && h.sourceColumn === fb.payload.sourceColumn);
      const version = hints.reduce((m, h) => Math.max(m, h.version), 0) + 1;
      hint = {
        id: `HINT-${fb.productId}-${(await this.store.count('hints')) + 1}`, productId: fb.productId, profile: fb.profile, version, feedbackId: fb.id,
        sourceSheet: fb.payload.sourceSheet, sourceColumn: fb.payload.sourceColumn, targetTable: fb.payload.targetTable, targetColumn: fb.payload.targetColumn,
        approvedBy: actor.id, approvedAt: fb.review.at, status: 'active', supersedes: hints.map((h) => h.id),
      };
      for (const h of hints) { h.status = 'superseded'; await this.store.put('hints', h); }
      await this.store.put('hints', hint);
    }
    await this.ctx.audit.record(actor, `FEEDBACK_${decision === 'accept' ? 'ACCEPTED' : 'REJECTED'}`, { type: 'feedback', id }, `${decision === 'accept' ? 'Accepted' : 'Rejected'} ${id}${hint ? ` (mapping hint ${hint.id} v${hint.version})` : ''}`, { hint: hint?.id });
    return { feedback: fb, hint };
  }

  async activeHints(productId) {
    return this.store.list('hints', (h) => h.productId === productId && h.status === 'active');
  }
}
