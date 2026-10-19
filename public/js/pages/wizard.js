import { h, toast, notice, spinner } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { createForm, applyDefaults, summarize } from '../lib/form.js';
import { STATE_NAME, money, statusBadge } from '../lib/format.js';

export async function wizardPage({ id }) {
  const { submission: sub } = await api.get(`/submissions/${id}`);
  if (sub.status === 'BOUND_SIMULATED') { location.hash = `#/s/${id}/quote`; return h('div'); }
  const ratingDate = sub.transactionType === 'ENDORSEMENT' ? (sub.policyEffectiveDate || sub.effectiveDate) : sub.effectiveDate;
  const schema = await api.get(`/products/${sub.productId}/schema?date=${ratingDate}`);
  const products = (await api.get('/products')).products;
  const product = products.find((p) => p.id === sub.productId);
  const data = applyDefaults(schema.sections, { risk: sub.risk, coverages: sub.coverages });
  const sys = { transactionType: sub.transactionType, effectiveDate: ratingDate, effectiveYear: Number(ratingDate.slice(0, 4)), state: sub.state };

  const steps = [{ id: 'policy', title: 'Policy details' }, ...schema.sections.map((s) => ({ id: s.id, title: s.title, section: s })), { id: 'review', title: 'Review & get quote' }];
  const status = {}; // stepId -> 'done' | 'err'
  let current = 0;
  const form = createForm({ sections: schema.sections, data, sys, onChange: () => {} });
  const content = h('div', { class: 'card' });
  const stepper = h('ol', { class: 'steps', 'aria-label': 'Quote steps' });
  const banner = h('div');

  const patch = () => ({ name: sub.name, state: sub.state, effectiveDate: sub.effectiveDate, policyEffectiveDate: sub.policyEffectiveDate, risk: data.risk, coverages: data.coverages });
  async function save(quiet) {
    const { submission } = await api.put(`/submissions/${id}`, patch());
    Object.assign(sub, { updatedAt: submission.updatedAt });
    if (!quiet) toast('Draft saved', 'ok');
  }

  function drawStepper() {
    stepper.replaceChildren(...steps.map((s, i) => h('li', { class: `${i === current ? 'current' : ''} ${status[s.id] || ''}` },
      h('button', { type: 'button', 'aria-current': i === current ? 'step' : undefined, onclick: () => go(i, false) }, h('span', { class: 'step-no' }, status[s.id] === 'done' ? '✓' : status[s.id] === 'err' ? '!' : String(i + 1)), h('span', null, s.title)))));
  }

  function policyStep() {
    const wrap = h('div', null, h('h2', null, 'Policy details'),
      h('p', { class: 'muted' }, `${product?.name ?? sub.productId} · ${sub.transactionType.replace('_', ' ').toLowerCase()} · rating date ${ratingDate}`),
      sub.transactionType === 'RENEWAL' ? notice('info', `Renewal test scenario. Prior-term premium ${money(sub.priorTermPremium)} enables the renewal rate-change cap.`) : null,
      sub.transactionType === 'ENDORSEMENT' ? notice('info', `Endorsement test scenario for policy effective ${sub.policyEffectiveDate}. Change the risk or coverages in the next steps; the premium change is pro-rated from the endorsement effective date. Prior risk is fixed.`) : null);
    const stateSel = h('select', { id: 'pd-state', onchange: (e) => { sub.state = e.target.value; sys.state = sub.state; } }, Object.entries(STATE_NAME).map(([c, n]) => h('option', { value: c, selected: c === sub.state }, `${n} (${c})`)));
    wrap.append(h('div', { class: 'fields-grid' },
      h('div', { class: 'field' }, h('label', { for: 'pd-name' }, 'Submission name'), h('input', { id: 'pd-name', type: 'text', maxlength: 80, value: sub.name || '', oninput: (e) => { sub.name = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { for: 'pd-state' }, 'Jurisdiction'), stateSel, h('div', { class: 'help' }, 'Changing the state changes the ZIP check, territory and state overrides. Re-check your ZIP code.')),
      h('div', { class: 'field' }, h('label', { for: 'pd-date' }, sub.transactionType === 'ENDORSEMENT' ? 'Endorsement effective date' : 'Effective date'), h('input', { id: 'pd-date', type: 'date', value: sub.effectiveDate, onchange: (e) => { sub.effectiveDate = e.target.value; if (sub.transactionType !== 'ENDORSEMENT') { sys.effectiveDate = e.target.value; sys.effectiveYear = Number(e.target.value.slice(0, 4)); } } }), h('div', { class: 'help' }, 'Save and re-open the quote if you change the date across a product-definition change.'))));
    return wrap;
  }

  async function reviewStep() {
    const wrap = h('div', null, h('h2', null, 'Review & get quote'), h('p', { class: 'muted' }, 'Check what you entered. “Get quote” saves the submission and rates it. The result is a synthetic illustration, not an offer.'));
    const pre = h('div', null, h('span', { class: 'muted small' }, spinner(), ' Checking inputs and eligibility…'));
    wrap.append(pre, ...summarize(schema.sections, data));
    (async () => {
      try {
        await save(true);
        const r = await api.post('/validate-submission', { productId: sub.productId, state: sub.state, transactionType: sub.transactionType, effectiveDate: sub.effectiveDate, policyEffectiveDate: sub.policyEffectiveDate || undefined, risk: data.risk, coverages: data.coverages, endorsement: sub.endorsement || undefined });
        pre.replaceChildren(precheck(r));
        if (r.errors.length) { form.setErrors(r.errors); markErrors(r.errors); }
      } catch (e) { pre.replaceChildren(notice('bad', e.message)); }
    })();
    return wrap;
  }

  function precheck(r) {
    if (r.errors?.length) {
      return notice('bad', h('strong', null, `${r.errors.length} thing${r.errors.length > 1 ? 's' : ''} to fix before we can rate this:`),
        h('ul', null, r.errors.slice(0, 12).map((e) => h('li', null, e.message, ' ', h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); const sid = form.sectionOfPath(e.path); const idx = steps.findIndex((s) => s.id === sid); go(idx >= 0 ? idx : 0, false); } }, 'Go to field')))));
    }
    if (r.status === 'QUOTED') return notice('ok', 'Inputs are valid and eligible for an online illustrative quote.');
    return notice(r.status === 'DECLINED' ? 'bad' : r.status === 'REFERRED' ? 'warn' : 'info', h('strong', null, `${r.status === 'DECLINED' ? 'Not eligible online' : r.status === 'REFERRED' ? 'Referral expected' : 'More information needed'}:`), h('ul', null, (r.eligibility?.reasons || []).map((x) => h('li', null, x.message))));
  }

  function markErrors(list) {
    for (const s of steps) delete status[s.id];
    for (const e of list) { const sid = form.sectionOfPath(e.path); if (sid) status[sid] = 'err'; }
    drawStepper();
  }

  async function draw() {
    const s = steps[current];
    drawStepper();
    content.replaceChildren(spinner());
    let body;
    if (s.id === 'policy') body = policyStep();
    else if (s.id === 'review') body = await reviewStep();
    else { body = form.renderSection(s.section); form.refresh(); form.showErrors(); }
    const last = current === steps.length - 1;
    content.replaceChildren(body, h('div', { class: 'wiz-foot' },
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: current === 0, onclick: () => go(current - 1, false) }, 'Back'), h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => save().catch((e) => toast(e.message, 'bad')) }, 'Save draft')),
      last ? h('button', { class: 'btn btn-primary', type: 'button', onclick: rate }, 'Get quote') : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go(current + 1, true) }, current === steps.length - 2 ? 'Review' : 'Next')));
  }

  async function go(i, validate) {
    const s = steps[current];
    if (validate && s.section) {
      const errs = form.validateSection(s.section);
      if (errs.length) { form.setErrors(errs); status[s.id] = 'err'; drawStepper(); toast(`Please fix ${errs.length} item${errs.length > 1 ? 's' : ''} on this page.`, 'bad'); const first = content.querySelector('.invalid'); first?.scrollIntoView({ block: 'center' }); return; }
    }
    if (s.section && validate) status[s.id] = 'done'; else if (s.id === 'policy' && validate) status[s.id] = 'done';
    try { await save(true); } catch (e) { toast(e.message, 'bad'); }
    current = Math.max(0, Math.min(steps.length - 1, i));
    banner.replaceChildren();
    await draw();
    window.scrollTo({ top: 0 });
  }

  async function rate() {
    banner.replaceChildren(notice('info', spinner(), ' Rating…'));
    try {
      await save(true);
      const out = await api.post(`/submissions/${id}/rate`, {});
      if (out.quote.status === 'INVALID') {
        form.setErrors(out.quote.validation.errors); markErrors(out.quote.validation.errors);
        banner.replaceChildren(notice('bad', 'The quote could not be rated until these are fixed. See the highlighted steps.'));
        const first = steps.findIndex((s) => status[s.id] === 'err');
        if (first >= 0) { current = first; await draw(); }
        return;
      }
      location.hash = `#/s/${id}/quote`;
    } catch (e) { banner.replaceChildren(notice('bad', e.message)); }
  }

  const root = h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, product?.name ?? sub.productId), h('p', null, `${sub.id} · ${STATE_NAME[sub.state]} · effective ${sub.effectiveDate} `, statusBadge(sub.status)))),
    banner, h('div', { class: 'wizard' }, stepper, content));
  draw();
  return root;
}
