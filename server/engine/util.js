import { createHash } from 'node:crypto';

/** Stable JSON: sorted keys so hashes are deterministic. */
export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const hashOf = (value) => sha256(canonicalize(value));
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function roundHalfUp(x, places = 2) {
  const f = 10 ** places;
  const n = x * f;
  return Math.round(n + Math.sign(n) * 1e-9) / f;
}
export const toCents = (x) => Math.round(x * 100);

export class HttpError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
