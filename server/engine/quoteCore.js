// Pure rating core: validate inputs -> evaluate rules -> run the rating plan -> shape a result.
// No storage, no clock. Both the quote service and the config validator's smoke runner use it.
import { validateInputs } from './inputs.js';
import { runRating, RatingError, ENGINE_INFO } from './rate.js';
import { parseIsoDate } from '../../shared/expr.js';

export function buildSys({ transactionType, ratingDate, effectiveDate, policyEffectiveDate, state, priorTermPremium }) {
  return {
    transactionType, state,
    effectiveDate: ratingDate, // date used by date-dependent rating math (ages, years)
    ratingDate,
    policyEffectiveDate: policyEffectiveDate || ratingDate,
    transactionEffectiveDate: effectiveDate,
    effectiveYear: parseIsoDate(ratingDate).getUTCFullYear(),
    ...(typeof priorTermPremium === 'number' ? { priorTermPremium } : {}),
  };
}

/** req: {state, risk, coverages, sys, trace}; returns a status + sections (no version metadata). */
export function rateCore(productContent, ratingContent, origins, req) {
  const validation = validateInputs(productContent, { state: req.state, risk: req.risk, coverages: req.coverages }, req.sys);
  if (!validation.valid) return { status: 'INVALID', validation };
  let out;
  try {
    out = runRating(ratingContent, origins, { risk: validation.normalized.risk, cov: validation.normalized.cov, sys: req.sys }, { trace: req.trace });
  } catch (e) {
    if (e instanceof RatingError) return { status: 'RATING_ERROR', validation, error: { code: e.code, message: e.message, details: e.details } };
    throw e;
  }
  const reasons = out.rules.filter((r) => r.triggered).map(({ ruleId, kind, code, message, origin }) => ({ ruleId, kind, code, message, origin }));
  const eligibility = { decision: out.decision, reasons, rulesEvaluated: out.rules.length };
  const status = { ELIGIBLE: 'QUOTED', REFER: 'REFERRED', DECLINE: 'DECLINED', INFO_REQUIRED: 'INFO_REQUIRED' }[out.decision];
  const applied = {
    tables: [...out.ctx.tablesUsed.values()],
    steps: [...out.ctx.stepsRun],
    rules: out.rules.map((r) => r.ruleId),
    engine: ENGINE_INFO,
  };
  return { status, validation, eligibility, premium: out.premium || null, trace: req.trace === false ? undefined : out.ctx.trace, appliedConfig: applied, normalized: validation.normalized };
}

/** Compact result for smoke/impact/scenario comparison. */
export function quickRate(productContent, ratingContent, origins, scenario) {
  const sys = buildSys({ transactionType: scenario.transactionType || 'NEW_BUSINESS', ratingDate: scenario.effectiveDate, effectiveDate: scenario.effectiveDate, state: scenario.state });
  try {
    const r = rateCore(productContent, ratingContent, origins, { state: scenario.state, risk: scenario.risk, coverages: scenario.coverages, sys, trace: false });
    if (r.status === 'INVALID') return { status: 'INVALID', error: { code: 'INVALID', message: r.validation.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ') } };
    return {
      status: r.status, total: r.premium?.total ?? null, error: r.error,
      hasNegativeComponent: !!r.premium?.components.some((c) => c.amount < 0),
      components: r.premium ? Object.fromEntries(r.premium.components.map((c) => [c.id, c.amount])) : undefined,
      reasons: r.eligibility?.reasons?.map((x) => x.code),
    };
  } catch (e) {
    return { status: 'RATING_ERROR', error: { code: 'ENGINE_EXCEPTION', message: e.message } };
  }
}
