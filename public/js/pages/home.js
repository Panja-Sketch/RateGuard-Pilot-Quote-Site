import { h } from '../lib/dom.js';
import { api, can } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { money, statusBadge, when, STATE_NAME } from '../lib/format.js';

export async function homePage() {
  const [{ products }, { submissions }] = await Promise.all([
    api.get('/products'),
    can('submission:write') ? api.get('/submissions') : Promise.resolve({ submissions: [] }),
  ]);
  const ICON = { car: 'car', home: 'home', building: 'building', briefcase: 'briefcase' };
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Get an illustrative quote'), h('p', null, 'Pick a line of business. Each has its own journey, built from a versioned product definition.'))),
    h('div', { class: 'grid grid-4' }, products.map((p) => h('a', { class: 'tile', href: `#/start/${p.id}` },
      h('div', { class: 'ico' }, icon(ICON[p.icon] || 'file', 22)), h('h3', null, p.name), h('p', null, p.tagline),
      h('p', { class: 'small', style: { marginTop: '.6rem' } }, `Product definition ${p.productVersion?.id ?? '—'}`)))),
    h('div', { class: 'grid grid-2', style: { marginTop: '1.25rem' } },
      h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Recent submissions'), h('a', { href: '#/submissions' }, 'View all')),
        submissions.length ? h('div', { class: 'scroll-x' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Submission', 'Product', 'State', 'Status', 'Updated'].map((c) => h('th', null, c)))),
          h('tbody', null, submissions.slice(0, 6).map((s) => h('tr', { class: 'click', tabindex: 0, onclick: () => { location.hash = s.latestQuoteId ? `#/s/${s.id}/quote` : `#/s/${s.id}`; } },
            h('td', null, h('strong', null, s.id), h('div', { class: 'small muted' }, s.name || '')), h('td', null, s.productId), h('td', null, s.state), h('td', null, statusBadge(s.status)), h('td', { class: 'small' }, when(s.updatedAt))))))) : h('div', { class: 'empty' }, 'No submissions yet.')),
      h('div', { class: 'card' }, h('h3', null, 'How this pilot works'),
        h('ul', { style: { margin: '0 0 .6rem 1.1rem', padding: 0 } },
          h('li', null, 'Quotes are computed by a deterministic rating engine from versioned, state-aware, effective-dated synthetic configuration.'),
          h('li', null, 'Every quote lists the product and rating version IDs it used, the tables applied and a step-by-step trace.'),
          h('li', null, `Demo jurisdictions: ${Object.keys(STATE_NAME).join(', ')} (a configurable synthetic set).`),
          h('li', null, 'Bind is simulated and never creates coverage.')),
        h('p', { class: 'small muted' }, 'This site is a standalone test target. It is not integrated with RateGuard Enhanced, and RateGuard v3 does not exist yet.'),
        h('p', { class: 'small muted' }, `Sample premium format: ${money(1234.5)} per 12-month term (illustrative).`))));
}
