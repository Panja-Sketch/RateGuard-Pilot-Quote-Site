// Tiny DOM helpers. Everything user-visible goes through textContent / text nodes, never innerHTML.
const DIRECT = new Set(['value', 'checked', 'selected', 'disabled', 'readOnly', 'multiple', 'indeterminate']);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (DIRECT.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); append(el, kids); return el; }

let toastBox;
export function toast(message, kind = '') {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
  const t = h('div', { class: `toast ${kind}` }, message);
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3800);
}

/** Generic modal. `build(close)` returns the body; resolves when closed. */
export function modal(title, build, { wide = false } = {}) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h3', null, title), build(close));
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(undefined); } }, box);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    (box.querySelector('input, textarea, select, button') || box).focus();
  });
}

export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return modal(title, (close) => h('div', null,
    h('p', null, message),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'), h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, confirmLabel))));
}

/** Asks for a text value (e.g. a required reason). Resolves with the string or undefined. */
export function promptDialog(title, label, { required = true, confirmLabel = 'Submit', multiline = true, placeholder = '' } = {}) {
  return modal(title, (close) => {
    const input = multiline ? h('textarea', { rows: 3, placeholder, 'aria-label': label, style: { fontFamily: 'inherit', fontSize: '.95rem' } }) : h('input', { type: 'text', placeholder, 'aria-label': label });
    const err = h('div', { class: 'err small', style: { color: 'var(--bad)' } });
    const ok = () => { const v = input.value.trim(); if (required && !v) { err.textContent = 'This is required.'; return; } close(v); };
    return h('div', null, h('label', { class: 'small muted' }, label), input, err,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: ok }, confirmLabel)));
  });
}

export const spinner = () => h('span', { class: 'spinner', role: 'status', 'aria-label': 'Loading' });

export function badge(text, kind = '') { return h('span', { class: `badge ${kind}` }, text); }

export function notice(kind, ...kids) { return h('div', { class: `notice ${kind}`, role: kind === 'bad' ? 'alert' : undefined }, ...kids); }

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard', 'ok'), () => toast('Copy failed – select and copy manually', 'bad'));
  toast('Clipboard not available in this browser', 'bad');
  return Promise.resolve();
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Re-run the current route (used after a state change). */
export const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
