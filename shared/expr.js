// Safe, bounded expression language shared by the server rating engine and the browser form
// renderer (showIf). Expressions are plain JSON: there is no eval, no Function, no formulas.
//
// Nodes:
//   literal            number | string | boolean | null
//   {in:"risk.x"}      input path (roots: risk, cov, sys, plus loop locals such as vehicle, driver, item, loop)
//   {v:"name"}         rating variable set by an earlier step
//   {p:"name"}         configuration parameter
//   {list:[...]}       literal list
//   {op:"add", args:[...]}   see OPS below
//   {agg:"sum|min|max|count|any|all", over:"risk.drivers", as:"item", expr?:node, where?:node}

export const MAX_DEPTH = 24;
export const MAX_NODES = 400;

export class ExprError extends Error {
  constructor(message, code = 'EXPR_ERROR') { super(message); this.code = code; }
}

export function getPath(root, path) {
  if (path == null) return undefined;
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

const num = (x, what = 'value') => {
  if (typeof x === 'boolean') return x ? 1 : 0;
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ExprError(`${what} is not a finite number (got ${JSON.stringify(x)})`, 'NOT_NUMBER');
  return n;
};

export function parseIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function yearsBetween(from, to) {
  const a = parseIsoDate(from), b = parseIsoDate(to);
  if (!a || !b) throw new ExprError('years_between requires ISO dates (YYYY-MM-DD)', 'BAD_DATE');
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  const md = (b.getUTCMonth() - a.getUTCMonth()) || (b.getUTCDate() - a.getUTCDate());
  if (md < 0) years -= 1;
  return years;
}

function looseEq(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number' && a.trim() !== '') return Number(a) === b;
  return false;
}
export function truthy(x) { return !(x === false || x == null || x === 0 || x === '' || Number.isNaN(x)); }

export const OPS = {
  add: (a) => a.reduce((s, x) => s + num(x), 0),
  sub: (a) => num(a[0]) - a.slice(1).reduce((s, x) => s + num(x), 0),
  mul: (a) => a.reduce((s, x) => s * num(x), 1),
  div: (a) => { const d = num(a[1]); if (d === 0) throw new ExprError('division by zero', 'DIV_ZERO'); return num(a[0]) / d; },
  min: (a) => Math.min(...a.map((x) => num(x))),
  max: (a) => Math.max(...a.map((x) => num(x))),
  abs: (a) => Math.abs(num(a[0])),
  floor: (a) => Math.floor(num(a[0])),
  ceil: (a) => Math.ceil(num(a[0])),
  clamp: (a) => Math.min(Math.max(num(a[0]), num(a[1])), num(a[2])),
  round: (a) => { const p = a[1] == null ? 0 : num(a[1]); const f = 10 ** p; const n = num(a[0]) * f; return Math.round(n + Math.sign(n) * 1e-9) / f; },
  eq: (a) => looseEq(a[0], a[1]),
  ne: (a) => !looseEq(a[0], a[1]),
  gt: (a) => num(a[0]) > num(a[1]),
  gte: (a) => num(a[0]) >= num(a[1]),
  lt: (a) => num(a[0]) < num(a[1]),
  lte: (a) => num(a[0]) <= num(a[1]),
  in: (a) => Array.isArray(a[1]) && a[1].some((x) => looseEq(a[0], x)),
  not: (a) => !truthy(a[0]),
  coalesce: (a) => a.find((x) => x !== undefined && x !== null && x !== ''),
  years_between: (a) => yearsBetween(a[0], a[1]),
  year: (a) => { const d = parseIsoDate(a[0]); if (!d) throw new ExprError('year requires an ISO date', 'BAD_DATE'); return d.getUTCFullYear(); },
  len: (a) => (Array.isArray(a[0]) ? a[0].length : 0),
  at: (a) => (Array.isArray(a[0]) ? a[0][num(a[1])] : undefined),
};
// short-circuit ops are handled in evalExpr: and, or, if

/** scope: {inputs:{risk,cov,sys}, vars:{}, params:{}, locals:{vehicle,...}} */
export function evalExpr(node, scope, depth = 0, counter = { n: 0 }) {
  if (++counter.n > MAX_NODES) throw new ExprError('expression too large', 'EXPR_TOO_LARGE');
  if (depth > MAX_DEPTH) throw new ExprError('expression too deeply nested', 'EXPR_TOO_DEEP');
  if (node === null || typeof node === 'number' || typeof node === 'string' || typeof node === 'boolean') return node;
  if (Array.isArray(node)) throw new ExprError('bare arrays are not allowed; use {list:[...]}', 'BAD_NODE');
  if (typeof node !== 'object') throw new ExprError('invalid expression node', 'BAD_NODE');
  const ev = (n) => evalExpr(n, scope, depth + 1, counter);

  if ('in' in node) {
    const path = String(node.in);
    const root = path.split(/[.[]/)[0];
    if (scope.locals && Object.prototype.hasOwnProperty.call(scope.locals, root)) return getPath(scope.locals, path);
    return getPath(scope.inputs || {}, path);
  }
  if ('v' in node) return scope.vars ? scope.vars[node.v] : undefined;
  if ('p' in node) {
    const v = scope.params ? scope.params[node.p] : undefined;
    if (v === undefined) throw new ExprError(`unknown parameter "${node.p}"`, 'UNKNOWN_PARAM');
    return v;
  }
  if ('list' in node) return node.list.map(ev);
  if ('agg' in node) return evalAgg(node, scope, depth, counter);
  if ('op' in node) {
    const args = node.args || [];
    if (node.op === 'and') { for (const a of args) if (!truthy(ev(a))) return false; return true; }
    if (node.op === 'or') { for (const a of args) if (truthy(ev(a))) return true; return false; }
    if (node.op === 'if') return truthy(ev(args[0])) ? ev(args[1]) : ev(args[2]);
    if (!Object.prototype.hasOwnProperty.call(OPS, node.op)) throw new ExprError(`unsupported operation "${node.op}"`, 'UNSUPPORTED_OP');
    return OPS[node.op](args.map(ev));
  }
  throw new ExprError('unrecognised expression node', 'BAD_NODE');
}

function evalAgg(node, scope, depth, counter) {
  const list = evalExpr({ in: node.over }, scope, depth + 1, counter);
  const arr = Array.isArray(list) ? list : [];
  const as = node.as || 'item';
  const items = [];
  arr.forEach((it, index) => {
    const inner = { ...scope, locals: { ...(scope.locals || {}), [as]: it, loop: { index } } };
    if (node.where !== undefined && !truthy(evalExpr(node.where, inner, depth + 1, counter))) return;
    items.push(node.expr === undefined ? 1 : evalExpr(node.expr, inner, depth + 1, counter));
  });
  switch (node.agg) {
    case 'count': return items.length;
    case 'sum': return items.reduce((s, x) => s + num(x), 0);
    case 'min': return items.length ? Math.min(...items.map((x) => num(x))) : null;
    case 'max': return items.length ? Math.max(...items.map((x) => num(x))) : null;
    case 'any': return items.some(truthy);
    case 'all': return items.every(truthy);
    default: throw new ExprError(`unsupported aggregate "${node.agg}"`, 'UNSUPPORTED_AGG');
  }
}

/** Static walk: returns {errors, inputs, vars, params, nodes}. No evaluation. */
export function analyzeExpr(node, acc = { errors: [], inputs: new Set(), vars: new Set(), params: new Set(), nodes: 0 }, depth = 0, localRoots = new Set(), extraLocals = new Set()) {
  acc.nodes++;
  if (depth > MAX_DEPTH) { acc.errors.push('expression too deeply nested'); return acc; }
  if (node === null || ['number', 'string', 'boolean'].includes(typeof node)) return acc;
  if (Array.isArray(node) || typeof node !== 'object') { acc.errors.push('invalid expression node (bare arrays are not allowed)'); return acc; }
  const rec = (n, roots = localRoots) => analyzeExpr(n, acc, depth + 1, roots, extraLocals);
  if ('in' in node) {
    const root = String(node.in).split(/[.[]/)[0];
    if (!localRoots.has(root) && !extraLocals.has(root)) acc.inputs.add(String(node.in));
  } else if ('v' in node) acc.vars.add(node.v);
  else if ('p' in node) acc.params.add(node.p);
  else if ('list' in node) { if (!Array.isArray(node.list)) acc.errors.push('list must be an array'); else node.list.forEach((n) => rec(n)); }
  else if ('agg' in node) {
    if (!['sum', 'min', 'max', 'count', 'any', 'all'].includes(node.agg)) acc.errors.push(`unsupported aggregate "${node.agg}"`);
    if (typeof node.over !== 'string') acc.errors.push('aggregate needs "over"');
    else acc.inputs.add(node.over);
    const roots = new Set(localRoots); roots.add(node.as || 'item'); roots.add('loop');
    if (node.expr !== undefined) rec(node.expr, roots);
    if (node.where !== undefined) rec(node.where, roots);
  } else if ('op' in node) {
    if (!Object.prototype.hasOwnProperty.call(OPS, node.op) && !['and', 'or', 'if'].includes(node.op)) acc.errors.push(`unsupported operation "${node.op}"`);
    if (!Array.isArray(node.args ?? [])) acc.errors.push(`"${node.op}" args must be an array`);
    else (node.args || []).forEach((n) => rec(n));
  } else acc.errors.push('unrecognised expression node');
  return acc;
}
