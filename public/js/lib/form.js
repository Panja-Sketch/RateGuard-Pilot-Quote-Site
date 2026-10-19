// Schema-driven form renderer. The product definition (served by GET /products/:id/schema) decides
// which fields exist, which are conditional (showIf / requiredIf) and how they validate, so each
// line of business gets its own journey without any per-product UI code.
import { h } from './dom.js';
import { evalExpr, truthy } from '/shared/expr.js';
import { icon } from './icons.js';

const optValue = (o) => (typeof o === 'object' ? o.value : o);
const optLabel = (o) => (typeof o === 'object' ? o.label : String(o));
const blank = (v) => v === undefined || v === null || v === '';

export function getIn(obj, path) { return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj); }

export function applyDefaults(sections, data) {
  data.risk ||= {}; data.coverages ||= {};
  for (const s of sections) {
    const target = s.group === 'coverage' ? data.coverages : data.risk;
    if (s.repeat) {
      target[s.repeat.key] ||= [];
      while (target[s.repeat.key].length < (s.repeat.min || 0)) target[s.repeat.key].push(blankItem(s.repeat.fields));
    } else for (const f of s.fields) if (target[f.key] === undefined && f.default !== undefined) target[f.key] = f.default;
  }
  return data;
}
export function blankItem(fields) { const o = {}; for (const f of fields) if (f.default !== undefined) o[f.key] = f.default; return o; }

export function createForm({ sections, data, sys, onChange }) {
  let errors = {}; // path -> message
  const watchers = []; // {el, f, locals, rootName}
  const scope = (locals = {}) => ({ inputs: { risk: data.risk, cov: data.coverages, sys }, vars: {}, params: {}, locals });
  const test = (expr, locals) => { if (expr === undefined) return true; try { return truthy(evalExpr(expr, scope(locals))); } catch { return true; } };
  const visible = (f, locals) => test(f.showIf, locals);

  function refresh() {
    for (const w of watchers) {
      if (!w.el.isConnected) continue;
      const vis = visible(w.f, w.locals);
      w.el.hidden = !vis;
      const star = w.el.querySelector('.req');
      if (star) star.hidden = !(w.f.required || (w.f.requiredIf && test(w.f.requiredIf, w.locals)));
    }
    onChange?.();
  }

  function showErrors() {
    for (const w of watchers) {
      if (!w.el.isConnected) continue;
      const msg = errors[w.path];
      w.el.classList.toggle('invalid', !!msg);
      const slot = w.el.querySelector('.err');
      if (slot) slot.textContent = msg || '';
    }
  }

  function control(f, obj, path, locals) {
    const set = (v) => { if (blank(v)) delete obj[f.key]; else obj[f.key] = v; delete errors[path]; refresh(); showErrors(); };
    const id = `f-${path.replace(/[^\w]/g, '_')}`;
    const cur = obj[f.key];
    const describedBy = `${id}-d`;
    if (f.type === 'boolean') {
      return h('label', { class: 'switch' }, h('input', { type: 'checkbox', id, checked: cur === true, 'aria-describedby': describedBy, onchange: (e) => { obj[f.key] = e.target.checked; refresh(); } }), h('span', null, f.label));
    }
    if (f.optionsFrom) {
      const list = getIn(data, f.optionsFrom) || [];
      const sel = h('select', { id, 'aria-describedby': describedBy, onchange: (e) => set(e.target.value === '' ? undefined : Number(e.target.value)) },
        blank(cur) ? h('option', { value: '' }, 'Select…') : null,
        list.map((it, i) => h('option', { value: String(i + 1), selected: cur === i + 1 }, `Driver ${i + 1}${it.first_name ? ` – ${it.first_name}` : ''}`)));
      return sel;
    }
    if (f.type === 'select') {
      const opts = f.options || [];
      const short = opts.length <= 4 && opts.every((o) => optLabel(o).length <= 26);
      if (short) {
        const name = `${id}-r`;
        return h('div', { class: 'pills', role: 'radiogroup', 'aria-labelledby': `${id}-l`, 'aria-describedby': describedBy },
          opts.map((o) => h('label', { class: 'pill' }, h('input', { type: 'radio', name, value: optValue(o), checked: cur === optValue(o), onchange: () => set(optValue(o)) }), h('span', null, optLabel(o)))));
      }
      return h('select', { id, 'aria-describedby': describedBy, onchange: (e) => set(e.target.value === '' ? undefined : e.target.value) },
        blank(cur) ? h('option', { value: '' }, 'Select…') : null,
        opts.map((o) => h('option', { value: optValue(o), selected: cur === optValue(o) }, optLabel(o))));
    }
    if (f.type === 'integer' || f.type === 'number') {
      return h('input', { type: 'number', id, value: cur ?? '', min: f.min, max: f.max, step: f.type === 'integer' ? 1 : 'any', inputmode: 'decimal', 'aria-describedby': describedBy,
        oninput: (e) => { const v = e.target.value; set(v === '' ? undefined : Number(v)); } });
    }
    if (f.type === 'currency') {
      const inp = h('input', { type: 'text', id, inputmode: 'numeric', value: blank(cur) ? '' : Number(cur).toLocaleString('en-US'), 'aria-describedby': describedBy,
        oninput: (e) => { const raw = e.target.value.replace(/[^\d.]/g, ''); set(raw === '' ? undefined : Number(raw)); },
        onblur: (e) => { e.target.value = blank(obj[f.key]) ? '' : Number(obj[f.key]).toLocaleString('en-US'); } });
      return h('div', { class: 'money-in' }, inp);
    }
    if (f.type === 'date') return h('input', { type: 'date', id, value: cur ?? '', 'aria-describedby': describedBy, onchange: (e) => set(e.target.value || undefined) });
    if (f.type === 'zip') return h('input', { type: 'text', id, value: cur ?? '', maxlength: 5, inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': describedBy, oninput: (e) => set(e.target.value.trim() || undefined) });
    return h('input', { type: 'text', id, value: cur ?? '', maxlength: f.maxLength || 120, 'aria-describedby': describedBy, oninput: (e) => set(e.target.value || undefined) });
  }

  function field(f, obj, path, locals, rootName) {
    const labelled = f.type === 'boolean' ? null : h('label', { id: `f-${path.replace(/[^\w]/g, '_')}-l`, for: `f-${path.replace(/[^\w]/g, '_')}` }, f.label, ' ', h('span', { class: 'req', hidden: !(f.required || f.requiredIf), 'aria-hidden': 'true' }, '*'));
    const el = h('div', { class: 'field', 'data-path': path },
      labelled, control(f, obj, path, locals),
      h('div', { class: 'help', id: `f-${path.replace(/[^\w]/g, '_')}-d` }, f.help || ''), h('div', { class: 'err', role: 'alert' }));
    if (f.type === 'select' && labelled) labelled.removeAttribute('for');
    watchers.push({ el, f, locals, path, rootName });
    el.hidden = !visible(f, locals);
    return el;
  }

  function renderSection(section) {
    const wrap = h('div');
    const target = section.group === 'coverage' ? data.coverages : data.risk;
    const rootName = section.group === 'coverage' ? 'coverages' : 'risk';
    wrap.appendChild(h('h2', null, section.title));
    if (section.intro) wrap.appendChild(h('p', { class: 'muted' }, section.intro));
    if (!section.repeat) {
      wrap.appendChild(h('div', { class: 'fields-grid' }, section.fields.map((f) => field(f, target, `${rootName}.${f.key}`, {}, rootName))));
      return wrap;
    }
    const { key, min = 0, max = 99, itemLabel = 'Item', fields } = section.repeat;
    const list = h('div');
    const draw = () => {
      for (let i = watchers.length - 1; i >= 0; i--) if (watchers[i].path.startsWith(`${rootName}.${key}[`)) watchers.splice(i, 1);
      list.replaceChildren();
      const items = (target[key] ||= []);
      items.forEach((item, i) => {
        list.appendChild(h('div', { class: 'rep-card' },
          h('header', null, h('h3', { style: { margin: 0 } }, `${itemLabel} ${i + 1}${item.first_name ? ` – ${item.first_name}` : item.make ? ` – ${item.year ?? ''} ${item.make} ${item.model ?? ''}` : ''}`),
            items.length > min ? h('button', { class: 'btn btn-sm btn-danger', type: 'button', 'aria-label': `Remove ${itemLabel} ${i + 1}`, onclick: () => { items.splice(i, 1); errors = {}; draw(); refresh(); } }, icon('trash', 14), 'Remove') : null),
          h('div', { class: 'fields-grid' }, fields.map((f) => field(f, item, `${rootName}.${key}[${i}].${f.key}`, { item, loop: { index: i, n: i + 1 } }, rootName)))));
      });
      add.disabled = items.length >= max;
      add.replaceChildren(icon('plus', 14), `Add ${itemLabel.toLowerCase()}`);
      showErrors();
    };
    const add = h('button', { class: 'btn', type: 'button', onclick: () => { (target[key] ||= []).push(blankItem(fields)); draw(); refresh(); } });
    const holder = h('div', { class: 'field', 'data-path': `${rootName}.${key}` }, h('div', { class: 'err', role: 'alert' }));
    wrap.append(holder, list, add);
    watchers.push({ el: holder, f: { showIf: undefined }, locals: {}, path: `${rootName}.${key}`, rootName });
    draw();
    return wrap;
  }

  function validateSection(section) {
    const out = [];
    const target = section.group === 'coverage' ? data.coverages : data.risk;
    const rootName = section.group === 'coverage' ? 'coverages' : 'risk';
    const checkField = (f, obj, path, locals, label = '') => {
      if (!visible(f, locals)) return;
      const v = obj[f.key];
      const required = f.required || (f.requiredIf && test(f.requiredIf, locals));
      if (blank(v)) { if (required) out.push({ path, message: `${label}${f.label} is required.` }); return; }
      if ((f.type === 'integer' || f.type === 'number' || f.type === 'currency')) {
        if (typeof v !== 'number' || Number.isNaN(v)) out.push({ path, message: `${label}${f.label} must be a number.` });
        else if (f.type === 'integer' && !Number.isInteger(v)) out.push({ path, message: `${label}${f.label} must be a whole number.` });
        else if (f.min !== undefined && v < f.min) out.push({ path, message: `${label}${f.label} must be at least ${f.min}.` });
        else if (f.max !== undefined && v > f.max) out.push({ path, message: `${label}${f.label} must be no more than ${f.max}.` });
      } else if (f.type === 'zip' && !/^\d{5}$/.test(String(v))) out.push({ path, message: `${label}${f.label} must be a 5-digit ZIP code.` });
    };
    if (section.repeat) {
      const { key, min = 0, max = 99, itemLabel = 'Item', fields } = section.repeat;
      const items = target[key] || [];
      if (items.length < min) out.push({ path: `${rootName}.${key}`, message: `Add at least ${min} ${itemLabel.toLowerCase()}.` });
      if (items.length > max) out.push({ path: `${rootName}.${key}`, message: `At most ${max} ${itemLabel.toLowerCase()}s.` });
      items.forEach((item, i) => fields.forEach((f) => checkField(f, item, `${rootName}.${key}[${i}].${f.key}`, { item, loop: { index: i, n: i + 1 } }, `${itemLabel} ${i + 1}: `)));
      for (const chk of section.checks || []) items.forEach((item, i) => { if (!test(chk.check, { item, loop: { index: i, n: i + 1 } })) out.push({ path: `${rootName}.${key}[${i}].${chk.field || ''}`.replace(/\.$/, ''), message: `${itemLabel} ${i + 1}: ${chk.message}` }); });
    } else {
      section.fields.forEach((f) => checkField(f, target, `${rootName}.${f.key}`, {}));
      for (const chk of section.checks || []) if (!test(chk.check, {})) out.push({ path: `${rootName}.${chk.field || ''}`.replace(/\.$/, ''), message: chk.message });
    }
    return out;
  }

  function sectionOfPath(path) {
    for (const s of sections) {
      const root = s.group === 'coverage' ? 'coverages' : 'risk';
      if (s.repeat) { if (path === `${root}.${s.repeat.key}` || path.startsWith(`${root}.${s.repeat.key}[`)) return s.id; }
      else if (s.fields.some((f) => path === `${root}.${f.key}`)) return s.id;
    }
    return null;
  }

  return {
    renderSection, validateSection, sectionOfPath,
    setErrors(list) { errors = {}; for (const e of list) errors[e.path] = e.message; showErrors(); },
    get errors() { return errors; },
    showErrors, refresh,
  };
}

/** Read-only summary of everything entered, grouped by section. */
export function summarize(sections, data) {
  const fmt = (f, v) => {
    if (blank(v)) return '—';
    if (f.type === 'boolean') return v ? 'Yes' : 'No';
    if (f.type === 'currency') return `$${Number(v).toLocaleString('en-US')}`;
    if (f.type === 'select') { const o = (f.options || []).find((x) => optValue(x) === v); return o ? optLabel(o) : String(v); }
    return String(v);
  };
  const blocks = [];
  const ctx = { inputs: { risk: data.risk, cov: data.coverages, sys: {} }, vars: {}, params: {}, locals: {} };
  for (const s of sections) {
    const target = s.group === 'coverage' ? data.coverages : data.risk;
    const dl = (obj, fields, locals) => h('dl', { class: 'kv' }, fields.filter((f) => { try { return f.showIf === undefined || truthy(evalExpr(f.showIf, { ...ctx, locals })); } catch { return true; } }).flatMap((f) => [h('dt', null, f.label), h('dd', null, fmt(f, obj[f.key]))]));
    if (s.repeat) blocks.push(h('div', { class: 'card' }, h('h3', null, s.title), (target[s.repeat.key] || []).map((it, i) => h('div', { style: { marginBottom: '.7rem' } }, h('h4', null, `${s.repeat.itemLabel} ${i + 1}`), dl(it, s.repeat.fields, { item: it })))));
    else blocks.push(h('div', { class: 'card' }, h('h3', null, s.title), dl(target, s.fields, {})));
  }
  return blocks;
}
