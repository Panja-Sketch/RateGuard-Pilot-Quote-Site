import { h, toast, notice, mount, confirmDialog, promptDialog, modal, reload, downloadBlob } from '../../lib/dom.js';
import { api, can, getSession } from '../../lib/api.js';
import { versionBadge, when, shortHash, VSTATUS } from '../../lib/format.js';
import { stepSummary, exprStr } from '../../lib/exprstr.js';
import { wbLayout } from './index.js';
import { renderReport } from './report.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const EDITABLE = ['draft', 'validated', 'rejected'];

export async function versionPage({ id }, query) {
  const isProduct = /-PROD-/.test(id);
  const base = isProduct ? 'product-versions' : 'rating-versions';
  const { version: v } = await api.get(`/${base}/${id}`);
  const me = getSession().user;
  const editable = EDITABLE.includes(v.status) && can('config:edit');
  const work = clone(v.content);
  const meta = { label: v.label, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, changeTicket: v.changeTicket ? clone(v.changeTicket) : null };
  let dirty = false;
  let basedDoc = null;
  if (v.basedOn) { try { basedDoc = (await api.get(`/${base}/${v.basedOn}`)).version; } catch { /* base not visible */ } }
  const isState = v.scope?.level === 'state';

  const saveBtn = h('button', { class: 'btn btn-primary', disabled: true, onclick: save }, 'Save changes');
  const dirtyNote = h('span', { class: 'small', style: { color: 'var(--warn)' } });
  const markDirty = () => { dirty = true; saveBtn.disabled = false; dirtyNote.textContent = 'Unsaved changes'; };

  async function save() {
    try { await api.put(`/${base}/${id}`, { ...meta, content: work }); toast('Saved. Validation was reset — validate again.', 'ok'); reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function run(fn, msg) { try { if (dirty && !(await confirmDialog('Unsaved changes', 'You have unsaved changes that this action will not include. Continue anyway?'))) return; await fn(); if (msg) toast(msg, 'ok'); reload(); } catch (e) { if (e.message !== 'Cancelled') toast(e.message, 'bad'); } }

  // ---------------- action bar ----------------
  const bar = h('div', { class: 'row' });
  if (editable) bar.append(saveBtn);
  if (editable || can('config:validate')) bar.append(h('button', { class: 'btn', onclick: () => run(() => api.post(`/${base}/${id}/validate`, {}), 'Validation finished') }, 'Validate'));
  if (can('config:edit') && v.status === 'validated') bar.append(h('button', { class: 'btn btn-primary', onclick: () => run(async () => { const note = await promptDialog('Submit for approval', 'Note for the approver (optional)', { required: false, confirmLabel: 'Submit' }); if (note === undefined) throw new Error('Cancelled'); await api.post(`/${base}/${id}/submit`, { note }); }, 'Submitted for approval') }, 'Submit for approval'));
  if (can('config:edit') && v.status === 'pending_approval' && (v.submittedBy === me.id || me.role === 'admin')) bar.append(h('button', { class: 'btn', onclick: () => run(() => api.post(`/${base}/${id}/withdraw`, {}), 'Withdrawn') }, 'Withdraw'));
  if (can('config:approve') && v.status === 'pending_approval') {
    const own = v.createdBy === me.id || v.submittedBy === me.id;
    bar.append(h('button', { class: 'btn btn-primary', disabled: own, title: own ? 'Four-eyes rule: you created or submitted this version' : '', onclick: () => run(async () => { const note = await promptDialog('Approve', 'Approval note (optional)', { required: false, confirmLabel: 'Approve' }); if (note === undefined) throw new Error('Cancelled'); await api.post(`/${base}/${id}/approve`, { note }); }, 'Approved') }, 'Approve'),
      h('button', { class: 'btn btn-danger', disabled: v.submittedBy === me.id, onclick: () => run(async () => { const reason = await promptDialog('Reject', 'Reason (required)', { confirmLabel: 'Reject' }); if (reason === undefined) throw new Error('Cancelled'); await api.post(`/${base}/${id}/reject`, { reason }); }, 'Rejected') }, 'Reject'));
  }
  if (can('config:promote') && v.status === 'approved') bar.append(h('button', { class: 'btn btn-primary', onclick: () => run(async () => { if (!(await confirmDialog('Promote to active?', `${v.id} becomes active from ${v.effectiveFrom}. Active versions are immutable; quotes dated on/after this date will use it.`, { confirmLabel: 'Promote' }))) throw new Error('Cancelled'); await api.post(`/${base}/${id}/promote`, {}); }, 'Promoted to active') }, 'Promote to active'));
  if (can('config:rollback') && v.status === 'active') bar.append(h('button', { class: 'btn btn-danger', onclick: () => run(async () => { const reason = await promptDialog('Roll back this version', 'Reason (required) — recorded in the audit trail', { confirmLabel: 'Roll back' }); if (reason === undefined) throw new Error('Cancelled'); const out = await api.post(`/${base}/${id}/rollback`, { reason }); toast(`Rolled back. Now in force: ${out.nowInForce ?? 'n/a'}`, 'ok'); }) }, 'Roll back…'));
  if (can('config:edit')) bar.append(h('button', { class: 'btn', onclick: cloneDialog }, 'Clone to new draft'));
  bar.append(h('button', { class: 'btn', onclick: diffDialog }, 'Compare with…'));
  if (!isProduct) {
    bar.append(h('button', { class: 'btn', onclick: async () => { try { downloadBlob(await api.blob(`/rating-versions/${id}/export.xlsx`), `${id}.xlsx`); } catch (e) { toast(e.message, 'bad'); } } }, 'Export XLSX'));
    bar.append(h('a', { class: 'btn', href: `#/wb/impact?candidate=${id}` }, 'Run scenarios…'));
  }

  async function cloneDialog() {
    const label = await promptDialog('Clone to a new draft', 'Label for the new draft', { required: false, multiline: false, confirmLabel: 'Create draft', placeholder: `Draft based on ${id}` });
    if (label === undefined) return;
    try { const out = await api.post(`/${base}`, { productId: v.productId, fromVersionId: id, label: label || undefined, effectiveFrom: v.effectiveFrom > '2026-12-01' ? v.effectiveFrom : '2026-12-01' }); location.hash = `#/wb/v/${out.version.id}`; } catch (e) { toast(e.message, 'bad'); }
  }
  async function diffDialog() {
    const { versions } = await api.get(`/${base}?productId=${v.productId}`);
    const options = versions.filter((x) => x.id !== id && (isProduct || x.scope.level === v.scope.level));
    return modal('Compare with another version', (close) => {
      const sel = h('select', { 'aria-label': 'Other version' }, options.map((x) => h('option', { value: x.id, selected: x.id === v.basedOn }, `${x.id} — ${x.label} [${x.status}]`)));
      return h('div', null, h('p', { class: 'muted' }, `Shows what changes going from the selected version to ${id}.`), sel,
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: () => { close(); location.hash = `#/wb/diff/${sel.value}/${id}`; } }, 'Compare')));
    });
  }

  // ---------------- tabs ----------------
  const tabNames = isProduct ? ['Overview', 'Product definition', 'Validation', 'History'] : ['Overview', 'Tables', 'Parameters', 'Calculation sequence', 'Rules', 'Limits & plans', 'Validation', 'History', ...(v.provenance ? ['Provenance'] : [])];
  let active = Math.max(0, tabNames.indexOf(query.get('tab') || 'Overview'));
  const bodyEl = h('div');
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' }, tabNames.map((t, i) => h('button', { role: 'tab', class: i === active ? 'active' : '', 'aria-selected': String(i === active), onclick: () => { active = i; drawTab(); } }, t)));
  function drawTab() {
    [...tabsEl.children].forEach((b, i) => { b.classList.toggle('active', i === active); b.setAttribute('aria-selected', String(i === active)); });
    bodyEl.replaceChildren();
    Promise.resolve(tabBody(tabNames[active])).then((n) => bodyEl.append(n)).catch((e) => bodyEl.append(notice('bad', e.message)));
  }
  function tabBody(name) {
    switch (name) {
      case 'Overview': return overview();
      case 'Tables': return tablesTab();
      case 'Parameters': return paramsTab();
      case 'Calculation sequence': return stepsTab();
      case 'Rules': return rulesTab();
      case 'Limits & plans': return limitsTab();
      case 'Product definition': return productTab();
      case 'Validation': return validationTab();
      case 'History': return historyTab();
      default: return provenanceTab();
    }
  }

  // ---------------- overview ----------------
  function overview() {
    const input = (key, type = 'text') => (editable ? h('input', { type, value: meta[key] ?? '', 'aria-label': key, oninput: (e) => { meta[key] = e.target.value || null; markDirty(); } }) : h('span', null, meta[key] ?? '—'));
    return h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' }, h('h3', null, 'Identity'), h('dl', { class: 'kv' },
        h('dt', null, 'Version ID'), h('dd', { class: 'mono' }, v.id), h('dt', null, 'Product'), h('dd', null, v.productId), h('dt', null, 'Kind / scope'), h('dd', null, isProduct ? 'Product definition (input schema)' : isState ? `State override · ${v.scope.state}` : 'National / base'),
        h('dt', null, 'Label'), h('dd', null, input('label')), h('dt', null, 'Effective from'), h('dd', null, input('effectiveFrom', 'date')), h('dt', null, 'Effective to'), h('dd', null, input('effectiveTo', 'date')),
        h('dt', null, 'Status'), h('dd', null, versionBadge(v), v.frozen ? h('span', { class: 'small muted' }, '  immutable') : null), h('dt', null, 'Based on'), h('dd', null, v.basedOn ? h('a', { href: `#/wb/v/${v.basedOn}` }, v.basedOn) : '—'),
        h('dt', null, 'Content hash'), h('dd', { class: 'mono' }, v.contentHash ?? '(assigned at approval)'))),
      h('div', { class: 'card' }, h('h3', null, 'People and approvals'), h('dl', { class: 'kv' },
        h('dt', null, 'Created'), h('dd', null, `${v.createdBy} · ${when(v.createdAt)}`), h('dt', null, 'Submitted'), h('dd', null, v.submittedBy ? `${v.submittedBy} · ${when(v.submittedAt)}` : '—'),
        h('dt', null, 'Approved'), h('dd', null, v.approvedBy ? `${v.approvedBy} · ${when(v.approvedAt)}` : '—'), h('dt', null, 'Promoted'), h('dd', null, v.promotedBy ? `${v.promotedBy} · ${when(v.promotedAt)}` : '—'),
        v.rolledBackBy ? [h('dt', null, 'Rolled back'), h('dd', null, `${v.rolledBackBy} · ${v.rollbackReason}`)] : null, v.rejectionReason ? [h('dt', null, 'Rejected'), h('dd', null, `${v.rejectedBy}: ${v.rejectionReason}`)] : null)),
      v.demo ? h('div', { class: 'card', style: { gridColumn: '1 / -1' } }, h('h3', null, 'Demo candidate'), notice(v.demo.kind === 'rate_change' ? 'ok' : 'warn', v.demo.description), h('p', { class: 'small muted' }, 'Seeded to rehearse the workflow. Compare it with its base, run scenarios, and try to approve it.')) : null,
      h('div', { class: 'card', style: { gridColumn: '1 / -1' } }, h('h3', null, 'Change ticket'),
        editable ? h('div', { class: 'fields-grid' },
          h('div', { class: 'field' }, h('label', null, 'Reference'), h('input', { type: 'text', value: meta.changeTicket?.reference ?? '', oninput: (e) => { meta.changeTicket = { ...(meta.changeTicket || {}), reference: e.target.value }; markDirty(); } })),
          h('div', { class: 'field' }, h('label', null, 'Description (free text)'), h('textarea', { rows: 3, style: { fontFamily: 'inherit' }, oninput: (e) => { meta.changeTicket = { ...(meta.changeTicket || {}), text: e.target.value }; markDirty(); } }, meta.changeTicket?.text ?? ''))) :
          (v.changeTicket ? h('div', null, h('strong', null, v.changeTicket.reference || ''), h('p', { style: { whiteSpace: 'pre-wrap' } }, v.changeTicket.text || '')) : h('p', { class: 'muted' }, 'No ticket recorded.')),
        h('p', { class: 'small muted' }, 'The pilot stores this text with the version for context. It does not interpret it, and does not perform any independent assurance of the change.')),
      v.source ? h('div', { class: 'card', style: { gridColumn: '1 / -1' } }, h('h3', null, 'Source'), h('dl', { class: 'kv' }, Object.entries(v.source).map(([k, val]) => [h('dt', null, k), h('dd', { class: 'mono' }, String(val))]))) : null);
  }

  // ---------------- tables ----------------
  function colsOf(t) { const c = []; for (const k of t.keys) { if (k.kind === 'range') c.push({ col: `${k.name}_min`, kind: 'num', hint: `${k.name} ≥` }, { col: `${k.name}_max`, kind: 'num', hint: `${k.name} <` }); else c.push({ col: k.name, kind: 'text', hint: k.name }); } c.push({ col: 'value', kind: 'num', hint: 'value' }); return c; }
  const sig = (t, r) => t.keys.map((k) => (k.kind === 'range' ? `${r[`${k.name}_min`] ?? ''}~${r[`${k.name}_max`] ?? ''}` : String(r[k.name]))).join('|');

  function tablesTab() {
    const names = Object.keys(work.tables || {});
    if (!names.length) return h('div', { class: 'empty' }, isState ? 'This state override does not replace any tables.' : 'No tables.');
    let sel = names[0];
    const right = h('div');
    const left = h('div', { class: 'card flush', style: { maxHeight: '560px', overflow: 'auto' } });
    const drawLeft = () => left.replaceChildren(h('div', { class: 'card-head' }, h('strong', null, `Tables (${names.length})`)), ...names.map((n) => h('button', { class: `btn btn-ghost${n === sel ? ' active-sel' : ''}`, style: { width: '100%', justifyContent: 'space-between', borderRadius: 0, borderBottom: '1px solid var(--border)', background: n === sel ? 'var(--primary-50)' : '' }, onclick: () => { sel = n; drawLeft(); drawRight(); } }, h('span', { class: 'mono' }, n), h('span', { class: 'small muted' }, `${work.tables[n].rows.length}`))));
    function drawRight() {
      const t = work.tables[sel];
      const baseT = basedDoc?.content?.tables?.[sel];
      const baseMap = baseT ? new Map(baseT.rows.map((r) => [sig(baseT, r), r.value])) : null;
      const cols = colsOf(t);
      const filter = h('input', { type: 'search', placeholder: 'Filter rows…', 'aria-label': 'Filter rows', style: { maxWidth: '220px' } });
      const tbody = h('tbody');
      const drawRows = () => {
        const needle = filter.value.toLowerCase();
        tbody.replaceChildren(...t.rows.map((r, i) => ({ r, i })).filter(({ r }) => !needle || JSON.stringify(r).toLowerCase().includes(needle)).map(({ r, i }) => {
          const isNew = baseMap && !baseMap.has(sig(t, r));
          return h('tr', { class: isNew ? 'row-new' : '' }, h('td', { class: 'small muted' }, i + 1), cols.map((c) => {
            const changed = baseMap && !isNew && c.col === 'value' && baseMap.get(sig(t, r)) !== r.value;
            return h('td', { class: changed ? 'changed' : '', title: changed ? `Base value ${baseMap.get(sig(t, r))}` : '' },
              editable ? h('input', { class: 'cell-edit', type: c.kind === 'num' ? 'number' : 'text', step: 'any', value: r[c.col] ?? '', 'aria-label': `${sel} row ${i + 1} ${c.hint}`,
                oninput: (e) => { const val = e.target.value; r[c.col] = c.kind === 'num' ? (val === '' ? (c.col === 'value' ? undefined : null) : Number(val)) : val; markDirty(); if (c.col === 'value' && baseMap) e.target.parentElement.classList.toggle('changed', baseMap.get(sig(t, r)) !== r.value); } }) : String(r[c.col] ?? '∞'));
          }), editable ? h('td', null, h('button', { class: 'btn btn-sm btn-ghost', 'aria-label': `Delete row ${i + 1}`, onclick: () => { t.rows.splice(i, 1); markDirty(); drawRows(); } }, '✕')) : null);
        }));
      };
      right.replaceChildren(h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('div', null, h('h3', { style: { margin: 0 } }, h('span', { class: 'mono' }, sel)), h('div', { class: 'small muted' }, t.description || '')),
        h('div', { class: 'row' }, h('span', { class: 'badge' }, t.valueKind || 'value'), t.bounds ? h('span', { class: 'badge' }, `bounds ${t.bounds.min}–${t.bounds.max}`) : null, t.contiguous === false ? h('span', { class: 'badge' }, 'gaps allowed') : null, filter, editable ? h('button', { class: 'btn btn-sm', onclick: () => { const row = {}; for (const k of t.keys) { if (k.kind === 'range') { row[`${k.name}_min`] = null; row[`${k.name}_max`] = null; } else row[k.name] = ''; } row.value = undefined; t.rows.push(row); markDirty(); drawRows(); } }, 'Add row') : null)),
        h('div', { class: 'scroll-y' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, '#'), cols.map((c) => h('th', null, c.col)), editable ? h('th') : null)), tbody)),
        h('div', { class: 'card-body small muted' }, 'Range bounds are [min, max): min inclusive, max exclusive; leave blank for no bound. ', baseMap ? 'Yellow = value changed from the base version; green row = new row.' : '')));
      filter.addEventListener('input', drawRows); drawRows();
    }
    drawLeft(); drawRight();
    return h('div', { class: 'split' }, left, right);
  }

  // ---------------- params ----------------
  function paramsTab() {
    const keys = Object.keys(work.params || {});
    const baseP = basedDoc?.content?.params || {};
    const t = h('table', { class: 't' }, h('thead', null, h('tr', null, ['Parameter', 'Value', 'Base value'].map((c) => h('th', null, c)))),
      h('tbody', null, keys.map((k) => { const val = work.params[k]; return h('tr', null, h('td', { class: 'mono' }, k),
        h('td', { class: k in baseP && baseP[k] !== val ? 'changed' : '' }, editable ? (typeof val === 'boolean' ? h('input', { type: 'checkbox', checked: val, onchange: (e) => { work.params[k] = e.target.checked; markDirty(); } }) : h('input', { class: 'cell-edit', type: typeof val === 'number' ? 'number' : 'text', step: 'any', value: val, 'aria-label': k, oninput: (e) => { work.params[k] = typeof val === 'number' ? Number(e.target.value) : e.target.value; markDirty(); e.target.parentElement.classList.toggle('changed', k in baseP && baseP[k] !== work.params[k]); } })) : String(val)),
        h('td', { class: 'muted' }, k in baseP ? String(baseP[k]) : '—')); })));
    return h('div', { class: 'card flush' }, h('div', { class: 'scroll-y' }, keys.length ? t : h('div', { class: 'empty' }, 'No parameters.')));
  }

  // ---------------- steps ----------------
  function stepList(steps, path) {
    return steps.map((s, i) => {
      const sid = `${path}${i}`;
      const jsonBox = h('textarea', { rows: 8, spellcheck: 'false', 'aria-label': `JSON for step ${s.id}` }, JSON.stringify(s, null, 2));
      const err = h('div', { class: 'err small', style: { color: 'var(--bad)' } });
      return h('details', { class: 'step', id: sid }, h('summary', null, h('span', { class: 'op-tag' }, s.op), ' ', h('strong', null, s.id), s.when ? h('span', { class: 'small muted' }, `  when ${exprStr(s.when)}`) : null),
        h('div', { class: 'mono small', style: { margin: '.4rem 0' } }, stepSummary(s)),
        s.op === 'foreach' ? h('div', { style: { marginLeft: '1rem' } }, stepList(s.steps || [], `${sid}-`)) : null,
        editable && s.op !== 'foreach' ? h('div', null, jsonBox, err, h('div', { class: 'row', style: { marginTop: '.4rem' } },
          h('button', { class: 'btn btn-sm', onclick: () => { try { const parsed = JSON.parse(jsonBox.value); if (parsed.id !== s.id) throw new Error('Step id cannot be changed here.'); steps[i] = parsed; markDirty(); err.textContent = ''; toast(`Step ${s.id} updated (unsaved)`, 'ok'); } catch (ex) { err.textContent = ex.message; } } }, 'Apply'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => { steps.splice(i, 1); markDirty(); drawTab(); } }, 'Delete step'))) : null);
    });
  }
  function stepsTab() {
    if (isState) return overridesTab();
    const out = h('div');
    out.append(notice('info', 'Steps run in this order. Supported operations are a closed set: set, lookup, select, component, modifier, fee, foreach. Expressions use a bounded JSON language — no formulas, macros or code. Edit a step as JSON; validation checks every reference.'));
    out.append(h('div', { class: 'card' }, h('h3', null, `1. Derived values (${work.derive?.length || 0})`), stepList(work.derive || [], 'd-')));
    out.append(h('div', { class: 'card' }, h('h3', null, `2. Rating plan (${work.plan?.length || 0})`), stepList(work.plan || [], 'p-')));
    if (editable) out.append(h('div', { class: 'card' }, h('h3', null, 'Advanced: edit the whole sequence as JSON'), jsonArea('plan'), jsonArea('derive')));
    return out;
  }
  function jsonArea(key) {
    const ta = h('textarea', { rows: 8, spellcheck: 'false', 'aria-label': `${key} JSON` }, JSON.stringify(work[key] || [], null, 2));
    const err = h('div', { class: 'small', style: { color: 'var(--bad)' } });
    return h('div', { class: 'field' }, h('label', null, key), ta, err, h('button', { class: 'btn btn-sm', onclick: () => { try { const p = JSON.parse(ta.value); if (!Array.isArray(p)) throw new Error('Must be an array'); work[key] = p; markDirty(); drawTab(); toast(`${key} replaced (unsaved)`, 'ok'); } catch (e) { err.textContent = e.message; } } }, `Apply ${key}`));
  }

  // state overrides are a structured patch over the national version
  function overridesTab() {
    const out = h('div', null, notice('info', 'A state override is a small patch over the national version in force on the same date: replace parameters/tables, replace or remove rules, replace or remove steps, insert steps, adjust limits.'));
    for (const key of ['params', 'rules', 'removeRules', 'stepOverrides', 'additionalSteps', 'limits', 'paymentPlans']) {
      const val = work[key];
      if (!editable && val === undefined) continue;
      const ta = h('textarea', { rows: val === undefined ? 2 : 6, spellcheck: 'false', 'aria-label': key, readOnly: !editable }, val === undefined ? '' : JSON.stringify(val, null, 2));
      const err = h('div', { class: 'small', style: { color: 'var(--bad)' } });
      out.append(h('div', { class: 'card' }, h('h4', null, key), ta, err, editable ? h('button', { class: 'btn btn-sm', style: { marginTop: '.4rem' }, onclick: () => { try { if (ta.value.trim() === '') delete work[key]; else work[key] = JSON.parse(ta.value); markDirty(); err.textContent = ''; toast(`${key} updated (unsaved)`, 'ok'); } catch (e) { err.textContent = e.message; } } }, 'Apply') : null));
    }
    return out;
  }

  // ---------------- rules ----------------
  function rulesTab() {
    if (isState) return overridesTab();
    const out = h('div');
    const KIND = { decline: ['bad', 'Decline'], refer: ['warn', 'Refer'], info: ['info', 'More info'] };
    out.append(notice('info', 'Rules are evaluated before rating. Priority: decline > refer > more-information. Messages are shown to the user.'));
    (work.rules || []).forEach((r, i) => {
      const ta = h('textarea', { rows: 7, spellcheck: 'false', 'aria-label': `JSON for rule ${r.id}` }, JSON.stringify(r, null, 2));
      const err = h('div', { class: 'small', style: { color: 'var(--bad)' } });
      out.append(h('details', { class: 'step' }, h('summary', null, h('span', { class: `badge ${KIND[r.kind]?.[0]}` }, KIND[r.kind]?.[1] || r.kind), ' ', h('strong', null, r.id), h('span', { class: 'muted' }, ` — ${r.message}`)),
        h('div', { class: 'mono small', style: { margin: '.4rem 0' } }, `when ${exprStr(r.when)}`),
        editable ? h('div', null, ta, err, h('div', { class: 'row', style: { marginTop: '.4rem' } }, h('button', { class: 'btn btn-sm', onclick: () => { try { work.rules[i] = JSON.parse(ta.value); markDirty(); err.textContent = ''; toast('Rule updated (unsaved)', 'ok'); } catch (e) { err.textContent = e.message; } } }, 'Apply'), h('button', { class: 'btn btn-sm btn-danger', onclick: () => { work.rules.splice(i, 1); markDirty(); drawTab(); } }, 'Delete rule'))) : null));
    });
    if (editable) out.append(h('button', { class: 'btn', onclick: () => { (work.rules ||= []).push({ id: `NEW_RULE_${work.rules.length + 1}`, kind: 'refer', code: 'NEW_RULE', message: 'Describe why this needs review.', when: { op: 'gt', args: [{ in: 'risk.example_field' }, 0] } }); markDirty(); drawTab(); } }, 'Add rule'));
    return out;
  }

  // ---------------- limits ----------------
  function limitsTab() {
    if (isState) return overridesTab();
    const L = (work.limits ||= {});
    const numField = (label, get, set, help) => h('div', { class: 'field' }, h('label', null, label), h('input', { type: 'number', step: 'any', value: get() ?? '', disabled: !editable, oninput: (e) => { set(e.target.value === '' ? undefined : Number(e.target.value)); markDirty(); } }), help ? h('div', { class: 'help' }, help) : null);
    const plans = h('textarea', { rows: 10, spellcheck: 'false', readOnly: !editable, 'aria-label': 'Payment plans JSON' }, JSON.stringify(work.paymentPlans || [], null, 2));
    const perr = h('div', { class: 'small', style: { color: 'var(--bad)' } });
    return h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' }, h('h3', null, 'Premium limits and rounding'),
        numField('Minimum premium', () => L.minPremium, (x) => { if (x === undefined) delete L.minPremium; else L.minPremium = x; }, 'A floor on the total term premium; shown as an explicit adjustment line.'),
        numField('Maximum premium', () => L.maxPremium, (x) => { if (x === undefined) delete L.maxPremium; else L.maxPremium = x; }, 'A cap on the total; shown as an explicit adjustment line.'),
        numField('Rounding places', () => L.rounding?.places, (x) => { L.rounding = { ...(L.rounding || { mode: 'half_up' }), places: x ?? 2 }; }, 'Each component is rounded half-up to this many decimals.'),
        h('h4', null, 'Renewal rate-change cap'),
        numField('Max increase % vs prior term', () => L.renewalCap?.maxIncreasePct, (x) => { L.renewalCap = { ...(L.renewalCap || { maxDecreasePct: 100 }), maxIncreasePct: x ?? 0 }; }),
        numField('Max decrease % vs prior term', () => L.renewalCap?.maxDecreasePct, (x) => { L.renewalCap = { ...(L.renewalCap || { maxIncreasePct: 100 }), maxDecreasePct: x ?? 0 }; })),
      h('div', { class: 'card' }, h('h3', null, 'Payment plans'), plans, perr, editable ? h('button', { class: 'btn btn-sm', style: { marginTop: '.4rem' }, onclick: () => { try { work.paymentPlans = JSON.parse(plans.value); markDirty(); perr.textContent = ''; toast('Plans updated (unsaved)', 'ok'); } catch (e) { perr.textContent = e.message; } } }, 'Apply') : null));
  }

  // ---------------- product definition ----------------
  function productTab() {
    const ta = h('textarea', { rows: 26, spellcheck: 'false', readOnly: !editable, 'aria-label': 'Product definition JSON' }, JSON.stringify(work, null, 2));
    const err = h('div', { class: 'small', style: { color: 'var(--bad)' } });
    return h('div', null, notice('info', `${work.sections.length} sections · ${work.sections.reduce((n, s) => n + (s.repeat ? s.repeat.fields.length : s.fields.length), 0)} fields. Sections drive the quote wizard and API validation. Editing is a JSON edit; validation checks field keys, types, options and expressions.`),
      h('div', { class: 'card' }, ta, err, editable ? h('button', { class: 'btn btn-sm', style: { marginTop: '.4rem' }, onclick: () => { try { const p = JSON.parse(ta.value); for (const k of Object.keys(work)) delete work[k]; Object.assign(work, p); markDirty(); err.textContent = ''; toast('Definition updated (unsaved)', 'ok'); } catch (e) { err.textContent = e.message; } } }, 'Apply') : null));
  }

  // ---------------- validation / history / provenance ----------------
  function validationTab() {
    const out = h('div');
    if (v.validation) out.append(h('p', { class: 'small muted' }, `Last validation: ${v.validation.valid ? 'passed' : 'failed'} by ${v.validation.by} at ${when(v.validation.at)} (${v.validation.errors} errors, ${v.validation.warnings} warnings).`));
    const box = h('div');
    out.append(h('button', { class: 'btn btn-primary', onclick: async () => {
      box.replaceChildren(h('span', { class: 'muted' }, 'Validating…'));
      try { const res = await api.post(`/${base}/${id}/validate${can('config:edit') ? '' : '?persist=false'}`, {}); box.replaceChildren(renderReport(res.report)); if (res.document && res.document.status !== v.status) toast(`Status is now ${res.document.status}`, 'ok'); } catch (e) { box.replaceChildren(notice('bad', e.message)); }
    } }, 'Run validation now'), h('div', { style: { height: '1rem' } }), box);
    return out;
  }
  async function historyTab() {
    const { entries } = can('config:read') ? await api.get(`/audit?entityId=${id}&limit=200`).catch(() => ({ entries: [] })) : { entries: [] };
    return h('div', { class: 'grid grid-2' },
      h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Status transitions')), h('div', { class: 'card-body' }, (v.transitions || []).slice().reverse().map((t) => h('div', { class: 'diff-row', style: { gridTemplateColumns: '8rem 1fr' } }, h('span', { class: `badge ${VSTATUS[t.status] ?? ''}` }, t.status.replace('_', ' ')), h('span', null, `${t.by} · ${when(t.at)}`, t.note ? h('div', { class: 'small muted' }, t.note) : null))))),
      h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Audit entries')), h('div', { class: 'card-body scroll-y' }, entries.length ? entries.map((e) => h('div', { class: 'diff-row', style: { gridTemplateColumns: '1fr' } }, h('span', null, h('span', { class: 'badge' }, e.action), ' ', e.summary), h('span', { class: 'small muted' }, `${e.actor.id} (${e.actor.role}) · ${when(e.ts)} · ${e.id}`))) : h('span', { class: 'muted' }, 'None visible.'))));
  }
  function provenanceTab() {
    const p = v.provenance;
    const rows = [];
    for (const [table, list] of Object.entries(p.tables || {})) list.forEach((r, i) => rows.push([table, i + 1, r.sheet, r.row, Object.entries(r.cells).map(([k, c]) => `${k}: ${c.split('!')[1]}`).join('  ')]));
    for (const [k, c] of Object.entries(p.params || {})) rows.push(['(param)', k, c.sheet, '', c.cell.split('!')[1]]);
    return h('div', null, notice('info', `Every imported value keeps its source sheet and cell. File: ${p.file?.name} (sha256 ${shortHash(p.file?.sha256)}), profile ${p.profile}.`),
      h('div', { class: 'card flush' }, h('div', { class: 'scroll-y' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Table', 'Row', 'Sheet', 'Excel row', 'Source cells'].map((c) => h('th', null, c)))), h('tbody', null, rows.slice(0, 500).map((r) => h('tr', null, r.map((c) => h('td', { class: 'mono small' }, String(c)))))))), rows.length > 500 ? h('div', { class: 'card-body small muted' }, `Showing 500 of ${rows.length}.`) : null));
  }

  const root = h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('p', null, h('a', { href: `#/wb?product=${v.productId}` }, '← All versions')), h('h1', null, v.id, ' ', versionBadge(v)), h('p', null, v.label)), h('div', null, dirtyNote)),
    !editable && EDITABLE.includes(v.status) ? notice('info', 'Your role cannot edit this version.') : null,
    v.frozen ? notice('info', 'This version is active/immutable. To change rates, clone it into a new draft with a later effective date.') : null,
    h('div', { class: 'card' }, bar), tabsEl, bodyEl);
  drawTab();
  return wbLayout('#/wb', root);
}
void mount;
