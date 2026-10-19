import { h, toast, notice, mount } from '../lib/dom.js';
import { api, setSession } from '../lib/api.js';

export function loginPage() {
  const err = h('div');
  const user = h('input', { type: 'text', id: 'lg-user', autocomplete: 'username', value: 'agent.demo' });
  const pass = h('input', { type: 'password', id: 'lg-pass', autocomplete: 'current-password', placeholder: 'See README (local demo password)' });
  const picker = h('div', { class: 'user-pick', 'aria-label': 'Demo users' });

  async function doLogin(e) {
    e?.preventDefault();
    mount(err);
    try {
      const out = await api.post('/auth/login', { username: user.value.trim(), password: pass.value });
      setSession({ token: out.token, user: out.user, permissions: [] });
      const me = await api.get('/auth/me');
      setSession({ token: out.token, user: me.user, permissions: me.permissions });
      location.hash = '#/';
    } catch (ex) { mount(err, notice('bad', ex.message)); }
  }

  api.get('/auth/demo-users').then(({ users }) => {
    mount(picker, users.map((u) => h('button', { type: 'button', onclick: () => { user.value = u.id; pass.focus(); } }, h('strong', null, u.id), ' ', h('span', { class: 'badge' }, u.role.replace('_', ' ')), h('div', { class: 'small muted' }, u.blurb))));
  }).catch(() => {});

  return h('div', { class: 'login-wrap' }, h('div', { class: 'card login-card' },
    h('div', { class: 'row' }, h('span', { class: 'brand-mark', style: { width: '36px', height: '36px', borderRadius: '9px', background: 'var(--primary)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 } }, 'P'), h('h1', { style: { margin: 0, fontSize: '1.4rem' } }, 'Pilot Quote Site')),
    h('p', { class: 'muted' }, 'A synthetic insurance rating and quoting pilot. Sign in with a demo user. Everything here is invented: quotes are illustrative only and nothing is real coverage.'),
    h('form', { onsubmit: doLogin },
      h('div', { class: 'field' }, h('label', { for: 'lg-user' }, 'Username'), user),
      h('div', { class: 'field' }, h('label', { for: 'lg-pass' }, 'Password'), pass),
      err,
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in')),
    h('h3', { style: { marginTop: '1.2rem' } }, 'Demo users'),
    h('p', { class: 'small muted' }, 'Each role sees different tools: agents quote; analysts edit and import; approvers approve and promote; admins can do everything (four-eyes still applies).'),
    picker,
    h('p', { class: 'small muted', style: { marginTop: '1rem' } }, 'This pilot is separate from RateGuard Enhanced and is not integrated with any RateGuard product.')));
}
void toast;
