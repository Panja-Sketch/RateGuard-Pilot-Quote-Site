import { h, modal, notice, toast, mount } from '../../lib/dom.js';
import { api, can } from '../../lib/api.js';
import { wbLayout, roleHelp } from './index.js';
import { VSTATUS, STATE_NAME, todayIso } from '../../lib/format.js';

const SCOPE_ORDER = ['national', ...Object.keys(STATE_NAME)];

export async function versionsPage(_p, query) {
  const { products } = await api.get('/products');
  let productId = query.get('product') || products[0].id;
  const body = h('div');
  const resolver = h('div');

  async function load() {
    const [{ versions: rating }, { versions: prod }] = await Promise.all([api.get(`/rating-versions?productId=${productId}`), api.get(`/product-versions?productId=${productId}`)]);
    const lanes = new Map();
    for (const s of SCOPE_ORDER) lanes.set(s, []);
    for (const v of rating) lanes.get(v.scope.level === 'national' ? 'national' : v.scope.state)?.push(v);
    const chip = (v) => h('a', { class: `chip s-${v.effectiveState || v.status}${['draft', 'validated', 'rejected'].includes(v.status) ? ' draft' : ''}`, href: `#/wb/v/${v.id}`, title: `${v.label}\nStatus: ${v.status}${v.effectiveState ? ` (${v.effectiveState})` : ''}\nEffective ${v.effectiveFrom}` },
      h('strong', null, `v${v.versionNumber}`), h('span', null, v.effectiveFrom), v.demo ? h('span', { class: `badge ${v.demo.kind === 'rate_change' ? 'ok' : 'bad'}` }, v.demo.kind === 'rate_change' ? 'demo: rate change' : v.demo.kind === 'defect_silent' ? 'demo: silent defect' : 'demo: structural defect') : null,
      ['draft', 'validated', 'pending_approval', 'approved', 'rejected', 'rolled_back'].includes(v.status) ? h('span', { class: `badge ${VSTATUS[v.status]}` }, v.status.replace('_', ' ')) : null);
    mount(body,
      h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Version timeline'), h('span', { class: 'small muted' }, 'Green edge = active · blue = scheduled · dashed = not yet active. Each state override layers on the national version in force.')),
        h('div', { class: 'card-body' },
          h('div', { class: 'tl' }, h('strong', null, 'Product'), h('div', { class: 'chips' }, prod.map(chip))),
          [...lanes].map(([lane, list]) => h('div', { class: 'tl' }, h('strong', null, lane === 'national' ? 'National' : `${lane}`), h('div', { class: 'chips' }, list.length ? list.map(chip) : h('span', { class: 'small muted' }, lane === 'national' ? 'none' : 'no override – national applies')))))),
      pendingCard(rating));
  }

  function pendingCard(rating) {
    const todo = rating.filter((v) => ['draft', 'validated', 'pending_approval', 'approved', 'rejected'].includes(v.status));
    return h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, `Drafts and items awaiting action (${todo.length})`)),
      todo.length ? h('div', { class: 'scroll-x' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Version', 'Label', 'Scope', 'Effective', 'Status', 'Ticket', 'Created by'].map((c) => h('th', null, c)))),
        h('tbody', null, todo.map((v) => h('tr', { class: 'click', tabindex: 0, onclick: () => { location.hash = `#/wb/v/${v.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
          h('td', null, h('strong', null, v.id)), h('td', null, v.label), h('td', null, v.scope.level === 'national' ? 'National' : v.scope.state), h('td', null, v.effectiveFrom), h('td', null, h('span', { class: `badge ${VSTATUS[v.status]}` }, v.status.replace('_', ' '))), h('td', { class: 'small' }, v.changeTicket?.reference || '—'), h('td', null, v.createdBy)))))) : h('div', { class: 'empty' }, 'Nothing pending.'));
  }

  function drawResolver() {
    const state = h('select', { 'aria-label': 'State' }, Object.entries(STATE_NAME).map(([c, n]) => h('option', { value: c }, `${n} (${c})`)));
    const date = h('input', { type: 'date', value: todayIso(), 'aria-label': 'Date' });
    const out = h('div', { class: 'small', style: { marginTop: '.5rem' } });
    const run = async () => {
      try {
        const r = await api.get(`/rating-versions/resolve?productId=${productId}&state=${state.value}&date=${date.value}`);
        out.replaceChildren(h('div', null, h('strong', null, r.explanation)), h('div', { class: 'muted' }, `Product definition: ${r.productVersion?.id ?? 'none'} · effective config hash ${r.effectiveConfigHash?.slice(0, 12) ?? '—'}…`));
      } catch (e) { out.replaceChildren(notice('bad', e.message)); }
    };
    mount(resolver, h('div', { class: 'card' }, h('h3', null, 'Which versions apply?'), h('p', { class: 'muted small' }, 'Pick a state and date to see what a quote would use — national default, state override and effective date selection.'), h('div', { class: 'row' }, state, date, h('button', { class: 'btn', onclick: run }, 'Resolve')), out));
    run();
  }

  const tabs = h('div', { class: 'row', role: 'tablist', 'aria-label': 'Product' }, products.map((p) => h('button', { class: `btn${p.id === productId ? ' btn-primary' : ''}`, role: 'tab', 'aria-selected': String(p.id === productId), onclick: () => { productId = p.id; history.replaceState(null, '', `#/wb?product=${p.id}`); tabs.querySelectorAll('button').forEach((b, i) => { b.className = `btn${products[i].id === productId ? ' btn-primary' : ''}`; b.setAttribute('aria-selected', String(products[i].id === productId)); }); load(); drawResolver(); } }, p.name)));

  const actions = can('config:edit') ? h('div', { class: 'row' },
    h('button', { class: 'btn btn-primary', onclick: () => newDraftDialog() }, 'New draft…'),
    h('button', { class: 'btn', onclick: () => demoDialog() }, 'Generate demo draft…')) : null;

  async function newDraftDialog() {
    const { versions } = await api.get(`/rating-versions?productId=${productId}`);
    const { versions: pv } = await api.get(`/product-versions?productId=${productId}`);
    return modal('New draft version', (close) => {
      const kind = h('select', { 'aria-label': 'Kind' }, h('option', { value: 'rating' }, 'Rating version (rates, rules, calculation)'), h('option', { value: 'product' }, 'Product version (inputs and questions)'));
      const from = h('select', { 'aria-label': 'Clone from' });
      const fill = () => { const list = kind.value === 'rating' ? versions : pv; mount(from, list.slice().reverse().map((v) => h('option', { value: v.id }, `${v.id} — ${v.label} [${v.status}]`))); };
      kind.addEventListener('change', fill); fill();
      const date = h('input', { type: 'date', value: '2026-12-01', 'aria-label': 'Effective date' });
      const label = h('input', { type: 'text', placeholder: 'Short description', 'aria-label': 'Label' });
      const tref = h('input', { type: 'text', placeholder: 'e.g. SYN-1234', 'aria-label': 'Ticket reference' });
      const ttext = h('textarea', { rows: 3, placeholder: 'Paste synthetic change-request text (the pilot stores it; it does not analyse it)', style: { fontFamily: 'inherit' }, 'aria-label': 'Ticket text' });
      const err = h('div');
      return h('div', null, h('div', { class: 'field' }, h('label', null, 'Kind'), kind), h('div', { class: 'field' }, h('label', null, 'Clone from'), from, h('div', { class: 'help' }, 'The draft starts as a copy and keeps the same scope.')),
        h('div', { class: 'field' }, h('label', null, 'Effective date'), date), h('div', { class: 'field' }, h('label', null, 'Label'), label),
        h('div', { class: 'field' }, h('label', null, 'Change ticket reference'), tref), h('div', { class: 'field' }, h('label', null, 'Change ticket text'), ttext), err,
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: async () => {
          try {
            const path = kind.value === 'rating' ? '/rating-versions' : '/product-versions';
            const out = await api.post(path, { productId, fromVersionId: from.value, effectiveFrom: date.value, label: label.value || undefined, changeTicket: tref.value || ttext.value ? { reference: tref.value || null, text: ttext.value || null } : undefined });
            close(); toast(`Created ${out.version.id}`, 'ok'); location.hash = `#/wb/v/${out.version.id}`;
          } catch (e) { err.replaceChildren(notice('bad', e.message)); }
        } }, 'Create draft')));
    });
  }

  function demoDialog() {
    return modal('Generate a demo draft', (close) => {
      const kind = h('select', { 'aria-label': 'Kind' },
        h('option', { value: 'rate_change' }, 'Normal rate change (scale base rates)'), h('option', { value: 'defect_silent' }, 'Intentional defect – silent (passes structural validation)'), h('option', { value: 'defect_structural' }, 'Intentional defect – structural (fails validation)'));
      const pct = h('input', { type: 'number', value: '4', step: '0.5', 'aria-label': 'Percent' });
      const err = h('div');
      return h('div', null, h('p', { class: 'muted' }, 'Creates a draft from the current national version. Nothing is activated; use it to rehearse validation, diff, scenarios and approval.'),
        h('div', { class: 'field' }, h('label', null, 'Kind'), kind), h('div', { class: 'field' }, h('label', null, 'Rate change %'), pct, h('div', { class: 'help' }, 'Used for “normal rate change” only.')), err,
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: async () => {
          try { const out = await api.post('/demo/drafts', { productId, kind: kind.value, pct: Number(pct.value) }); close(); location.hash = `#/wb/v/${out.version.id}`; } catch (e) { err.replaceChildren(notice('bad', e.message)); }
        } }, 'Generate')));
    });
  }

  await load();
  drawResolver();
  return wbLayout('#/wb',
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Pricing workbench'), h('p', null, 'Versioned, effective-dated synthetic rating configuration. Draft → validate → approve → promote, with rollback and a full audit trail.')), actions),
    notice('info', roleHelp(), ' Rates here are invented demonstration values, not filed rates.'), tabs, h('div', { style: { height: '1rem' } }), resolver, body);
}
