import { h, mount, spinner, notice, toast } from './lib/dom.js';
import { api, getSession, setSession, setUnauthorizedHandler, role } from './lib/api.js';

const routes = [];
export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ re, keys, handler });
}
export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

const WORKBENCH_ROLES = ['pricing_analyst', 'pricing_approver', 'admin'];
const app = document.getElementById('app');
let mainEl;
let renderToken = 0;

function shell() {
  const s = getSession();
  const links = [['#/', 'Home'], ['#/start', 'New quote'], ['#/submissions', 'Submissions']];
  if (WORKBENCH_ROLES.includes(s.user.role)) links.push(['#/wb', 'Pricing workbench']);
  links.push(['#/api', 'API & integration']);
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, links.map(([href, label]) => h('a', { href, 'data-href': href }, label)));
  mainEl = h('main', { class: 'container', id: 'main', tabindex: '-1' });
  mount(app,
    h('div', { class: 'banner', role: 'note' }, 'SYNTHETIC DEMO · Illustrative quotes from invented rates · Not an offer, binder, policy or coverage · Not connected to RateGuard'),
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, 'P'), h('span', null, 'Pilot Quote Site')), nav,
      h('div', { class: 'userbox' }, h('span', { class: 'badge info', title: s.user.id }, s.user.role.replace('_', ' ')), h('span', { class: 'muted' }, s.user.name.replace(' (demo)', '')),
        h('button', { class: 'btn btn-sm', onclick: signOut }, 'Sign out')))),
    mainEl);
}

function highlightNav() {
  const cur = location.hash || '#/';
  for (const a of document.querySelectorAll('.nav a')) {
    const href = a.getAttribute('data-href');
    const active = href === '#/' ? cur === '#/' || cur === '' : cur.startsWith(href);
    a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

export function signOut() { setSession(null); location.hash = '#/login'; }

async function render() {
  const token = ++renderToken;
  const hash = (location.hash || '#/').replace(/\?.*$/, '');
  const path = hash.slice(1) || '/';
  const query = new URLSearchParams((location.hash.split('?')[1]) || '');
  if (path !== '/login' && !getSession()) { location.hash = '#/login'; return; }
  if (path === '/login') { const { loginPage } = await import('./pages/login.js'); mount(app, loginPage()); return; }
  if (!mainEl || !mainEl.isConnected) shell();
  highlightNav();
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    mount(mainEl, h('div', { class: 'empty' }, spinner(), ' Loading…'));
    try {
      const node = await r.handler(params, query);
      if (token !== renderToken) return;
      mount(mainEl, node);
      mainEl.focus({ preventScroll: true }); window.scrollTo(0, 0);
    } catch (e) {
      if (token !== renderToken) return;
      mount(mainEl, notice('bad', h('strong', null, 'Something went wrong. '), e.message || String(e)), h('p', null, h('a', { href: '#/' }, 'Back to home')));
    }
    return;
  }
  mount(mainEl, notice('warn', 'That page does not exist.'), h('a', { href: '#/' }, 'Back to home'));
}

setUnauthorizedHandler(() => { setSession(null); toast('Your session has expired. Please sign in again.', 'bad'); location.hash = '#/login'; });

async function boot() {
  const s = getSession();
  if (s) {
    try { const me = await api.get('/auth/me'); setSession({ ...s, user: me.user, permissions: me.permissions }); }
    catch { setSession(null); }
  }
  const [{ homePage }, { startPage }, { wizardPage }, { quotePage, storedQuotePage }, { submissionsPage }, { apiPage }] = await Promise.all([
    import('./pages/home.js'), import('./pages/start.js'), import('./pages/wizard.js'), import('./pages/quote.js'), import('./pages/submissions.js'), import('./pages/apidocs.js'),
  ]);
  route('/', homePage);
  route('/start', startPage); route('/start/:productId', startPage);
  route('/s/:id', wizardPage);
  route('/s/:id/quote', quotePage);
  route('/q/:quoteId', storedQuotePage);
  route('/submissions', submissionsPage);
  route('/api', apiPage);
  const wb = await import('./pages/wb/index.js');
  wb.registerWorkbenchRoutes(route);
  window.addEventListener('hashchange', render);
  render();
}
boot().catch((e) => mount(app, h('div', { class: 'container' }, notice('bad', `The app failed to start: ${e.message}`))));
