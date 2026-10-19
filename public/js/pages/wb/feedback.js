import { h, mount, notice, toast, promptDialog } from '../../lib/dom.js';
import { api, can } from '../../lib/api.js';
import { wbLayout } from './index.js';
import { when } from '../../lib/format.js';

const TYPES = { mapping_correction: 'Workbook mapping correction', terminology: 'Terminology', scenario_useful: 'Scenario usefulness', scenario_missed_case: 'Missed test case', explanation_comment: 'Rating explanation comment' };
const KIND = { submitted: 'warn', accepted: 'ok', rejected: 'bad' };

export async function feedbackPage() {
  const { products } = await api.get('/products');
  const f = { productId: '', type: '', status: '' };
  const list = h('div'); const hints = h('div');

  async function load() {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const { feedback } = await api.get(`/feedback${qs ? `?${qs}` : ''}`);
    mount(list, h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, `Feedback (${feedback.length})`),
      h('div', { class: 'row' }, sel('Product', ['', ...products.map((p) => p.id)], (v) => { f.productId = v; load(); }), sel('Type', ['', ...Object.keys(TYPES)], (v) => { f.type = v; load(); }, TYPES), sel('Status', ['', 'submitted', 'accepted', 'rejected'], (v) => { f.status = v; load(); }))),
      feedback.length ? h('div', { class: 'scroll-x' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['ID', 'Type', 'Scope', 'Content', 'Status', 'By', ''].map((c) => h('th', null, c)))),
        h('tbody', null, feedback.map((x) => h('tr', null, h('td', null, x.id), h('td', null, TYPES[x.type]),
          h('td', { class: 'small' }, `${x.productId}${x.versionId ? ` · ${x.versionId}` : ''}${x.state ? ` · ${x.state}` : ''}${x.quoteId ? ` · ${x.quoteId}` : ''}`),
          h('td', null, x.comment, x.type === 'mapping_correction' ? h('div', { class: 'mono small' }, `${x.payload.sourceSheet}.${x.payload.sourceColumn} → ${x.payload.targetTable}.${x.payload.targetColumn}`) : null, x.type === 'terminology' ? h('div', { class: 'mono small' }, `${x.payload.term} = ${x.payload.meaning}`) : null, x.type === 'scenario_useful' ? h('div', { class: 'small' }, x.payload.useful ? '👍 useful' : '👎 not useful') : null),
          h('td', null, h('span', { class: `badge ${KIND[x.status]}` }, x.status), x.review ? h('div', { class: 'small muted' }, `${x.review.by}: ${x.review.comment || ''}`) : null), h('td', { class: 'small' }, x.createdBy, h('div', { class: 'muted' }, when(x.createdAt))),
          h('td', null, can('feedback:review') && x.status === 'submitted' ? h('div', { class: 'row' }, h('button', { class: 'btn btn-sm btn-primary', onclick: () => review(x, 'accept') }, 'Accept'), h('button', { class: 'btn btn-sm', onclick: () => review(x, 'reject') }, 'Reject')) : null)))))) : h('div', { class: 'empty' }, 'No feedback yet.')));
    const prod = f.productId || products[0].id;
    const { hints: hs } = await api.get(`/feedback/hints?productId=${prod}`);
    mount(hints, h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, `Active mapping hints – ${prod}`)),
      hs.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, ['Hint', 'Version', 'Sheet.column', '→ Table.column', 'Approved by'].map((c) => h('th', null, c)))), h('tbody', null, hs.map((x) => h('tr', null, h('td', null, x.id), h('td', null, x.version), h('td', { class: 'mono' }, `${x.sourceSheet}.${x.sourceColumn}`), h('td', { class: 'mono' }, `${x.targetTable}.${x.targetColumn}`), h('td', null, `${x.approvedBy} · ${when(x.approvedAt)}`))))) : h('div', { class: 'empty' }, 'No reviewed hints for this product. Accepted mapping corrections appear here and are offered as suggestions (never auto-applied).')));
  }
  const sel = (label, vals, on, names = {}) => h('select', { 'aria-label': label, onchange: (e) => on(e.target.value) }, vals.map((v) => h('option', { value: v }, v === '' ? `Any ${label.toLowerCase()}` : names[v] || v)));

  async function review(x, decision) {
    const comment = await promptDialog(`${decision === 'accept' ? 'Accept' : 'Reject'} ${x.id}`, 'Reviewer comment', { required: decision === 'reject', confirmLabel: decision === 'accept' ? 'Accept' : 'Reject' });
    if (comment === undefined) return;
    try { const out = await api.post(`/feedback/${x.id}/review`, { decision, comment }); toast(out.hint ? `Accepted. Mapping hint ${out.hint.id} v${out.hint.version} is now a suggestion for ${x.productId}.` : `${decision === 'accept' ? 'Accepted' : 'Rejected'}.`, 'ok'); load(); } catch (e) { toast(e.message, 'bad'); }
  }

  const create = h('div', { class: 'card' });
  function drawCreate() {
    const st = { type: 'scenario_missed_case', productId: products[0].id, versionId: '', comment: '', a: '', b: '', c: '', d: '', useful: 'true' };
    const fields = h('div');
    const draw = () => {
      mount(fields,
        st.type === 'mapping_correction' ? h('div', { class: 'fields-grid' }, ['Source sheet', 'Source column', 'Target table', 'Target column'].map((l, i) => h('div', { class: 'field' }, h('label', null, l), h('input', { type: 'text', oninput: (e) => { st['abcd'[i]] = e.target.value; } })))) : null,
        st.type === 'terminology' ? h('div', { class: 'fields-grid' }, h('div', { class: 'field' }, h('label', null, 'Term'), h('input', { type: 'text', oninput: (e) => { st.a = e.target.value; } })), h('div', { class: 'field' }, h('label', null, 'Meaning in this insurer / profile'), h('input', { type: 'text', oninput: (e) => { st.b = e.target.value; } }))) : null,
        st.type === 'scenario_useful' ? h('div', { class: 'field' }, h('label', null, 'Was the scenario set useful?'), h('select', { onchange: (e) => { st.useful = e.target.value; } }, h('option', { value: 'true' }, 'Yes, useful'), h('option', { value: 'false' }, 'No, not useful'))) : null);
    };
    mount(create, h('h3', null, 'Add feedback'), h('p', { class: 'small muted' }, 'Feedback is stored with its product, profile and version context and must be reviewed. It never changes a rate, a premium calculation or a validation result.'),
      h('div', { class: 'fields-grid' },
        h('div', { class: 'field' }, h('label', null, 'Type'), h('select', { onchange: (e) => { st.type = e.target.value; draw(); } }, Object.entries(TYPES).map(([k, n]) => h('option', { value: k, selected: k === st.type }, n)))),
        h('div', { class: 'field' }, h('label', null, 'Product'), h('select', { onchange: (e) => { st.productId = e.target.value; } }, products.map((p) => h('option', { value: p.id }, p.name)))),
        h('div', { class: 'field' }, h('label', null, 'Version (optional)'), h('input', { type: 'text', placeholder: 'e.g. HO-NAT-v3', oninput: (e) => { st.versionId = e.target.value; } }))),
      fields, h('div', { class: 'field' }, h('label', null, 'Comment'), h('textarea', { rows: 3, style: { fontFamily: 'inherit' }, oninput: (e) => { st.comment = e.target.value; } })),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        const payload = st.type === 'mapping_correction' ? { sourceSheet: st.a, sourceColumn: st.b, targetTable: st.c, targetColumn: st.d } : st.type === 'terminology' ? { term: st.a, meaning: st.b } : st.type === 'scenario_useful' ? { useful: st.useful === 'true' } : {};
        try { await api.post('/feedback', { type: st.type, productId: st.productId, versionId: st.versionId || undefined, comment: st.comment, payload }); toast('Feedback recorded for review', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Submit feedback'));
    draw();
  }

  await load(); drawCreate();
  return wbLayout('#/wb/feedback', h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Feedback'), h('p', null, 'Corrected mappings, terminology, scenario usefulness and explanation comments — scoped, reviewable and auditable.'))),
    notice('info', 'Accepted mapping corrections become versioned, product-scoped suggestions in the next XLSX import. A person still confirms every mapping. Nothing here is learned automatically.'), create, list, hints));
}
