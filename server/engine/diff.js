// Structured before/after diff of two rating-version contents (and light metadata).
import { canonicalize } from './util.js';
import { walkSteps } from './merge.js';

const same = (a, b) => canonicalize(a) === canonicalize(b);

function rowSig(table, row) {
  return table.keys.map((k) => (k.kind === 'range' ? `${k.name}[${row[`${k.name}_min`] ?? ''},${row[`${k.name}_max`] ?? ''})` : `${k.name}=${row[k.name]}`)).join(' · ');
}
const pct = (a, b) => (typeof a === 'number' && typeof b === 'number' && a !== 0 ? Math.round(((b - a) / a) * 10000) / 100 : null);

export function diffContent(a, b) {
  const changes = [];
  const push = (c) => changes.push(c);
  a = a || {}; b = b || {};

  // parameters
  const pa = a.params || {}, pb = b.params || {};
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    if (!(k in pa)) push({ area: 'param', path: `params.${k}`, kind: 'added', after: pb[k] });
    else if (!(k in pb)) push({ area: 'param', path: `params.${k}`, kind: 'removed', before: pa[k] });
    else if (!same(pa[k], pb[k])) push({ area: 'param', path: `params.${k}`, kind: 'changed', before: pa[k], after: pb[k], pct: pct(pa[k], pb[k]) });
  }

  // tables
  const ta = a.tables || {}, tb = b.tables || {};
  for (const name of new Set([...Object.keys(ta), ...Object.keys(tb)])) {
    if (!(name in ta)) { push({ area: 'table', path: `tables.${name}`, kind: 'added', note: `${tb[name].rows.length} rows` }); continue; }
    if (!(name in tb)) { push({ area: 'table', path: `tables.${name}`, kind: 'removed', note: `${ta[name].rows.length} rows` }); continue; }
    const A = ta[name], B = tb[name];
    if (!same(A.keys, B.keys)) push({ area: 'table', path: `tables.${name}.keys`, kind: 'changed', before: A.keys, after: B.keys });
    for (const meta of ['valueKind', 'bounds', 'onMiss', 'default', 'contiguous']) if (!same(A[meta], B[meta])) push({ area: 'table', path: `tables.${name}.${meta}`, kind: 'changed', before: A[meta], after: B[meta] });
    const ma = new Map(A.rows.map((r) => [rowSig(A, r), r])), mb = new Map(B.rows.map((r) => [rowSig(B, r), r]));
    for (const [sig, r] of ma) {
      if (!mb.has(sig)) push({ area: 'table-row', path: `tables.${name}`, key: sig, kind: 'removed', before: r.value });
      else if (!same(r.value, mb.get(sig).value)) push({ area: 'table-row', path: `tables.${name}`, key: sig, kind: 'changed', before: r.value, after: mb.get(sig).value, pct: pct(r.value, mb.get(sig).value) });
    }
    for (const [sig, r] of mb) if (!ma.has(sig)) push({ area: 'table-row', path: `tables.${name}`, key: sig, kind: 'added', after: r.value });
  }

  // rules
  const ra = new Map((a.rules || []).map((r) => [r.id, r])), rb = new Map((b.rules || []).map((r) => [r.id, r]));
  for (const [id, r] of ra) { if (!rb.has(id)) push({ area: 'rule', path: `rules.${id}`, kind: 'removed', before: r.message }); else if (!same(r, rb.get(id))) push({ area: 'rule', path: `rules.${id}`, kind: 'changed', before: r, after: rb.get(id) }); }
  for (const [id, r] of rb) if (!ra.has(id)) push({ area: 'rule', path: `rules.${id}`, kind: 'added', after: r.message });

  // steps (derive + plan)
  const collect = (c) => { const m = new Map(); walkSteps(c.derive, (s) => m.set(s.id, s)); walkSteps(c.plan, (s) => m.set(s.id, s)); return m; };
  const sa = collect(a), sb = collect(b);
  for (const [id, s] of sa) { if (!sb.has(id)) push({ area: 'step', path: `steps.${id}`, kind: 'removed', before: s.label || s.op }); else if (!same(strip(s), strip(sb.get(id)))) push({ area: 'step', path: `steps.${id}`, kind: 'changed', before: strip(s), after: strip(sb.get(id)) }); }
  for (const [id, s] of sb) if (!sa.has(id)) push({ area: 'step', path: `steps.${id}`, kind: 'added', after: s.label || s.op });

  // limits / payment plans / overrides
  for (const key of ['limits', 'paymentPlans', 'removeRules', 'stepOverrides', 'additionalSteps']) {
    if (!same(a[key], b[key])) push({ area: 'limits', path: key, kind: 'changed', before: a[key], after: b[key] });
  }
  return { changes, summary: summarize(changes) };
}

const strip = (s) => (s.op === 'foreach' ? { ...s, steps: (s.steps || []).map((x) => x.id) } : s);

function summarize(changes) {
  const s = { total: changes.length, added: 0, removed: 0, changed: 0, tableRowsChanged: 0, maxValueChangePct: 0 };
  for (const c of changes) {
    s[c.kind]++;
    if (c.area === 'table-row') s.tableRowsChanged++;
    if (typeof c.pct === 'number') s.maxValueChangePct = Math.max(s.maxValueChangePct, Math.abs(c.pct));
  }
  return s;
}

export function diffMeta(a, b) {
  const out = [];
  for (const k of ['label', 'effectiveFrom', 'effectiveTo']) if ((a?.[k] ?? null) !== (b?.[k] ?? null)) out.push({ area: 'meta', path: k, kind: 'changed', before: a?.[k] ?? null, after: b?.[k] ?? null });
  return out;
}
