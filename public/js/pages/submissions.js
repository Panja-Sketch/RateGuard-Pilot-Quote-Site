import { h, mount, confirmDialog, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { statusBadge, when, money } from '../lib/format.js';

export async function submissionsPage() {
  const { products } = await api.get('/products');
  const f = { productId: '', status: '', q: '' };
  const tbody = h('tbody');
  const count = h('span', { class: 'muted small' });

  async function load() {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const { submissions } = await api.get(`/submissions${qs ? `?${qs}` : ''}`);
    count.textContent = `${submissions.length} submission${submissions.length === 1 ? '' : 's'}`;
    mount(tbody, submissions.length ? submissions.map((s) => h('tr', { class: 'click', tabindex: 0, onclick: () => { location.hash = s.latestQuoteId ? `#/s/${s.id}/quote` : `#/s/${s.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
      h('td', null, h('strong', null, s.id), h('div', { class: 'small muted' }, s.name || '—')),
      h('td', null, products.find((p) => p.id === s.productId)?.name ?? s.productId, h('div', { class: 'small muted' }, s.transactionType.replace('_', ' ').toLowerCase())),
      h('td', null, s.state), h('td', null, s.effectiveDate), h('td', null, statusBadge(s.status), s.bind ? h('div', { class: 'small muted' }, s.bind.simulatedPolicyNumber) : null),
      h('td', { class: 'small' }, when(s.updatedAt)),
      h('td', { class: 'right' }, h('button', { class: 'btn btn-sm btn-danger', disabled: s.status === 'BOUND_SIMULATED', 'aria-label': `Delete ${s.id}`, onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmDialog('Delete submission?', `Delete ${s.id}? Its stored quotes remain in the audit trail.`, { confirmLabel: 'Delete', danger: true }))) return;
        try { await api.del(`/submissions/${s.id}`); toast('Deleted', 'ok'); load(); } catch (ex) { toast(ex.message, 'bad'); }
      } }, 'Delete')))) : h('tr', null, h('td', { colspan: 7, class: 'empty' }, 'No submissions match.')));
  }

  const search = h('input', { type: 'search', placeholder: 'Search id, name, address…', 'aria-label': 'Search', oninput: (e) => { f.q = e.target.value; clearTimeout(search._t); search._t = setTimeout(load, 250); } });
  const root = h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Saved submissions'), h('p', null, 'Synthetic submissions you can reopen, edit, requote, bind (simulated) or turn into renewal/endorsement tests.')), h('a', { class: 'btn btn-primary', href: '#/start' }, 'New quote')),
    h('div', { class: 'card' }, h('div', { class: 'row' }, search,
      h('select', { 'aria-label': 'Product', onchange: (e) => { f.productId = e.target.value; load(); } }, h('option', { value: '' }, 'All products'), products.map((p) => h('option', { value: p.id }, p.name))),
      h('select', { 'aria-label': 'Status', onchange: (e) => { f.status = e.target.value; load(); } }, h('option', { value: '' }, 'Any status'), ['DRAFT', 'QUOTED', 'REFERRED', 'DECLINED', 'INFO_REQUIRED', 'BOUND_SIMULATED'].map((s) => h('option', { value: s }, s.replace('_', ' ')))), count)),
    h('div', { class: 'card flush' }, h('div', { class: 'scroll-x' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Submission', 'Product', 'State', 'Effective', 'Status', 'Updated', ''].map((c) => h('th', null, c)))), tbody))));
  await load();
  return root;
}
void money;
