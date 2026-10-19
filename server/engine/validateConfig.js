// Structural and semantic validation of rating-version documents and product-version documents.
// This is the pilot's own configuration gate (used by the lifecycle before submit/approve/promote
// and exposed through the API). It is not an independent assurance of pricing correctness: a
// plausible-but-wrong factor can pass validation, which is exactly the "silent defect" demo.
import { analyzeExpr } from '../../shared/expr.js';
import { STEP_OPS } from './rate.js';
import { mergeContent, walkSteps } from './merge.js';
import { schemaPaths } from './inputs.js';
import { DEMO_STATES } from './geo.js';
import { isIsoDate, isPlainObject } from './util.js';

const SYS_PATHS = new Set(['sys.transactionType', 'sys.effectiveDate', 'sys.policyEffectiveDate', 'sys.ratingDate', 'sys.state', 'sys.priorTermPremium', 'sys.effectiveYear']);
const DEFAULT_BOUNDS = { factor: { min: 0.2, max: 5 }, amount: { min: 0, max: 1e9 }, rate: { min: 0, max: 1e9 } };
const RULE_KINDS = ['decline', 'refer', 'info'];

export function newReport() { return { errors: [], warnings: [], info: [] }; }
const add = (rep, sev, code, path, message) => rep[sev === 'error' ? 'errors' : sev === 'warning' ? 'warnings' : 'info'].push({ code, path, message });

export function finishReport(rep, extra = {}) { return { valid: rep.errors.length === 0, ...rep, ...extra }; }

// ---------- rating version ----------

/**
 * ctx: {
 *   product: product content (for input references),
 *   national: national rating doc (when `doc` is a state override),
 *   baseline: previous rating doc in the same scope (optional, for impact),
 *   smoke: { scenarios:[...], rate:(content, origins, scenario)=>{status,total,error} } (optional)
 * }
 */
export function validateRatingVersion(doc, ctx = {}) {
  const rep = newReport();
  if (!isPlainObject(doc) || !isPlainObject(doc.content)) { add(rep, 'error', 'NOT_A_DOCUMENT', '', 'A rating version needs a "content" object.'); return finishReport(rep); }
  const scope = doc.scope || {};
  if (!['national', 'state'].includes(scope.level)) add(rep, 'error', 'BAD_SCOPE', 'scope.level', 'Scope level must be "national" or "state".');
  if (scope.level === 'state' && !DEMO_STATES.includes(scope.state)) add(rep, 'error', 'BAD_STATE', 'scope.state', `State "${scope.state}" is not in the demo jurisdiction set (${DEMO_STATES.join(', ')}).`);
  if (!isIsoDate(doc.effectiveFrom)) add(rep, 'error', 'BAD_EFFECTIVE_DATE', 'effectiveFrom', 'effectiveFrom must be a valid date (YYYY-MM-DD).');
  if (doc.effectiveTo && (!isIsoDate(doc.effectiveTo) || doc.effectiveTo <= doc.effectiveFrom)) add(rep, 'error', 'BAD_EFFECTIVE_DATE', 'effectiveTo', 'effectiveTo must be a valid date after effectiveFrom.');

  let content = doc.content; let origins = null;
  if (scope.level === 'state') {
    if (!ctx.national) add(rep, 'error', 'NO_NATIONAL_BASE', 'scope', 'No national/base version found to merge this state override with.');
    else {
      checkOverrideTargets(doc.content, ctx.national.content, rep);
      ({ content, origins } = mergeContent(ctx.national.content, ctx.national.id, doc.content, doc.id || 'candidate'));
    }
  }
  if (scope.level === 'state' && !ctx.national) return finishReport(rep);

  const pathMap = ctx.product ? schemaPaths(ctx.product) : null;
  checkParams(content, rep);
  checkTables(content, rep, scope.level === 'national' ? '' : 'merged: ');
  checkLogic(content, rep, pathMap);
  checkLimits(content, rep);

  // smoke run + impact
  let smoke = null; let impact = null;
  if (rep.errors.length === 0 && ctx.smoke) {
    const eff = origins || { params: {}, tables: {}, rules: {}, steps: {} };
    smoke = runSmoke(content, eff, ctx.smoke, rep);
    if (ctx.baseline && ctx.smoke.rateBaseline) impact = impactVs(content, eff, ctx, rep);
  }
  return finishReport(rep, { smoke, impact, contentSummary: summarize(content) });
}

function summarize(content) {
  let steps = 0; walkSteps(content.derive, () => steps++); walkSteps(content.plan, () => steps++);
  return { tables: Object.keys(content.tables || {}).length, tableRows: Object.values(content.tables || {}).reduce((s, t) => s + (t.rows?.length || 0), 0), params: Object.keys(content.params || {}).length, rules: (content.rules || []).length, steps };
}

function checkOverrideTargets(override, national, rep) {
  const ids = new Set();
  walkSteps(national.derive, (s) => ids.add(s.id)); walkSteps(national.plan, (s) => ids.add(s.id));
  for (const id of Object.keys(override.stepOverrides || {})) if (!ids.has(id)) add(rep, 'error', 'OVERRIDE_TARGET_MISSING', `stepOverrides.${id}`, `State override replaces step "${id}" which does not exist in the national version.`);
  const ruleIds = new Set((national.rules || []).map((r) => r.id));
  for (const id of override.removeRules || []) if (!ruleIds.has(id)) add(rep, 'error', 'OVERRIDE_TARGET_MISSING', `removeRules.${id}`, `State override removes rule "${id}" which does not exist in the national version.`);
  for (const a of override.additionalSteps || []) if (a.after !== '__end__' && !ids.has(a.after)) add(rep, 'error', 'OVERRIDE_TARGET_MISSING', `additionalSteps.${a.step?.id}`, `Insert-after target "${a.after}" does not exist in the national version.`);
  for (const [name, t] of Object.entries(override.tables || {})) if (!national.tables?.[name]) add(rep, 'warning', 'NEW_TABLE_IN_OVERRIDE', `tables.${name}`, `Table "${name}" only exists in the state override; make sure a step uses it.`);
}

function checkParams(content, rep) {
  for (const [k, v] of Object.entries(content.params || {})) {
    if (!['number', 'string', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))) add(rep, 'error', 'BAD_PARAM', `params.${k}`, `Parameter "${k}" must be a finite number, string or boolean.`);
  }
}

// ---- tables ----
function checkTables(content, rep, prefix) {
  for (const [name, t] of Object.entries(content.tables || {})) {
    const p = `tables.${name}`;
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) add(rep, 'warning', 'TABLE_NAME_STYLE', p, `${prefix}Table name "${name}" should be UPPER_SNAKE_CASE (needed for XLSX sheet mapping RT_${name}).`);
    if (!Array.isArray(t.keys) || t.keys.length === 0) { add(rep, 'error', 'TABLE_KEYS', p, `${prefix}Table ${name} needs at least one key column.`); continue; }
    const names = t.keys.map((k) => k.name);
    if (new Set(names).size !== names.length) add(rep, 'error', 'TABLE_KEYS', p, `${prefix}Table ${name} has duplicate key column names.`);
    for (const k of t.keys) if (!['exact', 'range'].includes(k.kind)) add(rep, 'error', 'TABLE_KEYS', p, `${prefix}Table ${name} key "${k.name}" must be exact or range.`);
    if (!Array.isArray(t.rows) || t.rows.length === 0) { add(rep, 'error', 'TABLE_EMPTY', p, `${prefix}Table ${name} has no rows.`); continue; }
    const bounds = t.bounds || DEFAULT_BOUNDS[t.valueKind] || null;
    t.rows.forEach((row, i) => {
      const rp = `${p}.rows[${i}]`;
      if (typeof row.value !== 'number' || !Number.isFinite(row.value)) { add(rep, 'error', 'MISSING_VALUE', rp, `${prefix}${name} row ${i + 1}: value is missing or not a number.`); return; }
      if (bounds && (row.value < bounds.min || row.value > bounds.max)) add(rep, 'error', 'VALUE_OUT_OF_BOUNDS', rp, `${prefix}${name} row ${i + 1}: value ${row.value} is outside the plausible range ${bounds.min}–${bounds.max} for a ${t.valueKind || 'value'} (possible mis-keyed factor).`);
      for (const k of t.keys) {
        if (k.kind === 'range') {
          const lo = row[`${k.name}_min`], hi = row[`${k.name}_max`];
          if (lo !== null && lo !== undefined && lo !== '' && !Number.isFinite(Number(lo))) add(rep, 'error', 'BAD_RANGE', rp, `${prefix}${name} row ${i + 1}: ${k.name}_min is not a number.`);
          else if (hi !== null && hi !== undefined && hi !== '' && !Number.isFinite(Number(hi))) add(rep, 'error', 'BAD_RANGE', rp, `${prefix}${name} row ${i + 1}: ${k.name}_max is not a number.`);
          else if (isNum(lo) && isNum(hi) && Number(lo) >= Number(hi)) add(rep, 'error', 'BAD_RANGE', rp, `${prefix}${name} row ${i + 1}: ${k.name}_min (${lo}) must be less than ${k.name}_max (${hi}); max is exclusive.`);
        } else if (row[k.name] === undefined || row[k.name] === null || row[k.name] === '') add(rep, 'error', 'MISSING_KEY', rp, `${prefix}${name} row ${i + 1}: key "${k.name}" is empty.`);
      }
    });
    checkOverlapAndGaps(name, t, rep, prefix);
  }
}
const isNum = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
const lo = (row, k) => (isNum(row[`${k}_min`]) ? Number(row[`${k}_min`]) : -Infinity);
const hi = (row, k) => (isNum(row[`${k}_max`]) ? Number(row[`${k}_max`]) : Infinity);

function checkOverlapAndGaps(name, t, rep, prefix) {
  const rows = t.rows.filter((r) => typeof r.value === 'number');
  const exactKeys = t.keys.filter((k) => k.kind === 'exact');
  const rangeKeys = t.keys.filter((k) => k.kind === 'range');
  const sig = (r) => exactKeys.map((k) => String(r[k.name])).join('|');
  let conflicts = 0;
  for (let i = 0; i < rows.length && conflicts < 5; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (sig(rows[i]) !== sig(rows[j])) continue;
      const overlaps = rangeKeys.every((k) => lo(rows[i], k.name) < hi(rows[j], k.name) && lo(rows[j], k.name) < hi(rows[i], k.name));
      if (overlaps) {
        conflicts++;
        const where = exactKeys.length ? ` for ${exactKeys.map((k) => `${k.name}=${rows[i][k.name]}`).join(', ')}` : '';
        add(rep, 'error', rangeKeys.length ? 'RANGE_OVERLAP' : 'DUPLICATE_KEY', `tables.${name}`, `${prefix}${name}: rows ${i + 1} and ${j + 1} ${rangeKeys.length ? 'have overlapping ranges' : 'have the same key'}${where}.`);
        if (conflicts >= 5) break;
      }
    }
  }
  if (rangeKeys.length === 1 && t.contiguous !== false) {
    const k = rangeKeys[0].name;
    const groups = new Map();
    for (const r of rows) { const s = sig(r); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(r); }
    for (const [s, list] of groups) {
      list.sort((a, b) => lo(a, k) - lo(b, k));
      for (let i = 1; i < list.length; i++) {
        if (hi(list[i - 1], k) < lo(list[i], k)) add(rep, 'error', 'RANGE_GAP', `tables.${name}`, `${prefix}${name}${s ? ` [${s}]` : ''}: gap between ${hi(list[i - 1], k)} and ${lo(list[i], k)} — values in the gap would have no rate.`);
      }
    }
  }
}

// ---- logic (steps, rules, references) ----
function checkLogic(content, rep, pathMap) {
  const stepIds = new Set();
  const tables = content.tables || {};
  const tagsDefined = new Set();
  const modifierTags = [];
  const params = content.params || {};

  const normPath = (path, aliases) => {
    const m = String(path).match(/^([A-Za-z_]\w*)(.*)$/);
    if (!m) return path;
    if (aliases[m[1]]) return `${aliases[m[1]]}[]${m[2].replace(/^\[\d+\]/, '')}`;
    return path.replace(/\[\d+\]/g, '[]');
  };
  const checkExpr = (expr, where, vars, aliases) => {
    if (expr === undefined) { add(rep, 'error', 'MISSING_EXPR', where, `${where}: expression is missing.`); return; }
    const a = analyzeExpr(expr, undefined, 0, new Set(['loop']), new Set());
    a.errors.forEach((m) => add(rep, 'error', 'BAD_EXPRESSION', where, `${where}: ${m}.`));
    for (const v of a.vars) if (!vars.has(v)) add(rep, 'error', 'UNDEFINED_VARIABLE', where, `${where}: variable "${v}" is used before it is defined.`);
    for (const p of a.params) if (!(p in params)) add(rep, 'error', 'UNKNOWN_PARAM', where, `${where}: parameter "${p}" does not exist.`);
    for (const inp of a.inputs) {
      const root = inp.split(/[.[]/)[0];
      if (root === 'sys') { if (!SYS_PATHS.has(inp.replace(/\[\d+\]/g, ''))) add(rep, 'error', 'UNKNOWN_INPUT', where, `${where}: unknown system input "${inp}".`); continue; }
      if (!pathMap) continue;
      const np = normPath(inp, aliases);
      if (!pathMap.has(np) && !pathMap.has(np.replace(/\[\]$/, ''))) add(rep, 'error', 'UNKNOWN_INPUT', where, `${where}: input "${inp}" is not defined by the product (looked up as ${np}).`);
    }
  };

  const walk = (steps, vars, aliases, where) => {
    for (const [i, s] of (steps || []).entries()) {
      const w = `${where}[${s.id ?? i}]`;
      if (!s.id || typeof s.id !== 'string') { add(rep, 'error', 'STEP_ID', w, `${w}: every step needs an id.`); continue; }
      if (stepIds.has(s.id)) add(rep, 'error', 'DUPLICATE_STEP_ID', w, `Step id "${s.id}" is used more than once.`);
      stepIds.add(s.id);
      if (!STEP_OPS.includes(s.op)) { add(rep, 'error', 'UNSUPPORTED_STEP', w, `${w}: operation "${s.op}" is not supported. Supported: ${STEP_OPS.join(', ')}.`); continue; }
      if (s.when !== undefined) checkExpr(s.when, `${w}.when`, vars, aliases);
      switch (s.op) {
        case 'set': if (!s.out) add(rep, 'error', 'STEP_SHAPE', w, `${w}: "out" is required.`); checkExpr(s.expr, `${w}.expr`, vars, aliases); if (s.out) vars.add(s.out); break;
        case 'lookup': {
          const t = tables[s.table];
          if (!t) { add(rep, 'error', 'UNKNOWN_TABLE', w, `${w}: table "${s.table}" does not exist.`); }
          else for (const k of t.keys || []) {
            if (!s.keys || !(k.name in s.keys)) add(rep, 'error', 'MISSING_LOOKUP_KEY', w, `${w}: no expression for key "${k.name}" of table ${s.table}.`);
            else { checkExpr(s.keys[k.name], `${w}.keys.${k.name}`, vars, aliases); checkOptionCoverage(s, k, t, s.keys[k.name], pathMap, aliases, normPath, rep, w); }
          }
          if (!s.out) add(rep, 'error', 'STEP_SHAPE', w, `${w}: "out" is required.`); else vars.add(s.out);
          break;
        }
        case 'select':
          if (!Array.isArray(s.cases)) add(rep, 'error', 'STEP_SHAPE', w, `${w}: "cases" must be a list.`);
          (s.cases || []).forEach((c, ci) => { checkExpr(c.when, `${w}.cases[${ci}].when`, vars, aliases); checkExpr(c.value, `${w}.cases[${ci}].value`, vars, aliases); });
          checkExpr(s.default, `${w}.default`, vars, aliases);
          if (!s.out) add(rep, 'error', 'STEP_SHAPE', w, `${w}: "out" is required.`); else vars.add(s.out);
          break;
        case 'component': checkExpr(s.amount, `${w}.amount`, vars, aliases); if (!s.label) add(rep, 'error', 'STEP_SHAPE', w, `${w}: label is required.`); (s.tags || []).forEach((t) => tagsDefined.add(t)); break;
        case 'modifier': checkExpr(s.factor, `${w}.factor`, vars, aliases); if (!s.label) add(rep, 'error', 'STEP_SHAPE', w, `${w}: label is required.`); modifierTags.push({ id: s.id, tags: s.appliesTo || ['*'] }); break;
        case 'fee': checkExpr(s.amount, `${w}.amount`, vars, aliases); break;
        case 'foreach': {
          if (typeof s.over !== 'string' || !s.as) { add(rep, 'error', 'STEP_SHAPE', w, `${w}: "over" and "as" are required.`); break; }
          if (pathMap && !pathMap.has(s.over)) add(rep, 'error', 'UNKNOWN_INPUT', w, `${w}: loop source "${s.over}" is not defined by the product.`);
          const inner = new Set(vars);
          const al = { ...aliases, [s.as]: s.over };
          for (const [alias, src] of Object.entries(s.bindTypes || {})) al[alias] = src;
          for (const [alias, expr] of Object.entries(s.bind || {})) checkExpr(expr, `${w}.bind.${alias}`, inner, al);
          walk(s.steps, inner, al, `${w}.steps`);
          break;
        }
        default: break;
      }
    }
  };
  const vars = new Set();
  walk(content.derive, vars, {}, 'derive');
  const ruleIds = new Set();
  for (const r of content.rules || []) {
    const w = `rules[${r.id}]`;
    if (!r.id || ruleIds.has(r.id)) add(rep, 'error', 'DUPLICATE_RULE_ID', w, `Rule id "${r.id}" is missing or duplicated.`);
    ruleIds.add(r.id);
    if (!RULE_KINDS.includes(r.kind)) add(rep, 'error', 'RULE_KIND', w, `${w}: kind must be one of ${RULE_KINDS.join(', ')}.`);
    if (!r.message) add(rep, 'error', 'RULE_MESSAGE', w, `${w}: a customer-readable message is required.`);
    checkExpr(r.when, `${w}.when`, vars, {});
  }
  walk(content.plan, vars, {}, 'plan');
  let comps = 0; walkSteps(content.plan, (s) => { if (s.op === 'component') comps++; });
  if (comps === 0) add(rep, 'error', 'NO_COMPONENTS', 'plan', 'The calculation sequence produces no premium components.');
  for (const m of modifierTags) if (!m.tags.includes('*') && !m.tags.some((t) => tagsDefined.has(t))) add(rep, 'warning', 'MODIFIER_NO_TARGET', `plan[${m.id}]`, `Modifier "${m.id}" targets tags (${m.tags.join(', ')}) that no component carries.`);
  const used = new Set(); walkSteps(content.derive, (s) => s.table && used.add(s.table)); walkSteps(content.plan, (s) => s.table && used.add(s.table));
  for (const name of Object.keys(tables)) if (!used.has(name)) add(rep, 'warning', 'UNUSED_TABLE', `tables.${name}`, `Table ${name} is not referenced by any step.`);
}

function checkOptionCoverage(step, key, table, keyExpr, pathMap, aliases, normPath, rep, w) {
  if (!pathMap || !keyExpr || typeof keyExpr !== 'object' || !('in' in keyExpr) || key.kind !== 'exact') return;
  const f = pathMap.get(normPath(keyExpr.in, aliases));
  if (!f || f.type !== 'select' || !Array.isArray(f.options)) return;
  const have = new Set(table.rows.map((r) => String(r[key.name])));
  const missing = f.options.map((o) => (typeof o === 'object' ? o.value : o)).filter((o) => !have.has(String(o)));
  if (missing.length) add(rep, 'error', 'INCOMPLETE_TABLE', `tables.${step.table}`, `${w}: table ${step.table} has no row for ${key.name} = ${missing.join(', ')} (offered by the product), so those quotes would have no rate.`);
}

function checkLimits(content, rep) {
  const l = content.limits || {};
  if (l.minPremium !== undefined && (!Number.isFinite(l.minPremium) || l.minPremium < 0)) add(rep, 'error', 'BAD_LIMIT', 'limits.minPremium', 'minPremium must be a non-negative number.');
  if (l.maxPremium !== undefined && !Number.isFinite(l.maxPremium)) add(rep, 'error', 'BAD_LIMIT', 'limits.maxPremium', 'maxPremium must be a number.');
  if (Number.isFinite(l.minPremium) && Number.isFinite(l.maxPremium) && l.minPremium > l.maxPremium) add(rep, 'error', 'BAD_LIMIT', 'limits', 'minPremium exceeds maxPremium.');
  const places = l.rounding?.places;
  if (places !== undefined && !(Number.isInteger(places) && places >= 0 && places <= 4)) add(rep, 'error', 'BAD_ROUNDING', 'limits.rounding.places', 'Rounding places must be an integer from 0 to 4.');
  if (l.rounding?.mode && l.rounding.mode !== 'half_up') add(rep, 'error', 'BAD_ROUNDING', 'limits.rounding.mode', 'Only half_up rounding is supported.');
  if (l.renewalCap && !(l.renewalCap.maxIncreasePct >= 0 && l.renewalCap.maxDecreasePct >= 0)) add(rep, 'error', 'BAD_LIMIT', 'limits.renewalCap', 'renewalCap needs non-negative maxIncreasePct and maxDecreasePct.');
  for (const p of content.paymentPlans || []) {
    if (!(Number.isInteger(p.payments) && p.payments >= 1 && p.payments <= 12)) add(rep, 'error', 'BAD_PAYMENT_PLAN', `paymentPlans.${p.id}`, 'payments must be an integer between 1 and 12.');
    if (!(p.downPaymentPct >= 0 && p.downPaymentPct <= 100)) add(rep, 'error', 'BAD_PAYMENT_PLAN', `paymentPlans.${p.id}`, 'downPaymentPct must be 0–100.');
  }
}

// ---- smoke + impact ----
function runSmoke(content, origins, smoke, rep) {
  let ok = 0; const failures = []; let min = Infinity; let max = -Infinity; let changed = 0;
  for (const sc of smoke.scenarios) {
    const r = smoke.rate(content, origins, sc);
    const expect = sc.expectStatus || 'QUOTED';
    if (!['RATING_ERROR', 'INVALID'].includes(r.status) && r.status !== expect) {
      if (++changed <= 5) add(rep, 'warning', 'SMOKE_STATUS_CHANGED', `smoke.${sc.scenarioId}`, `Scenario ${sc.scenarioId} was expected to be ${expect} but is now ${r.status}${r.reasons?.length ? ` (${r.reasons.join(', ')})` : ''}.`);
    } else if (r.status === 'QUOTED') {
      ok++;
      if (!(r.total > 0)) failures.push({ scenario: sc.scenarioId, reason: `non-positive premium ${r.total}` });
      min = Math.min(min, r.total); max = Math.max(max, r.total);
      if (r.hasNegativeComponent) add(rep, 'warning', 'NEGATIVE_COMPONENT', sc.scenarioId, `Scenario ${sc.scenarioId} produced a negative premium component.`);
    } else if (r.status === 'RATING_ERROR') failures.push({ scenario: sc.scenarioId, reason: `${r.error?.code}: ${r.error?.message}` });
    else if (r.status === 'INVALID') failures.push({ scenario: sc.scenarioId, reason: `scenario invalid: ${r.error?.message}` });
  }
  for (const f of failures.slice(0, 8)) add(rep, 'error', 'SMOKE_FAILURE', `smoke.${f.scenario}`, `Smoke scenario ${f.scenario} failed: ${f.reason}`);
  if (failures.length > 8) add(rep, 'error', 'SMOKE_FAILURE', 'smoke', `…and ${failures.length - 8} more smoke failures.`);
  return { scenarios: smoke.scenarios.length, quoted: ok, failed: failures.length, statusChanged: changed, minPremium: ok ? min : null, maxPremium: ok ? max : null };
}

function impactVs(content, origins, ctx, rep) {
  const rows = [];
  for (const sc of ctx.smoke.scenarios) {
    const a = ctx.smoke.rateBaseline(sc); const b = ctx.smoke.rate(content, origins, sc);
    if (a.status === 'QUOTED' && b.status === 'QUOTED') rows.push({ scenarioId: sc.scenarioId, before: a.total, after: b.total, pct: a.total ? ((b.total - a.total) / a.total) * 100 : 0 });
  }
  if (!rows.length) return null;
  const pcts = rows.map((r) => r.pct);
  const avg = pcts.reduce((s, x) => s + x, 0) / pcts.length;
  const maxAbs = Math.max(...pcts.map(Math.abs));
  const changed = rows.filter((r) => Math.abs(r.pct) > 0.005).length;
  const summary = { compared: rows.length, changed, averagePct: round2(avg), maxAbsPct: round2(maxAbs), largest: rows.slice().sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct)).slice(0, 5).map((r) => ({ ...r, pct: round2(r.pct) })) };
  if (maxAbs > 25) add(rep, 'warning', 'LARGE_IMPACT', 'impact', `Largest scenario premium change vs the previous version is ${round2(maxAbs)}%. Review before approval.`);
  else if (Math.abs(avg) > 10) add(rep, 'warning', 'LARGE_IMPACT', 'impact', `Average scenario premium change vs the previous version is ${round2(avg)}%.`);
  else add(rep, 'info', 'IMPACT', 'impact', `${changed}/${rows.length} smoke scenarios change vs the previous version (avg ${round2(avg)}%, max |Δ| ${round2(maxAbs)}%).`);
  return summary;
}
const round2 = (x) => Math.round(x * 100) / 100;

// ---------- product version ----------
const FIELD_TYPES = ['string', 'text', 'integer', 'number', 'currency', 'boolean', 'date', 'zip', 'select', 'multiselect'];

export function validateProductVersion(doc) {
  const rep = newReport();
  const c = doc?.content;
  if (!isPlainObject(c)) { add(rep, 'error', 'NOT_A_DOCUMENT', '', 'A product version needs a "content" object.'); return finishReport(rep); }
  if (!isIsoDate(doc.effectiveFrom)) add(rep, 'error', 'BAD_EFFECTIVE_DATE', 'effectiveFrom', 'effectiveFrom must be a valid date.');
  if (!Array.isArray(c.states) || !c.states.length || c.states.some((s) => !DEMO_STATES.includes(s))) add(rep, 'error', 'BAD_STATES', 'states', `states must be a non-empty subset of ${DEMO_STATES.join(', ')}.`);
  if (!Array.isArray(c.sections) || !c.sections.length) { add(rep, 'error', 'NO_SECTIONS', 'sections', 'A product needs at least one section.'); return finishReport(rep); }
  const keys = new Set(); const sectionIds = new Set();
  const check = (fields, where, scopeKey) => {
    const seen = new Set();
    for (const f of fields || []) {
      const w = `${where}.${f.key}`;
      if (!f.key || !/^[a-z][a-z0-9_]*$/.test(f.key)) add(rep, 'error', 'FIELD_KEY', w, `${w}: key must be lower_snake_case.`);
      if (seen.has(f.key)) add(rep, 'error', 'DUPLICATE_FIELD', w, `${w}: duplicate field key.`);
      seen.add(f.key);
      if (scopeKey) { if (keys.has(`${scopeKey}.${f.key}`)) add(rep, 'error', 'DUPLICATE_FIELD', w, `${w}: field key already used in another section.`); keys.add(`${scopeKey}.${f.key}`); }
      if (!FIELD_TYPES.includes(f.type)) add(rep, 'error', 'FIELD_TYPE', w, `${w}: type "${f.type}" is not supported.`);
      if (!f.label) add(rep, 'error', 'FIELD_LABEL', w, `${w}: label is required.`);
      if (['select', 'multiselect'].includes(f.type) && (!Array.isArray(f.options) || f.options.length === 0)) add(rep, 'error', 'FIELD_OPTIONS', w, `${w}: select fields need options.`);
      if (f.min !== undefined && f.max !== undefined && f.min > f.max) add(rep, 'error', 'FIELD_RANGE', w, `${w}: min exceeds max.`);
      for (const k of ['showIf', 'requiredIf']) if (f[k] !== undefined) analyzeExpr(f[k]).errors.forEach((m) => add(rep, 'error', 'BAD_EXPRESSION', `${w}.${k}`, `${w}.${k}: ${m}.`));
    }
  };
  for (const s of c.sections) {
    if (!s.id || sectionIds.has(s.id)) add(rep, 'error', 'SECTION_ID', `sections.${s.id}`, 'Section ids must be unique.');
    sectionIds.add(s.id);
    if (!['risk', 'coverage'].includes(s.group)) add(rep, 'error', 'SECTION_GROUP', `sections.${s.id}`, 'Section group must be risk or coverage.');
    if (s.repeat) {
      if (!s.repeat.key) add(rep, 'error', 'SECTION_REPEAT', `sections.${s.id}`, 'repeat.key is required.');
      check(s.repeat.fields, `sections.${s.id}.repeat`, null);
    } else check(s.fields, `sections.${s.id}`, `${s.group}`);
    for (const chk of s.checks || []) analyzeExpr(chk.check).errors.forEach((m) => add(rep, 'error', 'BAD_EXPRESSION', `sections.${s.id}.checks.${chk.id}`, m));
  }
  for (const chk of c.crossChecks || []) analyzeExpr(chk.check).errors.forEach((m) => add(rep, 'error', 'BAD_EXPRESSION', `crossChecks.${chk.id}`, m));
  return finishReport(rep);
}
