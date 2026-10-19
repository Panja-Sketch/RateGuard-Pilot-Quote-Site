// Builders used to author the synthetic seed rating documents. The output is plain JSON
// (the same shape the workbench edits); these helpers only make the seed files readable.
import { DEMO_STATES, seeded, territoryBands } from '../engine/geo.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;

// ---- tables ----
export const T = {
  exact(description, keyName, map, valueKind = 'factor', extra = {}) {
    return { description, valueKind, keys: [{ name: keyName, kind: 'exact' }], ...extra, rows: Object.entries(map).map(([k, value]) => ({ [keyName]: k, value })) };
  },
  /** bands: [[min, max|null, value], ...]; min inclusive, max exclusive. */
  range(description, keyName, bands, valueKind = 'factor', extra = {}) {
    return { description, valueKind, keys: [{ name: keyName, kind: 'range' }], ...extra, rows: bands.map(([min, max, value]) => ({ [`${keyName}_min`]: min, [`${keyName}_max`]: max, value })) };
  },
  multi(description, keys, rows, valueKind = 'factor', extra = {}) {
    return { description, valueKind, keys, ...extra, rows };
  },
  /** One value per demo state. */
  byState(description, fn, valueKind = 'factor') {
    return T.exact(description, 'state', Object.fromEntries(DEMO_STATES.map((s) => [s, fn(s)])), valueKind);
  },
  /** Synthetic territory relativities: state (exact) x ZIP3 band (range). */
  territory(description, salt, spread = 0.14, bias = {}) {
    const rows = [];
    for (const state of DEMO_STATES) {
      for (const b of territoryBands(state, 4)) {
        const f = 1 + (seeded(`${salt}|${state}|${b.min}`) - 0.5) * 2 * spread + (bias[state] || 0);
        rows.push({ state, zip3_min: b.min, zip3_max: b.max, value: r3(f) });
      }
    }
    return { description, valueKind: 'factor', contiguous: false, keys: [{ name: 'state', kind: 'exact' }, { name: 'zip3', kind: 'range' }], rows };
  },
  /** Base-rate matrix: state x item, value = base[item] * rel[state][group]. */
  stateMatrix(description, itemKey, bases, relFor, groupOf = () => 'x', digits = 2) {
    const rows = [];
    for (const state of DEMO_STATES) for (const [item, base] of Object.entries(bases)) rows.push({ state, [itemKey]: item, value: Number((base * relFor(state, groupOf(item))).toFixed(digits)) });
    return { description, valueKind: 'rate', keys: [{ name: 'state', kind: 'exact' }, { name: itemKey, kind: 'exact' }], rows };
  },
};

// ---- expressions ----
const op = (o, ...args) => ({ op: o, args });
export const E = {
  i: (path) => ({ in: path }),
  v: (name) => ({ v: name }),
  p: (name) => ({ p: name }),
  list: (...xs) => ({ list: xs }),
  op,
  add: (...a) => op('add', ...a), sub: (...a) => op('sub', ...a), mul: (...a) => op('mul', ...a), div: (...a) => op('div', ...a),
  min: (...a) => op('min', ...a), max: (...a) => op('max', ...a), clamp: (...a) => op('clamp', ...a),
  eq: (a, b) => op('eq', a, b), ne: (a, b) => op('ne', a, b), gt: (a, b) => op('gt', a, b), gte: (a, b) => op('gte', a, b), lt: (a, b) => op('lt', a, b), lte: (a, b) => op('lte', a, b),
  and: (...a) => op('and', ...a), or: (...a) => op('or', ...a), not: (a) => op('not', a),
  inn: (x, ...vals) => op('in', x, { list: vals }),
  iff: (c, a, b) => op('if', c, a, b),
  round: (...a) => op('round', ...a),
  agg: (agg, over, expr, where, as = 'item') => ({ agg, over, as, ...(expr !== undefined ? { expr } : {}), ...(where !== undefined ? { where } : {}) }),
};

// ---- steps ----
export const S = {
  set: (id, out, expr, o = {}) => ({ id, op: 'set', out, expr, ...o }),
  lookup: (id, table, keys, out, o = {}) => ({ id, op: 'lookup', table, keys, out, ...o }),
  select: (id, out, cases, def, o = {}) => ({ id, op: 'select', out, cases, default: def, ...o }),
  component: (id, label, amount, tags = [], o = {}) => ({ id, op: 'component', label, amount, tags, ...o }),
  modifier: (id, label, factor, o = {}) => ({ id, op: 'modifier', label, factor, ...o }),
  fee: (id, label, amount, o = {}) => ({ id, op: 'fee', label, amount, ...o }),
  foreach: (id, over, as, scopeLabel, steps, o = {}) => ({ id, op: 'foreach', over, as, scopeLabel, steps, ...o }),
};

// ---- rules ----
export const R = {
  decline: (id, message, when) => ({ id, kind: 'decline', code: id, message, when }),
  refer: (id, message, when) => ({ id, kind: 'refer', code: id, message, when }),
  info: (id, message, when) => ({ id, kind: 'info', code: id, message, when }),
};

// ---- input schema helpers ----
const optsOf = (list) => list.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : { value: o, label: String(o).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) }));
export const F = {
  select: (key, label, options, o = {}) => ({ key, label, type: 'select', options: optsOf(options), required: true, ...o }),
  text: (key, label, o = {}) => ({ key, label, type: 'string', maxLength: 80, ...o }),
  int: (key, label, min, max, o = {}) => ({ key, label, type: 'integer', min, max, required: true, ...o }),
  num: (key, label, min, max, o = {}) => ({ key, label, type: 'number', min, max, required: true, ...o }),
  money: (key, label, min, max, o = {}) => ({ key, label, type: 'currency', min, max, required: true, ...o }),
  bool: (key, label, o = {}) => ({ key, label, type: 'boolean', default: false, ...o }),
  date: (key, label, o = {}) => ({ key, label, type: 'date', required: true, ...o }),
  zip: (key, label, o = {}) => ({ key, label, type: 'zip', required: true, ...o }),
};

export { r2, r3 };
