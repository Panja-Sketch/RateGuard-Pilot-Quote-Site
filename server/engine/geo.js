// Synthetic demo jurisdiction set. This is a configurable demo set, NOT a claim that these are
// the largest insurance states or a real insurer's approved footprint.
// ZIP3 ranges are coarse plausibility ranges used for input checks and synthetic territories.
export const DEMO_STATES = ['AZ', 'CA', 'FL', 'GA', 'IL', 'NY', 'NC', 'OR', 'TX', 'WA'];

export const STATE_INFO = {
  AZ: { name: 'Arizona', zip3: [[850, 865]], sampleZip: '85004' },
  CA: { name: 'California', zip3: [[900, 961]], sampleZip: '90012' },
  FL: { name: 'Florida', zip3: [[320, 349]], sampleZip: '33130' },
  GA: { name: 'Georgia', zip3: [[300, 319], [398, 399]], sampleZip: '30303' },
  IL: { name: 'Illinois', zip3: [[600, 629]], sampleZip: '60601' },
  NY: { name: 'New York', zip3: [[100, 149]], sampleZip: '10005' },
  NC: { name: 'North Carolina', zip3: [[270, 289]], sampleZip: '28202' },
  OR: { name: 'Oregon', zip3: [[970, 979]], sampleZip: '97204' },
  TX: { name: 'Texas', zip3: [[750, 799], [885, 885]], sampleZip: '75201' },
  WA: { name: 'Washington', zip3: [[980, 994]], sampleZip: '98101' },
};

export const zip3Of = (zip) => Number(String(zip).slice(0, 3));

export function zipMatchesState(zip, state) {
  const info = STATE_INFO[state];
  if (!info || !/^\d{5}$/.test(String(zip))) return false;
  const z = zip3Of(zip);
  return info.zip3.some(([lo, hi]) => z >= lo && z <= hi);
}

/** Deterministic pseudo-random in [0,1) from a string (used only to generate synthetic seed tables). */
export function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Split each state's ZIP3 segments into up to `bands` half-open ranges [min,max). */
export function territoryBands(state, bands = 4) {
  const out = [];
  for (const [lo, hi] of STATE_INFO[state].zip3) {
    const span = hi - lo + 1;
    const n = Math.min(bands, span);
    for (let i = 0; i < n; i++) {
      const min = lo + Math.floor((span * i) / n);
      const max = lo + Math.floor((span * (i + 1)) / n);
      out.push({ min, max });
    }
  }
  return out;
}
