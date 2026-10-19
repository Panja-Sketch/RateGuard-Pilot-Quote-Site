import { h } from '../../lib/dom.js';
import { api } from '../../lib/api.js';
import { wbLayout } from './index.js';
import { renderDiff } from './report.js';

export async function diffPage({ a, b }) {
  const isProd = /-PROD-/.test(a);
  const d = await api.get(`/${isProd ? 'product' : 'rating'}-versions/${a}/diff/${b}`);
  return wbLayout('#/wb', h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('p', null, h('a', { href: `#/wb/v/${b}` }, `← ${b}`)), h('h1', null, `Before / after: ${a} → ${b}`),
      h('p', null, `${d.from.label} → ${d.to.label}`)), h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/wb/diff/${b}/${a}` }, 'Swap direction'), isProd ? null : h('a', { class: 'btn btn-primary', href: `#/wb/impact?candidate=${b}&baseline=${a}` }, 'Run scenarios on this change'))),
    h('div', { class: 'card' }, h('dl', { class: 'kv' }, h('dt', null, 'Before'), h('dd', null, `${d.from.id} · effective ${d.from.effectiveFrom} · ${d.from.status}`), h('dt', null, 'After'), h('dd', null, `${d.to.id} · effective ${d.to.effectiveFrom} · ${d.to.status}`))),
    renderDiff(d)));
}
