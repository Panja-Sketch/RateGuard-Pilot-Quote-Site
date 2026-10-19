import { h, toast, notice, modal, confirmDialog, copyText, downloadBlob, mount } from '../lib/dom.js';
import { api, can, role } from '../lib/api.js';
import { summarize } from '../lib/form.js';
import { money, signedMoney, statusBadge, when, shortHash, STATE_NAME, todayIso, addDays } from '../lib/format.js';
import { exprStr } from '../lib/exprstr.js';

export async function quotePage({ id }) {
  const { submission } = await api.get(`/submissions/${id}`);
  const { quotes } = await api.get(`/submissions/${id}/quotes`);
  if (!quotes.length) { location.hash = `#/s/${id}`; return h('div'); }
  return renderQuote(quotes[quotes.length - 1], { submission, history: quotes });
}

export async function storedQuotePage({ quoteId }) {
  const q = await api.get(`/quotes/${quoteId}`);
  let submission = null; let history = [q];
  if (q.submissionId) {
    try { submission = (await api.get(`/submissions/${q.submissionId}`)).submission; history = (await api.get(`/submissions/${q.submissionId}/quotes`)).quotes; } catch { /* not visible to this role */ }
  }
  return renderQuote(q, { submission, history });
}

const REASON_KIND = { decline: ['bad', 'Not eligible'], refer: ['warn', 'Referral'], info: ['info', 'Information needed'] };

async function renderQuote(q, { submission, history }) {
  const root = h('div');
  const isQuoted = q.status === 'QUOTED';
  const bound = submission?.status === 'BOUND_SIMULATED';
  const tabs = isQuoted ? ['Premium breakdown', 'Why this price', 'Rating trace', 'Versions & configuration', 'Inputs', 'Raw JSON'] : ['What happened', 'Rating trace', 'Versions & configuration', 'Inputs', 'Raw JSON'];
  let active = 0;
  const body = h('div');

  const switcher = history.length > 1 ? h('label', { class: 'small' }, 'Quote history: ', h('select', { 'aria-label': 'Quote history', onchange: (e) => { location.hash = `#/q/${e.target.value}`; } }, history.slice().reverse().map((x) => h('option', { value: x.quoteId, selected: x.quoteId === q.quoteId }, `${x.quoteId} · ${x.status}${x.premium ? ` · ${money(x.premium.total)}` : ''} · ${when(x.createdAt)}`)))) : null;

  async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg, 'ok'); } catch (e) { toast(e.message, 'bad'); } }

  const actions = h('div', { class: 'row' },
    submission ? h('a', { class: 'btn btn-primary', href: `#/s/${submission.id}` }, bound ? 'View inputs' : 'Edit & requote') : null,
    isQuoted && submission && !bound && can('submission:write') ? h('button', { class: 'btn', onclick: () => act(async () => {
      const ok = await confirmDialog('Simulate bind?', 'This records a SIMULATED issuance for testing. No policy, binder or coverage is created, and no real person is insured.', { confirmLabel: 'Simulate bind' });
      if (!ok) return;
      await api.post(`/submissions/${submission.id}/bind-simulated`); location.reload();
    }) }, 'Simulate bind') : null,
    isQuoted && submission && can('submission:write') ? h('button', { class: 'btn', onclick: () => scenarioDialog(submission, 'RENEWAL') }, 'Renewal scenario') : null,
    isQuoted && submission && can('submission:write') ? h('button', { class: 'btn', onclick: () => scenarioDialog(submission, 'ENDORSEMENT') }, 'Endorsement scenario') : null,
    h('button', { class: 'btn', onclick: () => downloadBlob(new Blob([JSON.stringify(q, null, 2)], { type: 'application/json' }), `${q.quoteId || q.scenarioId}.json`) }, 'Download JSON'),
    h('button', { class: 'btn', onclick: () => copyText(JSON.stringify({ scenarioId: q.scenarioId, productId: q.productId, state: q.state, transactionType: q.transactionType, effectiveDate: q.effectiveDate, risk: q.risk, coverages: q.coverages }, null, 2)) }, 'Copy API request'));

  const tabBar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map((t, i) => h('button', { role: 'tab', 'aria-selected': String(i === 0), class: i === 0 ? 'active' : '', onclick: () => { active = i; drawTabs(); } }, t)));
  function drawTabs() {
    [...tabBar.children].forEach((b, i) => { b.classList.toggle('active', i === active); b.setAttribute('aria-selected', String(i === active)); });
    const name = tabs[active];
    body.replaceChildren(h('div', { class: 'sr-only' }, name));
    Promise.resolve(tabContent(name)).then((n) => body.append(n)).catch((e) => body.append(notice('bad', e.message)));
  }

  function tabContent(name) {
    switch (name) {
      case 'Premium breakdown': return breakdownTab(q);
      case 'Why this price': return explainTab(q);
      case 'What happened': return reasonsTab(q);
      case 'Rating trace': return traceTab(q);
      case 'Versions & configuration': return versionsTab(q);
      case 'Inputs': return inputsTab(q);
      default: return h('div', { class: 'code', tabindex: 0, role: 'region', 'aria-label': 'Raw quote JSON' }, JSON.stringify(q, null, 2));
    }
  }

  const hero = isQuoted ? h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('div', null, h('div', { class: 'muted small' }, q.transactionType === 'ENDORSEMENT' ? 'Revised annual premium (illustrative)' : `${q.premium.termMonths}-month premium (illustrative)`),
        h('div', { class: 'premium-hero' }, h('span', { class: 'amt' }, money(q.premium.total)), h('span', { class: 'stamp' }, 'SYNTHETIC · NOT AN OFFER')),
        h('div', { class: 'small muted' }, `Subtotal ${money(q.premium.subtotal)} · ${q.premium.components.length} components · ${q.premium.modifiers.length} modifiers`)),
      h('div', null, plansTable(q))),
    q.endorsement ? endorsementBlock(q.endorsement) : null)
    : h('div', { class: 'card' }, h('div', { class: 'row between' }, h('div', null, h('h2', { style: { margin: 0 } }, q.status === 'REFERRED' ? 'This risk needs an underwriter' : q.status === 'DECLINED' ? 'This risk is not eligible for an online quote' : q.status === 'INFO_REQUIRED' ? 'We need a little more information' : q.status === 'INVALID' ? 'Some answers need correcting' : 'This quote could not be rated'), h('p', { class: 'muted', style: { margin: '.2rem 0 0' } }, 'No premium is shown because a firm illustrative price cannot be produced from these answers.')), h('span', { class: 'stamp' }, 'SYNTHETIC')));

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, `${titleOf(q)} quote`), h('p', null, `${STATE_NAME[q.state] ?? q.state} · ${q.transactionType.replace('_', ' ').toLowerCase()} effective ${q.effectiveDate} · ${q.quoteId ?? q.scenarioId} `, statusBadge(q.status), bound ? [' ', h('span', { class: 'badge info' }, `SIMULATED bind ${submission.bind.simulatedPolicyNumber} – no coverage`)] : null)), switcher),
    notice('warn', h('strong', null, 'Synthetic illustration. '), q.disclaimer.replace('SYNTHETIC ILLUSTRATION ONLY. ', '')),
    q.versions.containsUnapprovedVersion ? notice('bad', 'This quote used a version that is not active (a pinned draft). It must not be treated as an approved price.') : null,
    hero, actions, h('div', { style: { height: '1rem' } }), tabBar, body);
  drawTabs();
  return root;
}

const titleOf = (q) => ({ PERSONAL_AUTO: 'Personal Auto', HOMEOWNERS: 'Homeowners', COMMERCIAL_PROPERTY: 'Commercial Property', BOP: 'BOP' }[q.lineOfBusiness] || q.productId);

function plansTable(q) {
  const plans = q.premium.paymentPlans || [];
  if (!plans.length) return null;
  return h('table', { class: 't', style: { minWidth: '320px' } }, h('caption', { class: 'small muted', style: { textAlign: 'left' } }, 'Payment options (illustrative)'),
    h('thead', null, h('tr', null, ['Plan', 'Due now', 'Then', 'Total'].map((c) => h('th', { class: c === 'Plan' ? '' : 'num' }, c)))),
    h('tbody', null, plans.map((p) => h('tr', null, h('td', null, p.label), h('td', { class: 'num' }, money(p.downPayment)), h('td', { class: 'num' }, p.installmentCount ? `${p.installmentCount} × ${money(p.installment)}` : '—'), h('td', { class: 'num' }, money(p.total))))));
}

function endorsementBlock(e) {
  if (!e.computed) return notice('warn', e.reason);
  return h('div', { style: { marginTop: '.8rem' } }, notice('info', h('strong', null, 'Mid-term change (endorsement): '), `prior ${money(e.priorPremium)} → new ${money(e.newPremium)} = ${signedMoney(e.annualPremiumChange)}/yr. Pro-rated for ${e.daysRemaining} of ${e.termDays} remaining days: `, h('strong', null, signedMoney(e.proratedChange)), ` (policy expires ${e.policyExpirationDate}). ${e.method}.`));
}

// ---------- tabs ----------
function breakdownTab(q) {
  const p = q.premium;
  const groups = new Map();
  for (const c of p.components) { const k = c.group || c.coverage || 'Premium'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const modAgg = new Map();
  for (const m of p.modifiers) { const k = `${m.id}`; const cur = modAgg.get(k) || { ...m, amountEffect: 0, scopes: [] }; cur.amountEffect = Math.round((cur.amountEffect + m.amountEffect) * 100) / 100; if (m.scope) cur.scopes.push(m.scope); modAgg.set(k, cur); }
  const out = h('div');
  for (const [name, list] of groups) {
    const sub = list.reduce((s, c) => s + c.amount, 0);
    out.append(h('div', { class: 'bd-group' }, h('h4', null, h('span', null, name), h('span', { class: 'num' }, money(Math.round(sub * 100) / 100))),
      h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Coverage / component'), h('th', { class: 'num' }, 'Before adjustments'), h('th', { class: 'num' }, 'Premium'))),
        h('tbody', null, list.map((c) => h('tr', null, h('td', null, c.label, c.tags?.length ? h('span', { class: 'small muted' }, `  ${c.tags.join(' · ')}`) : null),
          h('td', { class: 'num' }, c.amountBeforeModifiers !== c.amount ? h('span', { class: 'strike' }, money(c.amountBeforeModifiers)) : '—'), h('td', { class: 'num' }, money(c.amount))))))));
  }
  if (modAgg.size) out.append(h('div', { class: 'bd-group' }, h('h4', null, h('span', null, 'Credits, discounts and surcharges (applied in order)')),
    h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Adjustment'), h('th', { class: 'num' }, 'Factor'), h('th', { class: 'num' }, 'Effect on premium'))),
      h('tbody', null, [...modAgg.values()].map((m) => h('tr', null, h('td', null, m.label, m.scopes.length ? h('span', { class: 'small muted' }, `  (${[...new Set(m.scopes)].join(', ')})`) : null, ' ', h('span', { class: `badge ${m.factor < 1 ? 'ok' : 'warn'}` }, m.kind)), h('td', { class: 'num' }, `× ${m.factor}`), h('td', { class: `num ${m.amountEffect < 0 ? 'neg' : 'pos'}` }, signedMoney(m.amountEffect))))))));
  if (p.fees.length || p.adjustments.length) out.append(h('div', { class: 'bd-group' }, h('h4', null, h('span', null, 'Fees and limits')),
    h('table', { class: 't' }, h('tbody', null, [...p.fees.map((f) => h('tr', null, h('td', null, f.label), h('td', { class: 'num' }, money(f.amount)))), ...p.adjustments.map((a) => h('tr', null, h('td', null, a.label), h('td', { class: 'num' }, signedMoney(a.amount))))]))));
  out.append(h('div', { class: 'card', style: { background: 'var(--primary-50)' } }, h('div', { class: 'row between' }, h('strong', null, 'Total illustrative premium'), h('strong', { style: { fontSize: '1.3rem' } }, money(p.total))),
    h('div', { class: 'small muted' }, `Rounded half-up to ${p.rounding.places} decimals per component; total = components + fees + limit adjustments.`)));
  return out;
}

function explainTab(q) {
  const out = h('div');
  const p = q.premium;
  const mods = new Map();
  for (const m of p.modifiers) { const c = mods.get(m.id) || { ...m, amountEffect: 0 }; c.amountEffect += m.amountEffect; mods.set(m.id, c); }
  const sorted = [...mods.values()].sort((a, b) => Math.abs(b.amountEffect) - Math.abs(a.amountEffect));
  out.append(h('div', { class: 'card' }, h('h3', null, 'What moved this price most'),
    sorted.length ? h('ul', { style: { margin: '0 0 0 1.1rem', padding: 0 } }, sorted.slice(0, 6).map((m) => h('li', null, h('strong', null, m.label), `: × ${m.factor} → `, h('span', { class: m.amountEffect < 0 ? 'neg' : 'pos' }, signedMoney(Math.round(m.amountEffect * 100) / 100))))) : h('p', { class: 'muted' }, 'No credits or surcharges applied.'),
    h('p', { class: 'small muted', style: { marginTop: '.6rem' } }, 'Each factor below comes from a rate table in the listed configuration version. Change the answers or the effective date and the factors can change.')));
  const lookups = (q.trace || []).filter((t) => t.op === 'lookup' && !t.skipped);
  if (!lookups.length) out.append(notice('info', 'This quote was produced without a trace. Request it with options.trace = true.'));
  const byScope = new Map();
  for (const t of lookups) { const k = t.scope || 'Policy-level'; if (!byScope.has(k)) byScope.set(k, []); byScope.get(k).push(t); }
  for (const [scope, list] of byScope) {
    out.append(h('details', { class: 'step', open: byScope.size === 1 || scope === 'Policy-level' ? true : undefined }, h('summary', null, `Rating factors – ${scope} (${list.length})`),
      h('table', { class: 't' }, h('thead', null, h('tr', null, ['Table', 'Your answers', 'Matched row', 'Value', 'Version'].map((c) => h('th', { class: c === 'Value' ? 'num' : '' }, c)))),
        h('tbody', null, list.map((t) => h('tr', null, h('td', null, h('span', { class: 'inline-code' }, t.table)), h('td', null, Object.entries(t.keys).map(([k, v]) => `${k} = ${v}`).join(', ')), h('td', { class: 'small' }, t.matched ? matched(t.matched) : t.defaulted ? 'default value' : '—'), h('td', { class: 'num' }, String(t.value)), h('td', { class: 'small' }, t.origin)))))));
  }
  out.append(feedbackBox(q));
  return out;
}
const matched = (m) => Object.entries(m).filter(([k]) => k !== 'rowIndex').map(([k, v]) => `${k}: ${v ?? '∞'}`).join(' · ');

function feedbackBox(q) {
  if (!can('feedback:create')) return null;
  const msg = h('div', { class: 'small muted' });
  const text = h('textarea', { rows: 2, placeholder: 'Optional: what was unclear or missing in this explanation?', 'aria-label': 'Explanation feedback', style: { fontFamily: 'inherit' } });
  const send = async (clear) => {
    try {
      await api.post('/feedback', { type: 'explanation_comment', productId: q.productId, state: q.state, quoteId: q.quoteId, scenarioId: q.scenarioId, versionId: q.versions.rating[0]?.id, comment: text.value.trim() || (clear ? 'Explanation was clear.' : 'Explanation was unclear.'), payload: { clear } });
      msg.textContent = 'Thanks — recorded as reviewable feedback. It does not change any rate or this quote.';
    } catch (e) { msg.textContent = e.message; }
  };
  return h('div', { class: 'card' }, h('h3', null, 'Was this explanation clear?'), text,
    h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('button', { class: 'btn btn-sm', onclick: () => send(true) }, 'Yes, clear'), h('button', { class: 'btn btn-sm', onclick: () => send(false) }, 'No, needs work'), msg));
}

function reasonsTab(q) {
  const out = h('div');
  if (q.status === 'INVALID') {
    out.append(notice('bad', h('strong', null, 'These answers need correcting:'), h('ul', null, q.validation.errors.map((e) => h('li', null, e.message, h('span', { class: 'small muted' }, `  (${e.path})`))))));
  } else if (q.status === 'RATING_ERROR') {
    out.append(notice('bad', h('strong', null, q.error?.code), ' ', q.error?.message), h('p', { class: 'muted' }, 'This is a configuration problem, not a problem with your answers. In a real system it would be routed to pricing support.'));
  } else {
    out.append(h('div', { class: 'card' }, h('h3', null, 'Why'), (q.eligibility?.reasons || []).map((r) => {
      const [kind, label] = REASON_KIND[r.kind];
      return h('div', { style: { marginBottom: '.7rem' } }, h('span', { class: `badge ${kind}` }, label), ' ', r.message, h('div', { class: 'small muted' }, `Rule ${r.ruleId}${r.origin ? ` · from ${r.origin}` : ''}`));
    })));
    out.append(notice('info', q.status === 'REFERRED' ? 'In a real workflow an underwriter would review this. In this demo, edit the answers or choose different options to see how eligibility changes.' : q.status === 'INFO_REQUIRED' ? 'Edit the submission and adjust the highlighted answers, then rate again.' : 'Edit the submission to see which answers drive eligibility.'));
  }
  return out;
}

function traceTab(q) {
  if (!q.trace) return notice('info', 'No trace was requested for this result.');
  const q1 = h('input', { type: 'search', placeholder: 'Filter steps (e.g. ROOF, modifier, Vehicle 2)', 'aria-label': 'Filter trace' });
  const opSel = h('select', { 'aria-label': 'Operation' }, h('option', { value: '' }, 'All operations'), ...['set', 'lookup', 'select', 'component', 'modifier', 'fee', 'foreach'].map((o) => h('option', { value: o }, o)));
  const list = h('div', { class: 'scroll-y', role: 'list' });
  const draw = () => {
    const needle = q1.value.toLowerCase();
    const rows = q.trace.filter((t) => (!opSel.value || t.op === opSel.value) && (!needle || JSON.stringify(t).toLowerCase().includes(needle)));
    list.replaceChildren(...rows.map((t) => h('div', { class: 'trace-item', role: 'listitem' }, h('div', { class: 'small muted' }, t.scope || 'policy'), h('span', { class: 'op-tag' }, t.op),
      h('div', null, h('strong', null, t.step), t.label ? ` – ${t.label}` : '', ' ', traceDetail(t)))));
    if (!rows.length) list.append(h('div', { class: 'empty' }, 'No steps match.'));
  };
  q1.addEventListener('input', draw); opSel.addEventListener('change', draw);
  draw();
  return h('div', null, h('p', { class: 'muted' }, `${q.trace.length} steps executed in order. Each lookup names the table, the inputs used, the matched row and the configuration version that supplied it.`), h('div', { class: 'row' }, q1, opSel), list);
}
function traceDetail(t) {
  if (t.skipped) return h('span', { class: 'muted' }, '(skipped: condition false)');
  if (t.op === 'lookup') return h('span', null, `${t.table}[${Object.entries(t.keys).map(([k, v]) => `${k}=${v}`).join(', ')}] → `, h('strong', null, String(t.value)), t.matched ? h('span', { class: 'muted' }, `  row ${t.matched.rowIndex + 1}: ${matched(t.matched)}`) : null, h('span', { class: 'muted' }, `  [${t.origin}]`));
  if (t.op === 'set') return h('span', null, `${t.out} = `, h('strong', null, String(t.value)));
  if (t.op === 'select') return h('span', null, `${t.out} = `, h('strong', null, String(t.value)), ` (${t.selected})`);
  if (t.op === 'component') return h('span', null, 'amount ', h('strong', null, money(t.amount)));
  if (t.op === 'modifier') return h('span', null, `× ${t.factor} on ${t.targets} component(s) → ${signedMoney(t.delta)}`);
  if (t.op === 'fee') return h('span', null, money(t.amount));
  return h('span', null, JSON.stringify(t.iterations ?? ''));
}

function versionsTab(q) {
  const v = q.versions;
  const wb = ['pricing_analyst', 'pricing_approver', 'admin'].includes(role());
  const link = (id) => (wb ? h('a', { href: `#/wb/v/${id}` }, id) : h('span', null, id));
  return h('div', null,
    v.pinned ? notice('warn', 'Versions were pinned explicitly for this quote.') : null,
    h('div', { class: 'card' }, h('h3', null, 'Configuration used'), h('dl', { class: 'kv' },
      h('dt', null, 'Rating date'), h('dd', null, `${q.ratingDate} (selects versions in force on this date)`),
      h('dt', null, 'Product definition'), h('dd', null, v.product ? [link(v.product.id), ` · effective ${v.product.effectiveFrom} · hash ${shortHash(v.product.contentHash)}`] : '—'),
      v.rating.map((r) => [h('dt', null, r.scope === 'national' ? 'National rating' : `State override (${r.scope.replace('state:', '')})`), h('dd', null, [link(r.id), ` · v${r.versionNumber} · effective ${r.effectiveFrom} · ${r.status} · hash ${shortHash(r.contentHash)}`])]),
      v.rating.length === 1 ? [h('dt', null, 'State override'), h('dd', { class: 'muted' }, `None in force for ${q.state} on ${q.ratingDate}; national rates apply.`)] : null,
      h('dt', null, 'Effective config hash'), h('dd', { class: 'mono' }, v.effectiveConfigHash ?? '—'),
      h('dt', null, 'Result hash'), h('dd', { class: 'mono' }, q.resultHash),
      h('dt', null, 'Engine'), h('dd', null, `${q.engine.name} ${q.engine.version}`))),
    q.appliedConfig ? h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, `Tables applied (${q.appliedConfig.tables.length})`)), h('div', { class: 'scroll-y' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Table', 'Supplied by', 'Lookups'].map((c) => h('th', null, c)))),
      h('tbody', null, q.appliedConfig.tables.map((t) => h('tr', null, h('td', null, h('span', { class: 'inline-code' }, t.id)), h('td', null, t.origin), h('td', null, t.lookups))))))) : null);
}

async function inputsTab(q) {
  try {
    const schema = await api.get(`/products/${q.productId}/schema?versionId=${encodeURIComponent(q.versions.product.id)}`);
    return h('div', null, ...summarize(schema.sections, { risk: q.risk, coverages: q.coverages }));
  } catch { return h('div', { class: 'code' }, JSON.stringify({ risk: q.risk, coverages: q.coverages }, null, 2)); }
}

function scenarioDialog(sub, type) {
  return modal(`${type === 'RENEWAL' ? 'Renewal' : 'Endorsement'} test scenario`, (close) => {
    const date = h('input', { type: 'date', value: type === 'RENEWAL' ? addDays(sub.effectiveDate, 365) : addDays(sub.effectiveDate, 120), 'aria-label': 'Effective date' });
    const err = h('div');
    return h('div', null,
      h('p', { class: 'muted' }, type === 'RENEWAL' ? 'Creates a renewal submission with the prior-term premium set, so the renewal rate-change cap applies. Versions come from the renewal effective date.' : 'Creates an endorsement submission. You edit the risk, then the premium change is pro-rated. Both risks are rated with the versions in force on the original policy effective date.'),
      h('label', { class: 'small' }, 'Effective date'), date, err,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: async () => {
        try { const out = await api.post(`/submissions/${sub.id}/scenarios`, { type, effectiveDate: date.value }); close(); location.hash = `#/s/${out.submission.id}`; } catch (e) { err.replaceChildren(notice('bad', e.message)); }
      } }, 'Create scenario')));
  });
}
void todayIso;
