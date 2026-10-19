// Human-readable rendering of the JSON expression language (for the workbench "calculation sequence").
const INFIX = { add: '+', sub: '−', mul: '×', div: '÷', eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', and: 'AND', or: 'OR' };

export function exprStr(n, top = true) {
  if (n === null || n === undefined) return '∅';
  if (typeof n === 'string') return `"${n}"`;
  if (typeof n === 'number' || typeof n === 'boolean') return String(n);
  if ('in' in n) return n.in;
  if ('v' in n) return `$${n.v}`;
  if ('p' in n) return `param.${n.p}`;
  if ('list' in n) return `[${n.list.map((x) => exprStr(x, false)).join(', ')}]`;
  if ('agg' in n) return `${n.agg}(${n.over} as ${n.as || 'item'}${n.expr !== undefined ? ` → ${exprStr(n.expr, false)}` : ''}${n.where !== undefined ? ` where ${exprStr(n.where, false)}` : ''})`;
  if ('op' in n) {
    const a = (n.args || []).map((x) => exprStr(x, false));
    if (INFIX[n.op]) { const s = a.join(` ${INFIX[n.op]} `); return top ? s : `(${s})`; }
    if (n.op === 'in') return `${a[0]} in ${a[1]}`;
    if (n.op === 'not') return `NOT ${a[0]}`;
    if (n.op === 'if') return `IF ${a[0]} THEN ${a[1]} ELSE ${a[2]}`;
    return `${n.op}(${a.join(', ')})`;
  }
  return JSON.stringify(n);
}

export function stepSummary(s) {
  switch (s.op) {
    case 'set': return `${s.out} = ${exprStr(s.expr)}`;
    case 'lookup': return `${s.out} = ${s.table}[${Object.entries(s.keys || {}).map(([k, e]) => `${k}=${exprStr(e)}`).join(', ')}]`;
    case 'select': return `${s.out} = ${(s.cases || []).map((c) => `IF ${exprStr(c.when)} → ${exprStr(c.value)}`).join('; ')}; else ${exprStr(s.default)}`;
    case 'component': return `component "${s.label}" = ${exprStr(s.amount)}${s.tags?.length ? `  [${s.tags.join(', ')}]` : ''}`;
    case 'modifier': return `modifier "${s.label}" × ${exprStr(s.factor)}  applies to ${(s.appliesTo || ['*']).join(', ')}`;
    case 'fee': return `fee "${s.label}" = ${exprStr(s.amount)}`;
    case 'foreach': return `for each ${s.as} in ${s.over} (${(s.steps || []).length} steps)`;
    default: return JSON.stringify(s);
  }
}
