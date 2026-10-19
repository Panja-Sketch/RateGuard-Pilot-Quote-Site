import { h, mount, notice } from '../../lib/dom.js';
import { api } from '../../lib/api.js';
import { wbLayout } from './index.js';
import { when } from '../../lib/format.js';

export async function auditPage() {
  const f = { entityId: '', action: '' };
  const tbody = h('tbody'); const verify = h('div'); const count = h('span', { class: 'muted small' });
  async function load() {
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), limit: '300' }).toString();
    const { entries } = await api.get(`/audit?${qs}`);
    count.textContent = `${entries.length} entries (newest first)`;
    mount(tbody, entries.map((e) => h('tr', null, h('td', { class: 'mono small' }, e.id), h('td', { class: 'small nowrap' }, when(e.ts)), h('td', null, e.actor.id, h('div', { class: 'small muted' }, e.actor.role)), h('td', null, h('span', { class: 'badge' }, e.action)),
      h('td', null, e.entity ? h('a', { href: e.entity.type === 'rating' || e.entity.type === 'product' ? `#/wb/v/${e.entity.id}` : e.entity.type === 'submission' ? `#/s/${e.entity.id}` : e.entity.type === 'quote' ? `#/q/${e.entity.id}` : '#/wb/audit' }, `${e.entity.type}:${e.entity.id}`) : '—'), h('td', null, e.summary), h('td', { class: 'mono small', title: e.hash }, e.hash.slice(0, 10)))));
  }
  const root = h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Audit trail'), h('p', null, 'Who changed, validated, approved, promoted or rolled back what — and when. Entries are hash-chained: editing history breaks the chain.')),
      h('button', { class: 'btn', onclick: async () => { const r = await api.get('/audit/verify'); mount(verify, notice(r.ok ? 'ok' : 'bad', r.ok ? `Chain verified: ${r.entries} entries, head ${r.head.slice(0, 16)}…` : `Chain BROKEN at ${r.brokenAt}`)); } }, 'Verify hash chain')),
    verify,
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('input', { type: 'search', placeholder: 'Entity id (e.g. HO-NAT-v3, SUB-00001)', 'aria-label': 'Entity id', style: { maxWidth: '280px' }, oninput: (e) => { f.entityId = e.target.value.trim(); clearTimeout(root._t); root._t = setTimeout(load, 250); } }),
      h('select', { 'aria-label': 'Action', onchange: (e) => { f.action = e.target.value; load(); } }, h('option', { value: '' }, 'Any action'), ['LOGIN', 'CONFIG_CREATED', 'CONFIG_UPDATED', 'CONFIG_VALIDATED', 'CONFIG_SUBMITTED', 'CONFIG_APPROVED', 'CONFIG_REJECTED', 'CONFIG_PROMOTED', 'CONFIG_ROLLED_BACK', 'WORKBOOK_UPLOADED', 'WORKBOOK_REJECTED', 'WORKBOOK_IMPORTED', 'QUOTE_CREATED', 'QUOTE_BATCH', 'BIND_SIMULATED', 'FEEDBACK_SUBMITTED', 'FEEDBACK_ACCEPTED', 'SCENARIO_RUN'].map((a) => h('option', { value: a }, a))), count)),
    h('div', { class: 'card flush' }, h('div', { class: 'scroll-y', style: { maxHeight: '640px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['ID', 'When', 'Actor', 'Action', 'Entity', 'Summary', 'Hash'].map((c) => h('th', null, c)))), tbody))));
  await load();
  return wbLayout('#/wb/audit', root);
}
