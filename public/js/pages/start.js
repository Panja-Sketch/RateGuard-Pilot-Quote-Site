import { h, toast, notice } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { todayIso, addDays, STATE_NAME } from '../lib/format.js';
import { applyDefaults } from '../lib/form.js';

export async function startPage({ productId }) {
  const { products } = await api.get('/products');
  const sel = { productId: productId || null, state: 'AZ', effectiveDate: addDays(todayIso(), 14), name: '' };
  const root = h('div');
  const err = h('div');

  const draw = () => {
    root.replaceChildren(
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Start a new-business quote'), h('p', null, 'Choose the product and jurisdiction. The effective date decides which product and rating versions apply.'))),
      h('div', { class: 'card' }, h('h3', null, '1. Line of business'),
        h('div', { class: 'grid grid-4', role: 'radiogroup', 'aria-label': 'Line of business' }, products.map((p) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(sel.productId === p.id), class: `tile${sel.productId === p.id ? ' sel' : ''}`, onclick: () => { sel.productId = p.id; draw(); } },
          h('div', { class: 'ico' }, icon({ car: 'car', home: 'home', building: 'building', briefcase: 'briefcase' }[p.icon], 22)), h('h3', null, p.name), h('p', null, p.tagline))))),
      h('div', { class: 'card' }, h('h3', null, '2. Policy details'),
        h('div', { class: 'fields-grid' },
          h('div', { class: 'field' }, h('label', { for: 'st-state' }, 'Jurisdiction (state) ', h('span', { class: 'req' }, '*')), h('select', { id: 'st-state', onchange: (e) => { sel.state = e.target.value; } }, Object.entries(STATE_NAME).map(([c, n]) => h('option', { value: c, selected: c === sel.state }, `${n} (${c})`))), h('div', { class: 'help' }, 'Demo jurisdiction set — configurable, not a real footprint.')),
          h('div', { class: 'field' }, h('label', { for: 'st-date' }, 'Policy effective date ', h('span', { class: 'req' }, '*')), h('input', { id: 'st-date', type: 'date', value: sel.effectiveDate, onchange: (e) => { sel.effectiveDate = e.target.value; } }), h('div', { class: 'help' }, 'Selects the national + state rating versions in force on this date.')),
          h('div', { class: 'field' }, h('label', { for: 'st-name' }, 'Submission name (optional)'), h('input', { id: 'st-name', type: 'text', maxlength: 80, value: sel.name, placeholder: 'e.g. Demo household', oninput: (e) => { sel.name = e.target.value; } })))),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: !sel.productId, onclick: create }, 'Start quote'), h('a', { class: 'btn', href: '#/' }, 'Cancel')),
      h('p', { class: 'small muted', style: { marginTop: '1rem' } }, 'Use fictional people, addresses and businesses only. Do not enter real personal data.'));
  };

  async function create() {
    err.replaceChildren();
    try {
      if (!sel.effectiveDate) throw new Error('Choose an effective date.');
      const schema = await api.get(`/products/${sel.productId}/schema?date=${sel.effectiveDate}`);
      const data = applyDefaults(schema.sections, { risk: {}, coverages: {} });
      const { submission } = await api.post('/submissions', { productId: sel.productId, state: sel.state, effectiveDate: sel.effectiveDate, name: sel.name, risk: data.risk, coverages: data.coverages });
      toast(`Created ${submission.id}`, 'ok');
      location.hash = `#/s/${submission.id}`;
    } catch (e) { err.replaceChildren(notice('bad', e.message)); }
  }
  draw();
  return root;
}
