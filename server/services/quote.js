// Quote orchestration: pick the applicable product/rating versions for state + date, validate the
// submission, run the pilot rating engine and shape an auditable, version-stamped result.
import { HttpError, hashOf, isIsoDate, isPlainObject, clone } from '../engine/util.js';
import { buildSys, rateCore } from '../engine/quoteCore.js';
import { ENGINE_INFO } from '../engine/rate.js';
import { parseIsoDate } from '../../shared/expr.js';

export const DISCLAIMER = 'SYNTHETIC ILLUSTRATION ONLY. This is not an offer of insurance, a binder, a policy or coverage of any kind. Premiums come from invented demonstration rates and are not filed or approved by any regulator or insurer.';
const TXN = ['NEW_BUSINESS', 'RENEWAL', 'ENDORSEMENT'];
export const MAX_BATCH = 200;

const addMonths = (iso, n) => { const d = parseIsoDate(iso); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((parseIsoDate(b) - parseIsoDate(a)) / 86400000);

export class QuoteService {
  constructor({ store, versions, audit, clock }) { this.store = store; this.versions = versions; this.audit = audit; this.clock = clock; }

  normalizeRequest(req) {
    if (!isPlainObject(req)) throw new HttpError(400, 'BAD_REQUEST', 'Request body must be a JSON object.');
    const errors = [];
    if (typeof req.productId !== 'string') errors.push('productId is required');
    if (typeof req.state !== 'string') errors.push('state is required');
    if (!isIsoDate(req.effectiveDate)) errors.push('effectiveDate must be YYYY-MM-DD');
    const transactionType = req.transactionType ?? 'NEW_BUSINESS';
    if (!TXN.includes(transactionType)) errors.push(`transactionType must be one of ${TXN.join(', ')}`);
    if (req.risk !== undefined && !isPlainObject(req.risk)) errors.push('risk must be an object');
    if (req.coverages !== undefined && !isPlainObject(req.coverages)) errors.push('coverages must be an object');
    if (req.policyEffectiveDate !== undefined && !isIsoDate(req.policyEffectiveDate)) errors.push('policyEffectiveDate must be YYYY-MM-DD');
    if (transactionType === 'ENDORSEMENT' && !isPlainObject(req.endorsement?.priorRisk)) errors.push('ENDORSEMENT requires endorsement.priorRisk (the risk before the change)');
    if (req.priorTermPremium !== undefined && !(typeof req.priorTermPremium === 'number' && req.priorTermPremium > 0)) errors.push('priorTermPremium must be a positive number');
    if (req.ratingVersionIds !== undefined && !isPlainObject(req.ratingVersionIds)) errors.push('ratingVersionIds must be an object');
    if (errors.length) throw new HttpError(400, 'BAD_REQUEST', errors.join('; '), errors);
    const policyEffectiveDate = req.policyEffectiveDate || req.effectiveDate;
    const ratingDate = transactionType === 'ENDORSEMENT' ? policyEffectiveDate : req.effectiveDate;
    return {
      scenarioId: req.scenarioId, productId: req.productId, state: req.state, transactionType,
      effectiveDate: req.effectiveDate, policyEffectiveDate, ratingDate,
      risk: req.risk ?? {}, coverages: req.coverages ?? {},
      endorsement: req.endorsement, priorTermPremium: req.priorTermPremium,
      pin: req.ratingVersionIds, productVersionId: req.productVersionId,
      trace: req.options?.trace !== false,
    };
  }

  async quote(actor, rawRequest, { persist = false, submissionId = null, allowPins = false } = {}) {
    const r = this.normalizeRequest(rawRequest);
    if ((r.pin || r.productVersionId) && !allowPins) throw new HttpError(403, 'FORBIDDEN', 'Pinning rating versions requires a pricing or API-client role.');
    const product = await this.store.get('products', r.productId);
    if (!product) throw new HttpError(404, 'UNKNOWN_PRODUCT', `Unknown product "${r.productId}".`);

    const productDoc = await this.versions.resolveProduct(r.productId, r.ratingDate, r.productVersionId);
    const { national, state } = productDoc ? await this.versions.resolveRating(r.productId, r.state, r.ratingDate, r.pin || {}) : { national: null, state: null };
    const scenarioId = r.scenarioId ?? `adhoc-${hashOf({ p: r.productId, s: r.state, d: r.effectiveDate, risk: r.risk, cov: r.coverages }).slice(0, 10)}`;
    const base = {
      scenarioId, productId: r.productId, lineOfBusiness: product.lob, state: r.state, transactionType: r.transactionType,
      effectiveDate: r.effectiveDate, policyEffectiveDate: r.policyEffectiveDate, ratingDate: r.ratingDate,
      risk: clone(r.risk), coverages: clone(r.coverages),
    };
    if (!productDoc || !national) {
      return this.finish(actor, { ...base, status: 'RATING_ERROR', versions: this.versionBlock(productDoc, national, state, null, r), error: { code: 'NO_APPLICABLE_VERSION', message: `No active ${!productDoc ? 'product' : 'national rating'} version is in force for ${r.productId} on ${r.ratingDate}.` } }, { persist, submissionId });
    }
    const merged = this.versions.merged(national, state);
    const sys = (extra = {}) => buildSys({ transactionType: r.transactionType, ratingDate: r.ratingDate, effectiveDate: r.effectiveDate, policyEffectiveDate: r.policyEffectiveDate, state: r.state, priorTermPremium: r.priorTermPremium, ...extra });
    const core = rateCore(productDoc.content, merged.content, merged.origins, { state: r.state, risk: r.risk, coverages: r.coverages, sys: sys(), trace: r.trace });
    const result = { ...base, status: core.status, versions: this.versionBlock(productDoc, national, state, merged, r), validation: { valid: core.validation.valid, errors: core.validation.errors, warnings: core.validation.warnings } };
    if (core.eligibility) result.eligibility = core.eligibility;
    if (core.premium) result.premium = core.premium;
    if (core.error) result.error = core.error;
    if (core.trace) result.trace = core.trace;
    if (core.appliedConfig) result.appliedConfig = core.appliedConfig;

    if (r.transactionType === 'ENDORSEMENT' && core.status === 'QUOTED') {
      const prior = rateCore(productDoc.content, merged.content, merged.origins, { state: r.state, risk: r.endorsement.priorRisk, coverages: r.endorsement.priorCoverages ?? r.coverages, sys: sys(), trace: false });
      result.endorsement = this.endorsementBlock(r, productDoc, prior, core);
    }
    return this.finish(actor, result, { persist, submissionId });
  }

  endorsementBlock(r, productDoc, prior, core) {
    if (prior.status !== 'QUOTED') return { computed: false, reason: `The prior risk could not be rated (${prior.status}).`, priorStatus: prior.status, priorErrors: prior.validation?.errors?.slice(0, 5) };
    const term = productDoc.content.termMonths ?? 12;
    const expiry = addMonths(r.policyEffectiveDate, term);
    const termDays = daysBetween(r.policyEffectiveDate, expiry);
    const remaining = daysBetween(r.effectiveDate, expiry);
    if (remaining <= 0 || r.effectiveDate < r.policyEffectiveDate) return { computed: false, reason: `Endorsement effective date ${r.effectiveDate} is outside the policy term ${r.policyEffectiveDate} to ${expiry}.` };
    const change = Math.round((core.premium.total - prior.premium.total) * 100) / 100;
    return {
      computed: true, priorPremium: prior.premium.total, newPremium: core.premium.total, annualPremiumChange: change,
      policyExpirationDate: expiry, termDays, daysRemaining: remaining,
      proratedChange: Math.round(((change * remaining) / termDays) * 100) / 100,
      method: 'pro-rata by days; both risks rated with the versions in force on the policy effective date',
    };
  }

  versionBlock(productDoc, national, state, merged, r) {
    const v = (d) => d && ({ id: d.id, scope: d.scope?.level === 'state' ? `state:${d.scope.state}` : d.scope?.level, versionNumber: d.versionNumber, status: d.status, effectiveFrom: d.effectiveFrom, contentHash: d.contentHash || hashOf(d.content) });
    const rating = [national, state].filter(Boolean).map(v);
    return {
      product: productDoc ? v(productDoc) : null,
      rating,
      effectiveConfigHash: merged?.hash ?? null,
      pinned: !!(r.pin || r.productVersionId),
      containsUnapprovedVersion: [productDoc, national, state].some((d) => d && d.status !== 'active'),
    };
  }

  async finish(actor, result, { persist, submissionId }) {
    result.disclaimer = DISCLAIMER;
    result.engine = ENGINE_INFO;
    const hashBasis = {
      s: result.status, p: result.productId, st: result.state, t: result.transactionType, d: result.effectiveDate, rd: result.ratingDate,
      v: [result.versions.product?.id, result.versions.product?.contentHash, ...result.versions.rating.flatMap((x) => [x.id, x.contentHash])],
      total: result.premium?.total, comps: result.premium?.components?.map((c) => [c.id, c.amount]), fees: result.premium?.fees, adj: result.premium?.adjustments,
      elig: result.eligibility?.reasons?.map((x) => x.code), err: result.error?.code, ve: result.validation?.errors?.map((e) => [e.path, e.code]),
    };
    result.resultHash = hashOf(hashBasis);
    if (persist) {
      const seq = ((await this.store.get('meta', 'quote-seq'))?.n ?? 0) + 1;
      await this.store.put('meta', { id: 'quote-seq', n: seq });
      result.quoteId = `Q-${String(seq).padStart(6, '0')}`;
      result.createdAt = this.clock().toISOString();
      result.createdBy = actor?.id;
      if (submissionId) result.submissionId = submissionId;
      await this.store.put('quotes', { id: result.quoteId, ...result });
      await this.audit.record(actor, 'QUOTE_CREATED', { type: 'quote', id: result.quoteId }, `Quote ${result.quoteId}: ${result.status}${result.premium ? ` ${result.premium.total.toFixed(2)}` : ''}`, { productId: result.productId, state: result.state, versions: result.versions.rating.map((x) => x.id), resultHash: result.resultHash, submissionId });
    }
    return result;
  }

  async batch(actor, body, { allowPins = false } = {}) {
    if (!isPlainObject(body) || !Array.isArray(body.scenarios)) throw new HttpError(400, 'BAD_REQUEST', 'Body must be {"scenarios":[...]}.');
    if (body.scenarios.length === 0) throw new HttpError(400, 'BAD_REQUEST', 'scenarios must not be empty.');
    if (body.scenarios.length > MAX_BATCH) throw new HttpError(413, 'BATCH_TOO_LARGE', `A batch may contain at most ${MAX_BATCH} scenarios (this pilot rates synchronously).`);
    const defaults = isPlainObject(body.defaults) ? body.defaults : {};
    const options = body.options || {};
    const results = [];
    let quoted = 0;
    for (const [index, sc] of body.scenarios.entries()) {
      try {
        const merged = { ...defaults, ...sc, options: { trace: options.trace === true } };
        const res = await this.quote(actor, merged, { persist: false, allowPins });
        if (res.status === 'QUOTED') quoted++;
        results.push(res);
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        results.push({ scenarioId: sc?.scenarioId ?? `item-${index}`, status: 'REQUEST_ERROR', error: { code: e.code, message: e.message } });
      }
    }
    const batchId = `B-${hashOf(body).slice(0, 12)}`;
    await this.audit.record(actor, 'QUOTE_BATCH', { type: 'batch', id: batchId }, `Batch of ${results.length} scenario(s): ${quoted} quoted`, { count: results.length, quoted });
    return { batchId, count: results.length, summary: summarize(results), results, disclaimer: DISCLAIMER };
  }
}

function summarize(results) {
  const by = {};
  for (const r of results) by[r.status] = (by[r.status] || 0) + 1;
  return by;
}
