// Demo generators for (a) a normal synthetic rate change and (b) intentionally defective candidates.
// These produce *draft* rating versions only. They exist to demonstrate the workbench and the pilot's
// own validation; they are not RateGuard assurance and nothing here is a real pricing change.
import { clone } from '../engine/util.js';

const BASE_TABLES = { 'personal-auto': ['BASE_RATE'], homeowners: ['BASE_RATE'], 'commercial-property': ['BASE_RATE'], bop: ['PROPERTY_BASE_RATE', 'GL_CLASS_RATE'] };
const round4 = (x) => Math.round(x * 10000) / 10000;

/** Normal rate change: scale the base-rate tables by (1 + pct/100). */
export function applyRateChange(productId, content, pct) {
  const out = clone(content);
  for (const name of BASE_TABLES[productId]) {
    for (const row of out.tables[name].rows) row.value = round4(row.value * (1 + pct / 100));
  }
  return out;
}

export const RATE_CHANGE_NOTE = {
  'personal-auto': 'Base rates +4.0% (all states, all coverages)',
  homeowners: 'Base rates +4.0% per $1,000 (all states)',
  'commercial-property': 'Base building rates +4.0% (all states)',
  bop: 'Property base rates and GL class rates +4.0%',
};

/**
 * Silent defect: a plausible-looking mis-keyed value. It PASSES structural validation (in bounds,
 * no gaps) – only a comparison against an independent expectation would reveal it.
 */
export function applySilentDefect(productId, content) {
  const out = clone(content);
  const note = {};
  if (productId === 'homeowners') {
    const row = out.tables.ROOF_AGE.rows.find((r) => r.age_min === 21);
    note.table = 'ROOF_AGE'; note.change = `roof age >= 21 factor ${row.value} -> 1.25`; row.value = 1.25;
  } else if (productId === 'personal-auto') {
    const row = out.tables.MAJOR_VIOL.rows.find((r) => r.count === '1');
    note.table = 'MAJOR_VIOL'; note.change = `1 major violation factor ${row.value} -> 1.08 (dropped digit)`; row.value = 1.08;
  } else if (productId === 'commercial-property') {
    const frame = out.tables.CONSTRUCTION.rows.find((r) => r.construction_class === 'frame');
    const joisted = out.tables.CONSTRUCTION.rows.find((r) => r.construction_class === 'joisted_masonry');
    note.table = 'CONSTRUCTION'; note.change = `frame (${frame.value}) and joisted masonry (${joisted.value}) factors swapped`;
    [frame.value, joisted.value] = [joisted.value, frame.value];
  } else if (productId === 'bop') {
    const row = out.tables.GL_CLASS_RATE.rows.find((r) => r.business_class === 'restaurant_limited');
    note.table = 'GL_CLASS_RATE'; note.change = `restaurant GL rate ${row.value} -> ${round4(row.value / 10)} (decimal slip)`; row.value = round4(row.value / 10);
  }
  return { content: out, note };
}

/**
 * Structural defect: should be caught by the pilot's validation (range gap/overlap, out-of-bounds
 * factor, missing option row, unknown input reference).
 */
export function applyStructuralDefect(productId, content) {
  const out = clone(content);
  const notes = [];
  const rangeTable = { homeowners: 'ROOF_AGE', 'personal-auto': 'DRIVER_AGE', 'commercial-property': 'BUILDING_AGE', bop: 'BUILDING_AGE' }[productId];
  const t = out.tables[rangeTable];
  // 1) gap: shrink the max of the second band
  t.rows[1][`${t.keys[0].name}_max`] = t.rows[1][`${t.keys[0].name}_max`] - 1;
  notes.push(`${rangeTable}: second band now ends one unit early (range gap)`);
  // 2) out-of-bounds factor (13.5 instead of 1.35)
  const t2 = { homeowners: 'CONSTR', 'personal-auto': 'MARITAL', 'commercial-property': 'CONSTRUCTION', bop: 'CONSTRUCTION' }[productId];
  out.tables[t2].rows[0].value = Math.round(out.tables[t2].rows[0].value * 10 * 100) / 100 * 10;
  notes.push(`${t2}: first row factor multiplied by 100 (decimal typo)`);
  // 3) missing option row
  const t3 = { homeowners: 'FOUNDATION', 'personal-auto': 'GARAGED', 'commercial-property': 'COOKING', bop: 'SPRINKLER' }[productId];
  const removed = out.tables[t3].rows.pop();
  notes.push(`${t3}: row for "${Object.values(removed).find((x) => typeof x === 'string')}" deleted (incomplete table)`);
  return { content: out, notes };
}
