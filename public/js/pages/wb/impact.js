// The pilot's own scenario runner ("pilot test tooling"). Not RateGuard assurance.
import { h, notice, mount, spinner, toast } from '../../lib/dom.js';
import { api, can } from '../../lib/api.js';
import { wbLayout } from './index.js';
import { stat } from './report.js';
import { money, pct, when, STATE_NAME } from '../../lib/format.js';

export async function impactPage(_p, query) {
  const { products } = await api.get('/products');
  const s = { productId: query.get('product') || products[0].id, baseline: query.get('baseline') || '', candidate: query.get('candidate') || '', states: ['AZ', 'FL', 'NY'], variationStates: ['AZ'], expected: '', tol: '1.5' };
  if (s.candidate && !query.get('product')) s.productId = /^(PA|HO|CP|BOP)-/.test(s.candidate) ? ({ PA: 'personal-auto', HO: 'homeowners', CP: 'commercial-property', BOP: 'bop' })[s.candidate.split('-')[0]] : s.productId;
  const form = h('div', { class: 'card' });
  const result = h('div');
  let versions = [];

  async function loadVersions() { versions = (await api.get(`/rating-versions?productId=${s.productId}`)).versions; }
  function drawForm() {
    const nat = versions.filter((v) => v.scope.level === 'national');
    const opt = (v, sel) => h('option', { value: v.id, selected: sel }, `${v.id} — ${v.label} [${v.status}]`);
    form.replaceChildren(
      h('h3', null, 'Compare two configurations over the synthetic scenario set'),
      notice('info', h('strong', null, 'Pilot test tooling. '), 'Both sides are rated by this pilot\'s own engine, so this shows what a change DOES, not whether it is RIGHT. It is not RateGuard assurance and has no independent expected-premium model.'),
      h('div', { class: 'fields-grid' },
        h('div', { class: 'field' }, h('label', null, 'Product'), h('select', { onchange: async (e) => { s.productId = e.target.value; s.baseline = ''; s.candidate = ''; await loadVersions(); drawForm(); } }, products.map((p) => h('option', { value: p.id, selected: p.id === s.productId }, p.name)))),
        h('div', { class: 'field' }, h('label', null, 'Baseline (national version)'), h('select', { onchange: (e) => { s.baseline = e.target.value; } }, h('option', { value: '' }, 'In force on each scenario date'), nat.map((v) => opt(v, v.id === s.baseline)))),
        h('div', { class: 'field' }, h('label', null, 'Candidate (national version)'), h('select', { onchange: (e) => { s.candidate = e.target.value; } }, h('option', { value: '' }, 'Choose…'), nat.map((v) => opt(v, v.id === s.candidate))), h('div', { class: 'help' }, 'Drafts can be run before approval; nothing is activated.')),
        h('div', { class: 'field' }, h('label', null, 'Expected overall change % (optional)'), h('input', { type: 'number', step: 'any', value: s.expected, placeholder: 'e.g. 4 for a +4% rate change, 0 for “no pricing change”', oninput: (e) => { s.expected = e.target.value; } }), h('div', { class: 'help' }, 'Scenarios outside this ± tolerance are flagged.')),
        h('div', { class: 'field' }, h('label', null, 'Tolerance (± percentage points)'), h('input', { type: 'number', step: 'any', value: s.tol, oninput: (e) => { s.tol = e.target.value; } }))),
      h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Baseline scenarios in states'), h('div', { class: 'pills' }, Object.keys(STATE_NAME).map((c) => h('label', { class: 'pill' }, h('input', { type: 'checkbox', checked: s.states.includes(c), onchange: (e) => { s.states = e.target.checked ? [...s.states, c] : s.states.filter((x) => x !== c); } }), h('span', null, c))))),
      h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Product-specific variations in states'), h('div', { class: 'pills' }, Object.keys(STATE_NAME).map((c) => h('label', { class: 'pill' }, h('input', { type: 'checkbox', checked: s.variationStates.includes(c), onchange: (e) => { s.variationStates = e.target.checked ? [...s.variationStates, c] : s.variationStates.filter((x) => x !== c); } }), h('span', null, c))))),
      can('testtools:run') ? h('button', { class: 'btn btn-primary', onclick: run }, 'Run scenarios') : null);
  }

  async function run() {
    if (!s.candidate) { toast('Choose a candidate version.', 'bad'); return; }
    mount(result, h('div', { class: 'empty' }, spinner(), ' Rating scenarios…'));
    try {
      const body = { productId: s.productId, candidate: { national: s.candidate }, states: s.states, variationStates: s.variationStates, label: `${s.baseline || 'in force'} vs ${s.candidate}` };
      if (s.baseline) body.baseline = { national: s.baseline };
      if (s.expected !== '') { body.expectedChangePct = Number(s.expected); body.tolerancePct = Number(s.tol) || 1.5; }
      show(await api.post('/test-tools/compare', body));
      loadRuns();
    } catch (e) { mount(result, notice('bad', e.message)); }
  }

  function show(run) {
    const sm = run.summary;
    const rows = run.rows;
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.pct ?? 0)));
    const filter = h('select', { 'aria-label': 'Filter rows', onchange: drawRows }, h('option', { value: 'all' }, 'All scenarios'), h('option', { value: 'changed' }, 'Changed only'), h('option', { value: 'flagged' }, 'Flagged only'));
    const tbody = h('tbody'); const bars = h('div', { class: 'bars' });
    function drawRows() {
      const f = filter.value;
      const list = rows.filter((r) => f === 'all' || (f === 'changed' && Math.abs(r.pct ?? 0) >= 0.005) || (f === 'flagged' && r.flag));
      mount(tbody, list.map((r) => h('tr', null, h('td', null, r.scenarioId.split(':').slice(1).join(' · ')), h('td', null, r.statusBefore === r.statusAfter ? r.statusAfter : `${r.statusBefore} → ${r.statusAfter}`),
        h('td', { class: 'num' }, money(r.before)), h('td', { class: 'num' }, money(r.after)), h('td', { class: 'num' }, r.pct === null ? '—' : pct(r.pct)),
        h('td', { class: 'small' }, (r.componentChanges || []).map((c) => `${c.id}: ${c.delta > 0 ? '+' : ''}${c.delta}`).join(', ')),
        h('td', null, r.flag ? h('span', { class: `badge ${r.flag === 'STATUS_CHANGED' ? 'info' : 'bad'}` }, r.flag === 'STATUS_CHANGED' ? 'status changed' : 'outside expectation') : ''))));
      mount(bars, list.filter((r) => r.pct !== null).slice(0, 80).map((r) => {
        const w = Math.min(50, (Math.abs(r.pct) / maxAbs) * 50);
        return h('div', { class: 'bar-row' }, h('span', { class: 'mono', title: r.scenarioId }, r.scenarioId.split(':').slice(1).join(' ').slice(0, 34)),
          h('div', { class: 'bar-track' }, h('div', { class: 'bar-zero', style: { left: '50%' } }), h('div', { class: 'bar-fill', style: { left: r.pct >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: r.flag ? 'var(--bad)' : r.pct >= 0 ? 'var(--info)' : 'var(--ok)' } })), h('span', { class: 'num' }, pct(r.pct)));
      }));
    }
    mount(result,
      h('h2', null, `Run ${run.id}`), h('p', { class: 'muted' }, `${run.label || ''} · ${when(run.createdAt)} · ${run.createdBy}`),
      notice('info', run.notice),
      h('div', { class: 'grid grid-4', style: { marginBottom: '1rem' } }, stat(sm.scenarios, 'scenarios'), stat(`${sm.changed} / ${sm.unchanged}`, 'changed / unchanged'), stat(`${pct(sm.averagePct)}`, 'average change'), stat(`${pct(sm.minPercent ?? sm.minPct)} … ${pct(sm.maxPct)}`, 'range')),
      sm.expectedChangePct !== null ? notice(sm.outsideExpectation ? 'bad' : 'ok', sm.outsideExpectation ? `${sm.outsideExpectation} scenario(s) moved by something other than the expected ${sm.expectedChangePct}% ± ${sm.tolerancePct}. Review them before approving.` : `All priced scenarios moved by about the expected ${sm.expectedChangePct}% (± ${sm.tolerancePct}).`) : null,
      sm.statusChanged ? notice('warn', `${sm.statusChanged} scenario(s) changed eligibility outcome.`) : null,
      h('div', { class: 'card' }, h('h3', null, 'Change by scenario'), bars),
      h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Scenario detail'), filter),
        h('div', { class: 'scroll-y' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Scenario', 'Outcome', 'Before', 'After', 'Change', 'Biggest component moves', 'Flag'].map((c, i) => h('th', { class: i >= 2 && i <= 4 ? 'num' : '' }, c)))), tbody))));
    drawRows();
  }

  const runs = h('div', { class: 'card flush' });
  async function loadRuns() {
    const { runs: list } = await api.get('/test-tools/runs');
    mount(runs, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Previous runs')),
      list.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, ['Run', 'Product', 'Comparison', 'Changed', 'Avg', 'When', ''].map((c) => h('th', null, c)))), h('tbody', null, list.slice(0, 15).map((r) => h('tr', null, h('td', null, r.id), h('td', null, r.productId), h('td', null, r.label || ''), h('td', null, `${r.summary.changed}/${r.summary.scenarios}`), h('td', null, pct(r.summary.averagePct)), h('td', { class: 'small' }, when(r.createdAt)),
        h('td', null, h('button', { class: 'btn btn-sm', onclick: async () => show(await api.get(`/test-tools/runs/${r.id}`)) }, 'Open')))))) : h('div', { class: 'empty' }, 'No runs yet.'));
  }

  await loadVersions(); drawForm(); await loadRuns();
  if (s.candidate && query.get('go') === '1') run();
  return wbLayout('#/wb/impact', h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Impact & scenarios'), h('p', null, 'See which synthetic scenarios a configuration change moves — and by how much.'))), form, result, runs));
}
