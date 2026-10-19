// Generates docs/openapi.json. Run: npm run openapi. A test checks every documented route exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema) => ({ 'application/json': { schema } });
const ok = (schema, description = 'OK') => ({ description, content: json(schema) });
const err = (description) => ({ description, content: json(ref('ApiError')) });
const idParam = (name = 'id', description = 'Identifier') => ({ name, in: 'path', required: true, description, schema: { type: 'string' } });
const q = (name, description, schema = { type: 'string' }) => ({ name, in: 'query', required: false, description, schema });

const paths = {};
function op(method, p, o) {
  paths[p] ||= {};
  paths[p][method] = {
    summary: o.summary, description: o.description, tags: [o.tag], operationId: o.id,
    ...(o.public ? { security: [] } : {}),
    ...(o.roles ? { 'x-roles': o.roles } : {}),
    ...(o.params ? { parameters: o.params } : {}),
    ...(o.body ? { requestBody: { required: true, content: o.body.raw ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } : json(o.body) } } : {}),
    responses: { [o.status || 200]: o.response || ok({ type: 'object' }), ...(o.errors || {}), 401: err('Missing or invalid token'), ...(o.roles ? { 403: err('Role not permitted') } : {}) },
  };
}

const ALL = 'all authenticated roles';
const PRICING = 'pricing_analyst, pricing_approver, admin';

// -------- meta/auth
op('get', '/meta', { tag: 'Meta', id: 'getMeta', summary: 'Service metadata and the synthetic-data notice', public: true });
op('post', '/auth/login', { tag: 'Auth', id: 'login', summary: 'Demo sign-in (AUTH_MODE=demo)', public: true, body: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string', example: 'agent.demo' }, password: { type: 'string' } } }, response: ok({ type: 'object', properties: { token: { type: 'string' }, user: { type: 'object' }, expiresAt: { type: 'string', format: 'date-time' } } }), errors: { 429: err('Too many attempts') } });
op('get', '/auth/demo-users', { tag: 'Auth', id: 'demoUsers', summary: 'List demo usernames and roles (never passwords)', public: true });
op('get', '/auth/me', { tag: 'Auth', id: 'me', summary: 'Current user and permissions' });

// -------- discovery
op('get', '/products', { tag: 'Discovery', id: 'listProducts', summary: 'List synthetic products with the product version in force today', roles: ALL });
op('get', '/products/{id}', { tag: 'Discovery', id: 'getProduct', summary: 'Product and all its configuration versions', params: [idParam('id', 'personal-auto | homeowners | commercial-property | bop')] });
op('get', '/products/{id}/schema', { tag: 'Discovery', id: 'getProductSchema', summary: 'Input-schema discovery (sections, fields, conditional rules, JSON Schema)', description: 'Resolves the product version in force on `date` (default: today) or pins `versionId`.', params: [idParam('id'), q('date', 'YYYY-MM-DD'), q('versionId', 'Pin a product version')], response: ok(ref('ProductSchema')) });
op('get', '/jurisdictions', { tag: 'Discovery', id: 'jurisdictions', summary: 'Demo jurisdiction set (configurable synthetic list)' });
op('get', '/rating-versions', { tag: 'Discovery', id: 'listRatingVersions', summary: 'Rating-version discovery', params: [q('productId', 'Filter'), q('state', 'State overrides for this state plus national'), q('status', 'draft|validated|pending_approval|approved|active|rejected|rolled_back'), q('scope', 'national|state')], response: ok({ type: 'object', properties: { versions: { type: 'array', items: ref('RatingVersionSummary') } } }) });
op('get', '/rating-versions/resolve', { tag: 'Discovery', id: 'resolveVersions', summary: 'Which product/national/state versions apply for a product, state and date', params: [q('productId', 'Required'), q('state', 'Required'), q('date', 'YYYY-MM-DD, default today')] });
op('get', '/rating-versions/{id}', { tag: 'Discovery', id: 'getRatingVersion', summary: 'One version including its full content (tables, steps, rules, limits)', params: [idParam()] });
op('get', '/rating-versions/{a}/diff/{b}', { tag: 'Workbench', id: 'diffVersions', summary: 'Structured before/after diff between two versions', params: [idParam('a'), idParam('b')] });
op('get', '/rating-versions/{id}/export.xlsx', { tag: 'XLSX', id: 'exportVersionXlsx', summary: 'Export a version to the Pilot Rate Workbook Profile v1', params: [idParam()], response: { description: 'xlsx', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } } } });
op('get', '/product-versions', { tag: 'Discovery', id: 'listProductVersions', summary: 'Product (input-schema) versions' });
op('post', '/product-versions', { tag: 'Workbench', id: 'createProductDraft', summary: 'Create a product (input-schema) draft. The lifecycle routes under /rating-versions/{id}/... (validate, submit, approve, promote, rollback...) are mirrored under /product-versions/{id}/...', body: { type: 'object', properties: { productId: { type: 'string' }, fromVersionId: { type: 'string' }, label: { type: 'string' }, effectiveFrom: { type: 'string', format: 'date' }, content: { type: 'object' } } }, status: 201, roles: 'pricing_analyst, admin' });
op('get', '/product-versions/{id}', { tag: 'Discovery', id: 'getProductVersion', summary: 'One product version', params: [idParam()] });

// -------- quotes (integration surface)
op('post', '/quotes', { tag: 'Quotes', id: 'quote', summary: 'Rate ONE synthetic scenario', description: 'Always returns HTTP 200 for business outcomes (QUOTED, REFERRED, DECLINED, INFO_REQUIRED, INVALID, RATING_ERROR). Malformed requests return 400. Add `?persist=true` to store an immutable quote record.', params: [q('persist', 'true to store the quote', { type: 'string', enum: ['true', 'false'] })], body: ref('QuoteRequest'), response: ok(ref('QuoteResult')), errors: { 400: err('Malformed request'), 404: err('Unknown product'), 403: err('Version pinning not permitted for this role') }, roles: ALL });
op('post', '/quotes/batch', { tag: 'Quotes', id: 'quoteBatch', summary: 'Rate up to 200 scenarios synchronously', body: ref('BatchRequest'), response: ok(ref('BatchResult')), errors: { 413: err('More than 200 scenarios') }, roles: ALL });
op('post', '/validate-submission', { tag: 'Quotes', id: 'validateSubmission', summary: 'Validate inputs + eligibility without releasing a premium', body: ref('QuoteRequest') });
op('get', '/quotes/{id}', { tag: 'Quotes', id: 'getQuote', summary: 'Retrieve a stored (immutable) quote', params: [idParam()], response: ok(ref('QuoteResult')) });

// -------- validation of versions
op('post', '/rating-versions/validate', { tag: 'Validation', id: 'validateCandidate', summary: 'Validate a candidate rating version document WITHOUT storing it', body: { type: 'object', required: ['productId', 'content'], properties: { productId: { type: 'string' }, scope: { type: 'object' }, effectiveFrom: { type: 'string', format: 'date' }, content: { type: 'object' } } }, response: ok(ref('ValidationReport')), roles: `${PRICING}, api_client` });
op('post', '/rating-versions/{id}/validate', { tag: 'Validation', id: 'validateVersion', summary: 'Validate a stored version (draft or otherwise). Editors persist the result; other roles get a read-only report.', params: [idParam(), q('persist', 'false to force read-only')], roles: `${PRICING}, api_client` });

// -------- workbench lifecycle
op('post', '/rating-versions', { tag: 'Workbench', id: 'createDraft', summary: 'Create a draft (clone with fromVersionId, or new)', body: { type: 'object', properties: { productId: { type: 'string' }, scope: { type: 'object' }, fromVersionId: { type: 'string' }, label: { type: 'string' }, effectiveFrom: { type: 'string', format: 'date' }, content: { type: 'object' }, changeTicket: { type: 'object' } } }, status: 201, roles: 'pricing_analyst, admin' });
op('put', '/rating-versions/{id}', { tag: 'Workbench', id: 'updateDraft', summary: 'Edit a draft/validated/rejected version (resets validation)', params: [idParam()], body: { type: 'object' }, roles: 'pricing_analyst, admin' });
for (const [a, roles, summary] of [['submit', 'pricing_analyst, admin', 'Submit a validated draft for approval'], ['withdraw', 'pricing_analyst, admin', 'Withdraw from approval back to draft'], ['approve', 'pricing_approver, admin', 'Approve (four-eyes: not the creator/submitter)'], ['reject', 'pricing_approver, admin', 'Reject with a required reason'], ['promote', 'pricing_approver, admin', 'Promote an approved version to active (effective-dated, immutable)'], ['rollback', 'pricing_approver, admin', 'Roll back an active version with a required reason']]) {
  op('post', `/rating-versions/{id}/${a}`, { tag: 'Workbench', id: `${a}Version`, summary, params: [idParam()], body: { type: 'object', properties: { note: { type: 'string' }, reason: { type: 'string' } } }, roles });
}
op('post', '/demo/drafts', { tag: 'Workbench', id: 'createDemoDraft', summary: 'Generate a demo draft: normal rate change or intentional defect', body: { type: 'object', required: ['productId', 'kind'], properties: { productId: { type: 'string' }, kind: { type: 'string', enum: ['rate_change', 'defect_silent', 'defect_structural'] }, pct: { type: 'number', example: 4 }, fromVersionId: { type: 'string' }, effectiveFrom: { type: 'string', format: 'date' } } }, status: 201, roles: 'pricing_analyst, admin' });

// -------- submissions
op('get', '/submissions', { tag: 'Submissions', id: 'listSubmissions', summary: 'List saved synthetic submissions', params: [q('productId', ''), q('status', ''), q('q', 'text search'), q('state', '')] });
op('post', '/submissions', { tag: 'Submissions', id: 'createSubmission', summary: 'Save a submission (draft)', body: ref('QuoteRequest'), status: 201 });
op('get', '/submissions/{id}', { tag: 'Submissions', id: 'getSubmission', summary: 'Retrieve a submission', params: [idParam()] });
op('put', '/submissions/{id}', { tag: 'Submissions', id: 'updateSubmission', summary: 'Edit a submission (locked after simulated bind)', params: [idParam()], body: { type: 'object' } });
op('delete', '/submissions/{id}', { tag: 'Submissions', id: 'deleteSubmission', summary: 'Delete a non-bound submission', params: [idParam()], status: 204, response: { description: 'Deleted' } });
op('post', '/submissions/{id}/rate', { tag: 'Submissions', id: 'rateSubmission', summary: 'Rate the saved inputs and store an immutable quote', params: [idParam()] });
op('get', '/submissions/{id}/quotes', { tag: 'Submissions', id: 'submissionQuotes', summary: 'All quotes produced for the submission', params: [idParam()] });
op('post', '/submissions/{id}/bind-simulated', { tag: 'Submissions', id: 'bindSimulated', summary: 'SIMULATED bind. Never creates coverage.', params: [idParam()] });
op('post', '/submissions/{id}/scenarios', { tag: 'Submissions', id: 'createScenario', summary: 'Create a renewal or endorsement test scenario from a quoted submission', params: [idParam()], body: { type: 'object', required: ['type', 'effectiveDate'], properties: { type: { type: 'string', enum: ['RENEWAL', 'ENDORSEMENT'] }, effectiveDate: { type: 'string', format: 'date' } } }, status: 201 });

// -------- workbooks
op('get', '/workbooks', { tag: 'XLSX', id: 'listWorkbooks', summary: 'Uploaded workbooks' });
op('get', '/workbooks/samples', { tag: 'XLSX', id: 'listSamples', summary: 'Synthetic sample workbooks shipped with the pilot' });
op('get', '/workbooks/samples/{file}', { tag: 'XLSX', id: 'downloadSample', summary: 'Download a sample workbook', params: [idParam('file')] });
op('post', '/workbooks', { tag: 'XLSX', id: 'uploadWorkbook', summary: 'Upload an .xlsx (raw bytes; header X-Filename). Unsafe files are rejected and not retained.', body: { raw: true }, status: 201, roles: 'pricing_analyst, admin' });
op('post', '/workbooks/compare', { tag: 'XLSX', id: 'compareWorkbooks', summary: 'Cell-level comparison of two uploaded workbooks', body: { type: 'object', required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } } } });
op('post', '/workbooks/{id}/inspect', { tag: 'XLSX', id: 'inspectWorkbook', summary: 'Sheets, tables, columns, issues and SUGGESTED mapping (never auto-applied)', params: [idParam()], body: { type: 'object', properties: { baseVersionId: { type: 'string' } } } });
op('post', '/workbooks/{id}/preview', { tag: 'XLSX', id: 'previewImport', summary: 'Dry-run an import: issues, diff vs base, validation of the would-be draft', params: [idParam()], body: { type: 'object', required: ['mapping', 'baseVersionId'], properties: { mapping: { type: 'object' }, baseVersionId: { type: 'string' } } } });
op('post', '/workbooks/{id}/import', { tag: 'XLSX', id: 'importWorkbook', summary: 'Import a confirmed mapping as a new DRAFT with cell provenance', params: [idParam()], body: { type: 'object', required: ['mapping', 'baseVersionId'], properties: { mapping: { type: 'object' }, baseVersionId: { type: 'string' }, label: { type: 'string' }, effectiveFrom: { type: 'string', format: 'date' }, changeTicket: { type: 'object' } } }, status: 201, errors: { 422: err('Import blocked; issues listed in error.details') }, roles: 'pricing_analyst, admin' });

// -------- test tooling, feedback, audit, admin
op('get', '/test-tools/scenario-sets/{productId}', { tag: 'Pilot test tooling', id: 'scenarioSet', summary: 'The pilot\'s synthetic scenario set for a product (not RateGuard assurance)', params: [idParam('productId')] });
op('post', '/test-tools/compare', { tag: 'Pilot test tooling', id: 'compareConfigs', summary: 'Compare a baseline and candidate configuration over the scenario set (same pilot engine on both sides)', body: { type: 'object', required: ['productId', 'candidate'], properties: { productId: { type: 'string' }, baseline: { type: 'object' }, candidate: { type: 'object', properties: { national: { type: 'string' }, state: { type: 'string' } } }, states: { type: 'array', items: { type: 'string' } }, expectedChangePct: { type: 'number' }, tolerancePct: { type: 'number' } } } });
op('get', '/test-tools/runs', { tag: 'Pilot test tooling', id: 'listRuns', summary: 'Previous scenario runs' });
op('get', '/test-tools/runs/{id}', { tag: 'Pilot test tooling', id: 'getRun', summary: 'One scenario run with per-scenario rows', params: [idParam()] });
op('get', '/feedback/types', { tag: 'Feedback', id: 'feedbackTypes', summary: 'Feedback types' });
op('get', '/feedback/hints', { tag: 'Feedback', id: 'feedbackHints', summary: 'Active, reviewed mapping hints for a product', params: [q('productId', '')] });
op('get', '/feedback', { tag: 'Feedback', id: 'listFeedback', summary: 'Feedback items', params: [q('productId', ''), q('type', ''), q('status', '')] });
op('post', '/feedback', { tag: 'Feedback', id: 'createFeedback', summary: 'Submit scoped feedback (never alters rates or results)', body: { type: 'object', required: ['type', 'productId'], properties: { type: { type: 'string' }, productId: { type: 'string' }, versionId: { type: 'string' }, comment: { type: 'string' }, payload: { type: 'object' } } }, status: 201 });
op('post', '/feedback/{id}/review', { tag: 'Feedback', id: 'reviewFeedback', summary: 'Accept/reject feedback (not your own)', params: [idParam()], body: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['accept', 'reject'] }, comment: { type: 'string' } } }, roles: 'pricing_approver, admin' });
op('get', '/audit', { tag: 'Audit', id: 'listAudit', summary: 'Audit entries (hash-chained)', params: [q('entityType', ''), q('entityId', ''), q('action', ''), q('limit', '', { type: 'integer' })], roles: PRICING });
op('get', '/audit/verify', { tag: 'Audit', id: 'verifyAudit', summary: 'Verify the audit hash chain', roles: PRICING });
op('post', '/admin/reset', { tag: 'Admin', id: 'resetData', summary: 'Wipe and re-seed local synthetic data', body: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'string', enum: ['RESET'] } } }, roles: 'admin' });

const doc = {
  openapi: '3.0.3',
  info: {
    title: 'Pilot Quote Site API (synthetic)', version: '1.0.0',
    description: [
      'Synthetic insurance rating and quoting pilot. Every premium is an invented, illustrative number: NOT an offer, binder, policy or coverage.',
      'This pilot is a standalone test target. It is NOT integrated with RateGuard Enhanced, and RateGuard v3 does not exist yet; this document describes the boundary a future integration could use.',
      'Business outcomes are HTTP 200 with a `status`; transport/contract problems use 4xx. Authentication: `Authorization: Bearer <token>` from `POST /auth/login` (demo) or a Firebase ID token (cloud mode).',
    ].join('\n\n'),
  },
  servers: [{ url: '/api/v1', description: 'Relative to the pilot host (local default http://localhost:3000)' }],
  security: [{ bearerAuth: [] }],
  tags: ['Meta', 'Auth', 'Discovery', 'Quotes', 'Validation', 'Workbench', 'XLSX', 'Submissions', 'Pilot test tooling', 'Feedback', 'Audit', 'Admin'].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: {
      ApiError: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } },
      QuoteRequest: {
        type: 'object', required: ['productId', 'state', 'effectiveDate'],
        properties: {
          scenarioId: { type: 'string', description: 'Echoed back; generated if absent', example: 'HO-AZ-roof21' },
          productId: { type: 'string', enum: ['personal-auto', 'homeowners', 'commercial-property', 'bop'] },
          state: { type: 'string', enum: ['AZ', 'CA', 'FL', 'GA', 'IL', 'NY', 'NC', 'OR', 'TX', 'WA'] },
          transactionType: { type: 'string', enum: ['NEW_BUSINESS', 'RENEWAL', 'ENDORSEMENT'], default: 'NEW_BUSINESS' },
          effectiveDate: { type: 'string', format: 'date', description: 'Transaction effective date; selects product/rating versions (for ENDORSEMENT versions come from policyEffectiveDate)' },
          policyEffectiveDate: { type: 'string', format: 'date' },
          risk: { type: 'object', description: 'See GET /products/{id}/schema → jsonSchema.properties.risk', additionalProperties: true },
          coverages: { type: 'object', description: 'See jsonSchema.properties.coverages', additionalProperties: true },
          endorsement: { type: 'object', properties: { priorRisk: { type: 'object' }, priorCoverages: { type: 'object' } } },
          priorTermPremium: { type: 'number', description: 'RENEWAL only: enables the renewal rate-change cap' },
          ratingVersionIds: { type: 'object', description: 'Pin versions (including drafts). pricing/API roles only. `state: null` disables the state override.', properties: { national: { type: 'string' }, state: { type: 'string', nullable: true } } },
          productVersionId: { type: 'string' },
          options: { type: 'object', properties: { trace: { type: 'boolean', default: true } } },
        },
      },
      QuoteResult: {
        type: 'object',
        properties: {
          scenarioId: { type: 'string' }, quoteId: { type: 'string', description: 'Only when persisted' },
          status: { type: 'string', enum: ['QUOTED', 'REFERRED', 'DECLINED', 'INFO_REQUIRED', 'INVALID', 'RATING_ERROR'] },
          productId: { type: 'string' }, lineOfBusiness: { type: 'string', enum: ['PERSONAL_AUTO', 'HOMEOWNERS', 'COMMERCIAL_PROPERTY', 'BOP'] }, state: { type: 'string' },
          transactionType: { type: 'string' }, effectiveDate: { type: 'string' }, ratingDate: { type: 'string', description: 'Date used to select versions' },
          risk: { type: 'object' }, coverages: { type: 'object' },
          versions: { type: 'object', description: 'product + rating[] {id, scope, versionNumber, status, effectiveFrom, contentHash}, effectiveConfigHash, pinned, containsUnapprovedVersion' },
          validation: { type: 'object', properties: { valid: { type: 'boolean' }, errors: { type: 'array', items: ref('ValidationError') }, warnings: { type: 'array', items: { type: 'object' } } } },
          eligibility: { type: 'object', properties: { decision: { type: 'string', enum: ['ELIGIBLE', 'REFER', 'DECLINE', 'INFO_REQUIRED'] }, reasons: { type: 'array', items: { type: 'object', properties: { ruleId: { type: 'string' }, kind: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' }, origin: { type: 'string' } } } } } },
          premium: { type: 'object', description: 'Present only when QUOTED', properties: { currency: { type: 'string' }, termMonths: { type: 'integer' }, total: { type: 'number' }, subtotal: { type: 'number' }, components: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, group: { type: 'string', nullable: true }, coverage: { type: 'string', nullable: true }, tags: { type: 'array', items: { type: 'string' } }, amountBeforeModifiers: { type: 'number' }, amount: { type: 'number' } } } }, modifiers: { type: 'array', items: { type: 'object' } }, fees: { type: 'array', items: { type: 'object' } }, adjustments: { type: 'array', items: { type: 'object' } }, paymentPlans: { type: 'array', items: { type: 'object' } } } },
          endorsement: { type: 'object', description: 'ENDORSEMENT only: prior/new premium and pro-rata change' },
          trace: { type: 'array', items: { type: 'object' }, description: 'Ordered step-by-step safe trace (tables matched, factors, components, modifiers)' },
          appliedConfig: { type: 'object', description: 'Tables used (with the version that supplied each), steps run, rules evaluated, engine info' },
          resultHash: { type: 'string', description: 'Deterministic hash of the outcome + versions (excludes ids/timestamps)' },
          disclaimer: { type: 'string' },
        },
      },
      BatchRequest: { type: 'object', required: ['scenarios'], properties: { defaults: { type: 'object', description: 'Merged under every scenario' }, scenarios: { type: 'array', maxItems: 200, items: ref('QuoteRequest') }, options: { type: 'object', properties: { trace: { type: 'boolean', default: false } } } } },
      BatchResult: { type: 'object', properties: { batchId: { type: 'string' }, count: { type: 'integer' }, summary: { type: 'object', additionalProperties: { type: 'integer' } }, results: { type: 'array', items: { oneOf: [ref('QuoteResult'), { type: 'object', description: 'status REQUEST_ERROR for a malformed item' }] } } } },
      ValidationError: { type: 'object', properties: { path: { type: 'string', example: 'risk.vehicles[0].year' }, code: { type: 'string', enum: ['REQUIRED', 'TYPE', 'RANGE', 'ENUM', 'FORMAT', 'ZIP_STATE', 'CROSS_FIELD', 'UNKNOWN_FIELD', 'MIN_ITEMS', 'MAX_ITEMS', 'UNSUPPORTED_STATE', 'STATE_MISMATCH'] }, message: { type: 'string' } } },
      ValidationReport: { type: 'object', properties: { valid: { type: 'boolean' }, errors: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, path: { type: 'string' }, message: { type: 'string' } } } }, warnings: { type: 'array', items: { type: 'object' } }, info: { type: 'array', items: { type: 'object' } }, smoke: { type: 'object' }, impact: { type: 'object', nullable: true } } },
      RatingVersionSummary: { type: 'object', properties: { id: { type: 'string', example: 'HO-FL-v1' }, productId: { type: 'string' }, scope: { type: 'object' }, versionNumber: { type: 'integer' }, label: { type: 'string' }, effectiveFrom: { type: 'string' }, effectiveTo: { type: 'string', nullable: true }, status: { type: 'string' }, effectiveState: { type: 'string', nullable: true, enum: ['scheduled', 'in_effect', 'superseded', 'expired', null] }, contentHash: { type: 'string' }, createdBy: { type: 'string' }, approvedBy: { type: 'string' }, basedOn: { type: 'string', nullable: true }, demo: { type: 'object', nullable: true } } },
      ProductSchema: { type: 'object', properties: { productId: { type: 'string' }, lineOfBusiness: { type: 'string' }, productVersion: { type: 'object' }, states: { type: 'array', items: { type: 'string' } }, sections: { type: 'array', items: { type: 'object' } }, jsonSchema: { type: 'object' }, requestEnvelope: { type: 'object' } } },
    },
  },
};

fs.writeFileSync(path.join(root, 'docs', 'openapi.json'), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote docs/openapi.json (${Object.keys(paths).length} paths)`);
