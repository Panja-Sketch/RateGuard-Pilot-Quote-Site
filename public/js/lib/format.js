import { h } from './dom.js';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = (n) => (typeof n === 'number' ? usd.format(n) : '—');
export const money0 = (n) => (typeof n === 'number' ? usd0.format(n) : '—');
export const signedMoney = (n) => (typeof n === 'number' ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${usd.format(Math.abs(n))}` : '—');
export const pct = (n, d = 2) => (typeof n === 'number' ? `${n > 0 ? '+' : ''}${n.toFixed(d)}%` : '—');
export const num = (n) => (typeof n === 'number' ? new Intl.NumberFormat('en-US').format(n) : String(n ?? '—'));

export function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const day = (iso) => iso || '—';
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const shortHash = (s) => (s ? `${String(s).slice(0, 10)}…` : '—');

export const STATUS = {
  QUOTED: { label: 'Illustrative quote', kind: 'ok' }, REFERRED: { label: 'Referred to underwriting', kind: 'warn' }, DECLINED: { label: 'Not eligible', kind: 'bad' },
  INFO_REQUIRED: { label: 'More information required', kind: 'info' }, INVALID: { label: 'Needs corrections', kind: 'bad' }, RATING_ERROR: { label: 'Could not be rated', kind: 'bad' },
  DRAFT: { label: 'Draft', kind: '' }, BOUND_SIMULATED: { label: 'Bound (simulated)', kind: 'info' },
};
export const statusBadge = (s) => h('span', { class: `badge ${STATUS[s]?.kind || ''}` }, STATUS[s]?.label || s);

export const VSTATUS = { draft: '', validated: 'info', pending_approval: 'warn', approved: 'warn', active: 'ok', rejected: 'bad', rolled_back: 'bad' };
export const versionBadge = (v) => h('span', { class: `badge ${VSTATUS[v.status] ?? ''}` }, v.status === 'active' && v.effectiveState ? `active · ${v.effectiveState.replace('_', ' ')}` : v.status.replace('_', ' '));

export const LOB_NAME = { PERSONAL_AUTO: 'Personal Auto', HOMEOWNERS: 'Homeowners', COMMERCIAL_PROPERTY: 'Commercial Property', BOP: 'Business Owners Policy' };
export const STATE_NAME = { AZ: 'Arizona', CA: 'California', FL: 'Florida', GA: 'Georgia', IL: 'Illinois', NY: 'New York', NC: 'North Carolina', OR: 'Oregon', TX: 'Texas', WA: 'Washington' };

export function humanize(s) { return String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
