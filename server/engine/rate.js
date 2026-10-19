// Deterministic, inspectable rating engine for the Pilot Quote Site.
// Supported operations are a closed set (see STEP_OPS). No arbitrary code, no spreadsheet
// formulas, no network, no clock, no randomness: the same inputs and configuration always
// produce the same premium. This implementation is the pilot's own "candidate" rating logic.
import { evalExpr, truthy, ExprError } from '../../shared/expr.js';
import { roundHalfUp, toCents } from './util.js';

export const STEP_OPS = ['set', 'lookup', 'select', 'component', 'modifier', 'fee', 'foreach'];
export const ENGINE_INFO = { name: 'pilot-rating-engine', version: '1.0.0', note: 'Synthetic, illustrative rating logic. Not a carrier rating engine.' };

export class RatingError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

/** Find the matching row for a lookup. Exact keys compare as strings; ranges are [min,max). */
export function matchRows(table, keyValues) {
  const hits = [];
  table.rows.forEach((row, index) => {
    for (const key of table.keys) {
      const v = keyValues[key.name];
      if (key.kind === 'range') {
        const x = Number(v);
        if (!Number.isFinite(x)) return;
        const lo = row[`${key.name}_min`], hi = row[`${key.name}_max`];
        if (lo !== null && lo !== undefined && lo !== '' && x < Number(lo)) return;
        if (hi !== null && hi !== undefined && hi !== '' && x >= Number(hi)) return;
      } else if (String(row[key.name]) !== String(v)) return;
    }
    hits.push({ row, index });
  });
  return hits;
}

export function runRating(content, origins, inputs, options = {}) {
  const ctx = {
    content,
    origins,
    inputs,
    vars: {},
    params: content.params || {},
    components: [],
    modifiers: [],
    fees: [],
    trace: [],
    tablesUsed: new Map(),
    stepsRun: new Set(),
    wantTrace: options.trace !== false,
    scopeLabel: null,
    iteration: null,
  };

  const out = { ctx };
  // 1) derived values (cheap, evaluated before eligibility so rules can use them)
  runSteps(content.derive || [], ctx, {});
  // 2) eligibility / referral / information rules
  out.rules = evaluateRules(content.rules || [], ctx, origins);
  out.decision = decide(out.rules);
  if (out.decision !== 'ELIGIBLE') return out;
  // 3) calculation sequence
  runSteps(content.plan || [], ctx, {});
  // 4) totals, limits, rounding
  out.premium = finalize(content, ctx, inputs);
  return out;
}

function decide(rules) {
  const kinds = new Set(rules.filter((r) => r.triggered).map((r) => r.kind));
  if (kinds.has('decline')) return 'DECLINE';
  if (kinds.has('refer')) return 'REFER';
  if (kinds.has('info')) return 'INFO_REQUIRED';
  return 'ELIGIBLE';
}

function evaluateRules(rules, ctx, origins) {
  return rules.map((rule) => {
    let triggered = false;
    try { triggered = truthy(evalExpr(rule.when, scopeOf(ctx, {}))); }
    catch (e) { throw new RatingError('RULE_ERROR', `Rule ${rule.id} failed: ${e.message}`, { ruleId: rule.id }); }
    return { ruleId: rule.id, kind: rule.kind, code: rule.code || rule.id, message: rule.message, triggered, origin: origins.rules?.[rule.id] };
  });
}

const scopeOf = (ctx, locals) => ({ inputs: ctx.inputs, vars: ctx.vars, params: ctx.params, locals });

function runSteps(steps, ctx, locals) {
  for (const step of steps) {
    if (!STEP_OPS.includes(step.op)) throw new RatingError('UNSUPPORTED_STEP', `Unsupported step operation "${step.op}" in step ${step.id}`, { stepId: step.id });
    try {
      if (step.when !== undefined && !truthy(evalExpr(step.when, scopeOf(ctx, locals)))) {
        trace(ctx, step, { skipped: true });
        continue;
      }
      ctx.stepsRun.add(step.id);
      STEP_HANDLERS[step.op](step, ctx, locals);
    } catch (e) {
      if (e instanceof RatingError) throw e;
      if (e instanceof ExprError) throw new RatingError(e.code, `Step ${step.id}: ${e.message}`, { stepId: step.id });
      throw e;
    }
  }
}

function trace(ctx, step, detail) {
  if (!ctx.wantTrace) return;
  ctx.trace.push({ step: step.id, op: step.op, ...(ctx.scopeLabel ? { scope: ctx.scopeLabel } : {}), ...(step.label ? { label: step.label } : {}), ...detail });
}

const ev = (expr, ctx, locals) => evalExpr(expr, scopeOf(ctx, locals));

function needNumber(v, step, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RatingError('NOT_NUMBER', `Step ${step.id}: ${what} is not a finite number (got ${JSON.stringify(v)})`, { stepId: step.id });
  return v;
}

const STEP_HANDLERS = {
  set(step, ctx, locals) {
    const value = ev(step.expr, ctx, locals);
    ctx.vars[step.out] = value;
    trace(ctx, step, { out: step.out, value });
  },

  lookup(step, ctx, locals) {
    const table = ctx.content.tables?.[step.table];
    if (!table) throw new RatingError('UNKNOWN_TABLE', `Step ${step.id}: table "${step.table}" does not exist`, { stepId: step.id, table: step.table });
    const keyValues = {};
    for (const key of table.keys) {
      if (!(key.name in (step.keys || {}))) throw new RatingError('MISSING_LOOKUP_KEY', `Step ${step.id}: no expression for key "${key.name}" of table ${step.table}`, { stepId: step.id });
      keyValues[key.name] = ev(step.keys[key.name], ctx, locals);
    }
    const hits = matchRows(table, keyValues);
    if (hits.length > 1) throw new RatingError('AMBIGUOUS_RATE', `Table ${step.table} has ${hits.length} matching rows for ${JSON.stringify(keyValues)}`, { stepId: step.id, table: step.table, keyValues });
    let value; let matched = null;
    if (hits.length === 1) { value = Number(hits[0].row.value); matched = { rowIndex: hits[0].index, ...pickKeys(table, hits[0].row) }; }
    else if (table.onMiss === 'default' && typeof table.default === 'number') value = table.default;
    else throw new RatingError('NO_RATE_FOUND', `No rate found in table ${step.table} for ${JSON.stringify(keyValues)}`, { stepId: step.id, table: step.table, keyValues });
    needNumber(value, step, `table ${step.table} value`);
    ctx.vars[step.out] = value;
    const used = ctx.tablesUsed.get(step.table) || { id: step.table, origin: ctx.origins.tables?.[step.table], lookups: 0 };
    used.lookups++; ctx.tablesUsed.set(step.table, used);
    trace(ctx, step, { table: step.table, origin: ctx.origins.tables?.[step.table], keys: keyValues, matched, defaulted: hits.length === 0, out: step.out, value });
  },

  select(step, ctx, locals) {
    let chosen; let which = 'default';
    for (let i = 0; i < (step.cases || []).length; i++) {
      if (truthy(ev(step.cases[i].when, ctx, locals))) { chosen = ev(step.cases[i].value, ctx, locals); which = `case ${i + 1}`; break; }
    }
    if (which === 'default') chosen = ev(step.default, ctx, locals);
    ctx.vars[step.out] = chosen;
    trace(ctx, step, { out: step.out, value: chosen, selected: which });
  },

  component(step, ctx, locals) {
    const raw = needNumber(ev(step.amount, ctx, locals), step, 'component amount');
    const suffix = ctx.iteration ? `#${ctx.iteration.index + 1}` : '';
    const comp = { id: `${step.id}${suffix}`, stepId: step.id, label: step.label, tags: step.tags || [], group: ctx.scopeLabel || step.group || null, coverage: step.coverage || null, preModifier: raw, raw };
    ctx.components.push(comp);
    ctx.iteration?.components.push(comp);
    trace(ctx, step, { amount: raw });
  },

  modifier(step, ctx, locals) {
    const factor = needNumber(ev(step.factor, ctx, locals), step, 'modifier factor');
    const pool = ctx.iteration ? ctx.iteration.components : ctx.components;
    const wanted = step.appliesTo || ['*'];
    const targets = pool.filter((c) => wanted.includes('*') || c.tags.some((t) => wanted.includes(t)));
    let delta = 0;
    for (const c of targets) { const before = c.raw; c.raw = before * factor; delta += c.raw - before; }
    if (factor !== 1) ctx.modifiers.push({ id: step.id, label: step.label, kind: step.kind || 'factor', factor, scope: ctx.scopeLabel, appliedTo: targets.map((c) => c.id), rawDelta: delta });
    trace(ctx, step, { factor, targets: targets.length, delta: roundHalfUp(delta, 4) });
  },

  fee(step, ctx, locals) {
    const amount = needNumber(ev(step.amount, ctx, locals), step, 'fee amount');
    ctx.fees.push({ id: step.id, label: step.label, amount: roundHalfUp(amount, 2) });
    trace(ctx, step, { amount });
  },

  foreach(step, ctx, locals) {
    const list = ev({ in: step.over }, ctx, locals);
    if (!Array.isArray(list)) { trace(ctx, step, { iterations: 0 }); return; }
    const savedVars = ctx.vars;
    const savedLabel = ctx.scopeLabel;
    list.forEach((item, index) => {
      ctx.vars = { ...savedVars };
      ctx.scopeLabel = `${step.scopeLabel || step.as || 'Item'} ${index + 1}`;
      ctx.iteration = { index, components: [] };
      const inner = { ...locals, [step.as]: item, loop: { index, n: index + 1 } };
      for (const [name, expr] of Object.entries(step.bind || {})) inner[name] = ev(expr, ctx, inner);
      runSteps(step.steps || [], ctx, inner);
    });
    ctx.vars = savedVars;
    ctx.scopeLabel = savedLabel;
    ctx.iteration = null;
  },
};

function pickKeys(table, row) {
  const o = {};
  for (const k of table.keys) { if (k.kind === 'range') { o[`${k.name}_min`] = row[`${k.name}_min`]; o[`${k.name}_max`] = row[`${k.name}_max`]; } else o[k.name] = row[k.name]; }
  return o;
}

function finalize(content, ctx, inputs) {
  const limits = content.limits || {};
  const places = limits.rounding?.places ?? 2;
  const components = ctx.components.map((c) => ({
    id: c.id, stepId: c.stepId, label: c.label, tags: c.tags, group: c.group, coverage: c.coverage,
    amountBeforeModifiers: roundHalfUp(c.preModifier, places), amount: roundHalfUp(c.raw, places),
  }));
  const modifiers = ctx.modifiers.map((m) => ({ id: m.id, label: m.label, kind: m.kind, factor: roundHalfUp(m.factor, 6), scope: m.scope, appliedTo: m.appliedTo, amountEffect: roundHalfUp(m.rawDelta, places) }));
  const fees = ctx.fees;
  let subtotalC = components.reduce((s, c) => s + toCents(c.amount), 0) + fees.reduce((s, f) => s + toCents(f.amount), 0);
  const subtotal = subtotalC / 100;
  const adjustments = [];
  const sys = inputs.sys || {};

  // renewal rate-change cap/floor (applies only to renewals that supply a prior-term premium)
  const cap = limits.renewalCap;
  if (cap && sys.transactionType === 'RENEWAL' && typeof sys.priorTermPremium === 'number' && sys.priorTermPremium > 0) {
    const upper = roundHalfUp(sys.priorTermPremium * (1 + cap.maxIncreasePct / 100), places);
    const lower = roundHalfUp(sys.priorTermPremium * (1 - cap.maxDecreasePct / 100), places);
    const now = subtotalC / 100;
    if (now > upper) { adjustments.push({ id: 'renewal_cap', label: `Renewal increase cap (+${cap.maxIncreasePct}%)`, amount: roundHalfUp(upper - now, places) }); }
    else if (now < lower) { adjustments.push({ id: 'renewal_floor', label: `Renewal decrease limit (-${cap.maxDecreasePct}%)`, amount: roundHalfUp(lower - now, places) }); }
  }
  let running = (subtotalC + adjustments.reduce((s, a) => s + toCents(a.amount), 0)) / 100;
  if (typeof limits.minPremium === 'number' && running < limits.minPremium) {
    adjustments.push({ id: 'minimum_premium', label: `Minimum premium adjustment (min ${limits.minPremium.toFixed(2)})`, amount: roundHalfUp(limits.minPremium - running, places) });
    running = limits.minPremium;
  }
  if (typeof limits.maxPremium === 'number' && running > limits.maxPremium) {
    adjustments.push({ id: 'maximum_premium', label: `Maximum premium cap (max ${limits.maxPremium.toFixed(2)})`, amount: roundHalfUp(limits.maxPremium - running, places) });
    running = limits.maxPremium;
  }
  const total = roundHalfUp(running, places);

  return {
    currency: 'USD',
    termMonths: content.termMonths ?? 12,
    components, modifiers, fees, adjustments,
    subtotal: roundHalfUp(subtotal, places),
    total,
    paymentPlans: paymentPlans(content.paymentPlans || [], total),
    rounding: { places, mode: 'half_up' },
  };
}

function paymentPlans(plans, total) {
  return plans.map((p) => {
    const n = p.payments;
    const fees = n > 1 ? roundHalfUp(p.feePerPayment * (n - 1), 2) : 0;
    const totalWithFees = roundHalfUp(total + fees, 2);
    if (n <= 1) return { id: p.id, label: p.label, payments: 1, downPayment: totalWithFees, installment: 0, installmentCount: 0, fees: 0, total: totalWithFees };
    const down = roundHalfUp(totalWithFees * (p.downPaymentPct / 100), 2);
    const each = roundHalfUp((totalWithFees - down) / (n - 1), 2);
    return { id: p.id, label: p.label, payments: n, downPayment: down, installment: each, installmentCount: n - 1, fees, total: totalWithFees };
  });
}
