import { h, copyText, notice } from '../lib/dom.js';
import { getSession } from '../lib/api.js';

export async function apiPage() {
  const origin = location.origin;
  const token = getSession()?.token;
  const login = `curl -s -X POST ${origin}/api/v1/auth/login -H "content-type: application/json" \\\n  -d '{"username":"rateguard.client","password":"<API client demo password from README>"}'`;
  const quote = `curl -s -X POST ${origin}/api/v1/quotes -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d @request.json`;
  const body = JSON.stringify({ scenarioId: 'HO-AZ-roof-21', productId: 'homeowners', state: 'AZ', transactionType: 'NEW_BUSINESS', effectiveDate: '2026-10-15', risk: '{ …see GET /api/v1/products/homeowners/schema… }', coverages: '{ … }', options: { trace: true } }, null, 2);
  const row = (m, p, d) => h('tr', null, h('td', null, h('span', { class: 'inline-code' }, m)), h('td', null, h('span', { class: 'mono' }, p)), h('td', null, d));
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'API & integration boundary'), h('p', null, 'The same REST API powers this UI. It is documented so a future independent verifier could call it — but no such integration exists today.'))),
    notice('warn', h('strong', null, 'Not integrated. '), 'This pilot is separate from RateGuard Enhanced and is not connected to it. RateGuard v3 has not been built. Nothing here claims otherwise. The pilot\'s own “scenario runner” is test tooling that compares two pilot configurations using the pilot\'s own engine; it is not independent assurance.'),
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' }, h('h3', null, 'Contract at a glance'),
        h('ul', { style: { margin: '0 0 0 1.1rem', padding: 0 } },
          h('li', null, 'Single quote, batch quote (≤ 200), product/input-schema discovery, rating-version discovery, draft-version validation, rating trace and premium components.'),
          h('li', null, 'Every result echoes scenario ID, product & LOB, state, transaction type, effective date, inputs, product/rating version IDs and hashes, premium & components, applied tables, eligibility/validation outcome.'),
          h('li', null, 'Business outcomes are HTTP 200 with a status (QUOTED, REFERRED, DECLINED, INFO_REQUIRED, INVALID, RATING_ERROR). Malformed requests are 4xx.'),
          h('li', null, 'A caller never needs the pilot\'s source code or configuration to request a quote.')),
        h('p', null, h('a', { href: '/api/v1/openapi.json', target: '_blank', rel: 'noopener' }, 'OpenAPI document (JSON)'), ' · docs in the repository: docs/API.md, docs/INTEGRATION_CONTRACT.md')),
      h('div', { class: 'card' }, h('h3', null, 'Authentication boundary'),
        h('p', null, 'Local demo: sign in at ', h('span', { class: 'inline-code' }, 'POST /api/v1/auth/login'), ' and send ', h('span', { class: 'inline-code' }, 'Authorization: Bearer <token>'), '. The ', h('span', { class: 'inline-code' }, 'rateguard.client'), ' demo user has the API-only role.'),
        h('p', null, 'Cloud (documented, not deployed): Firebase Authentication ID tokens and/or Cloud Run IAM in front of the service.'),
        token ? h('button', { class: 'btn', onclick: () => copyText(token) }, 'Copy my current demo token') : null)),
    h('div', { class: 'card' }, h('h3', null, 'Try it'),
      h('p', { class: 'muted' }, '1. Get a token'), h('div', { class: 'code' }, login),
      h('p', { class: 'muted', style: { marginTop: '.8rem' } }, '2. Discover the input schema, then post a request such as:'), h('div', { class: 'code' }, body),
      h('p', { class: 'muted', style: { marginTop: '.8rem' } }, '3. Quote'), h('div', { class: 'code' }, quote),
      h('p', { class: 'small muted', style: { marginTop: '.8rem' } }, 'Tip: use “Copy API request” on any quote page to get a complete, valid request body.')),
    h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, 'Main endpoints (prefix /api/v1)')),
      h('div', { class: 'scroll-x' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Method', 'Path', 'Purpose'].map((c) => h('th', null, c)))), h('tbody', null,
        row('GET', '/products/{id}/schema', 'Input-schema discovery (sections, conditional rules, JSON Schema) for the product version in force on ?date='),
        row('GET', '/rating-versions?productId=&state=', 'Rating-version discovery (status, effective dates, hashes)'),
        row('GET', '/rating-versions/resolve?productId=&state=&date=', 'Which national + state versions apply on a date'),
        row('POST', '/quotes', 'One synthetic quote with premium components and a safe trace'),
        row('POST', '/quotes/batch', 'Up to 200 scenarios, per-item outcomes'),
        row('POST', '/rating-versions/validate', 'Validate a draft/candidate version without storing it'),
        row('POST', '/rating-versions/{id}/validate', 'Validate a stored draft (read-only for API clients)'),
        row('POST', '/test-tools/compare', 'Pilot test tooling: compare two pilot configurations'))))));
}
