// Validates a submission (risk + coverages) against a product-definition document.
// Strict by design: unknown fields are errors so API clients notice schema drift.
import { evalExpr, truthy, parseIsoDate } from '../../shared/expr.js';
import { zipMatchesState, STATE_INFO } from './geo.js';

const optValues = (f) => (f.options || []).map((o) => (typeof o === 'object' ? o.value : o));
const optLabel = (f, v) => { const o = (f.options || []).find((x) => (typeof x === 'object' ? x.value : x) === v); return o && typeof o === 'object' ? o.label : String(v); };

const isBlank = (v) => v === undefined || v === null || v === '';

/** Returns {valid, errors, warnings, normalized:{risk,cov}}. `state` is the request-level jurisdiction. */
export function validateInputs(product, { state, risk = {}, coverages = {} }, sys = {}) {
  const errors = [];
  const warnings = [];
  const err = (path, code, message) => errors.push({ path, code, message });

  if (!state || !product.states.includes(state)) {
    err('state', 'UNSUPPORTED_STATE', `State "${state ?? ''}" is not available for this product. Supported demo states: ${product.states.join(', ')}.`);
  }
  if (risk && risk.state !== undefined && risk.state !== state) err('risk.state', 'STATE_MISMATCH', `risk.state (${risk.state}) must equal the request state (${state}).`);

  const out = { risk: { state }, cov: {} };
  const known = { risk: new Set(['state']), coverages: new Set() };
  const roots = { risk, coverages };

  for (const section of product.sections) {
    const group = section.group === 'coverage' ? 'coverages' : 'risk';
    const target = group === 'coverages' ? out.cov : out.risk;
    const source = roots[group] || {};
    const rootName = group === 'coverages' ? 'cov' : 'risk';
    const scopeAll = () => ({ inputs: { risk: out.risk, cov: out.cov, sys }, vars: {}, params: {}, locals: {} });

    // register keys first so a client that still sends values for a hidden section is not told "unknown field"
    if (section.repeat) known[group].add(section.repeat.key); else for (const f of section.fields || []) known[group].add(f.key);
    if (section.showIf && !truthy(safeEval(section.showIf, scopeAll()))) continue;

    if (section.repeat) {
      const { key, min = 0, max = 99, itemLabel = 'Item' } = section.repeat;
      known[group].add(key);
      const arr = source[key];
      const path = `${group === 'coverages' ? 'coverages' : 'risk'}.${key}`;
      if (arr === undefined || arr === null) {
        if (min > 0) err(path, 'REQUIRED', `Add at least ${min} ${itemLabel.toLowerCase()}${min > 1 ? 's' : ''}.`);
        target[key] = [];
        continue;
      }
      if (!Array.isArray(arr)) { err(path, 'TYPE', `${key} must be a list.`); continue; }
      if (arr.length < min) err(path, 'MIN_ITEMS', `Add at least ${min} ${itemLabel.toLowerCase()}${min > 1 ? 's' : ''}.`);
      if (arr.length > max) err(path, 'MAX_ITEMS', `No more than ${max} ${itemLabel.toLowerCase()}s can be quoted online.`);
      target[key] = arr.slice(0, max).map((item, i) => validateItem(section.repeat.fields, item, `${path}[${i}]`, `${itemLabel} ${i + 1}`, { rootRisk: out.risk, rootCov: out.cov, sys }, state, err, warnings));
      // section-level checks run per item with {item}
      (section.checks || []).forEach((chk) => target[key].forEach((item, i) => {
        if (!truthy(safeEval(chk.check, { inputs: { risk: out.risk, cov: out.cov, sys }, vars: {}, params: {}, locals: { item, loop: { index: i, n: i + 1 } } }))) {
          err(`${path}[${i}].${chk.field || ''}`.replace(/\.$/, ''), 'CROSS_FIELD', `${itemLabel} ${i + 1}: ${chk.message}`);
        }
      }));
    } else {
      const fields = section.fields || [];
      const scope = { rootRisk: out.risk, rootCov: out.cov, sys };
      for (const f of fields) known[group].add(f.key);
      const item = validateItem(fields, source, rootName === 'cov' ? 'coverages' : 'risk', null, scope, state, err, warnings, (k, v) => { target[k] = v; }, rootName);
      Object.assign(target, item);
      (section.checks || []).forEach((chk) => {
        if (!truthy(safeEval(chk.check, { inputs: { risk: out.risk, cov: out.cov, sys }, vars: {}, params: {}, locals: {} }))) err(`${group === 'coverages' ? 'coverages' : 'risk'}.${chk.field || ''}`.replace(/\.$/, ''), 'CROSS_FIELD', chk.message);
      });
    }
  }

  for (const [group, obj] of [['risk', risk], ['coverages', coverages]]) {
    for (const k of Object.keys(obj || {})) if (!known[group].has(k)) err(`${group}.${k}`, 'UNKNOWN_FIELD', `"${k}" is not an input of this product version.`);
  }
  for (const chk of product.crossChecks || []) {
    if (!truthy(safeEval(chk.check, { inputs: { risk: out.risk, cov: out.cov, sys }, vars: {}, params: {}, locals: {} }))) err(chk.path || 'risk', 'CROSS_FIELD', chk.message);
  }
  return { valid: errors.length === 0, errors, warnings, normalized: out };
}

function safeEval(expr, scope) {
  try { return evalExpr(expr, scope); } catch { return undefined; }
}

function validateItem(fields, source, basePath, label, scope, state, err, warnings, assign, rootName = 'risk') {
  const result = {};
  const isRoot = !label;
  const known = new Set(fields.map((f) => f.key));
  if (source === null || typeof source !== 'object' || Array.isArray(source)) { err(basePath, 'TYPE', `${basePath} must be an object.`); return result; }
  if (!isRoot) for (const k of Object.keys(source)) if (!known.has(k)) err(`${basePath}.${k}`, 'UNKNOWN_FIELD', `"${k}" is not a field of this item.`);
  const prefix = label ? `${label}: ` : '';
  const visScope = () => ({
    inputs: { risk: scope.rootRisk, cov: scope.rootCov, sys: scope.sys }, vars: {}, params: {},
    locals: isRoot ? {} : { item: { ...source, ...result }, loop: {} },
  });
  for (const f of fields) {
    const path = isRoot ? `${basePath}.${f.key}` : `${basePath}.${f.key}`;
    // make already-validated root siblings visible to showIf/requiredIf
    if (isRoot) (rootName === 'cov' ? scope.rootCov : scope.rootRisk)[f.key] = result[f.key];
    if (f.showIf && !truthy(safeEval(f.showIf, visScope()))) continue;
    let v = source[f.key];
    if (isBlank(v)) {
      const required = f.required || (f.requiredIf && truthy(safeEval(f.requiredIf, visScope())));
      if (required) err(path, 'REQUIRED', `${prefix}${f.label} is required.`);
      else if (f.default !== undefined) { result[f.key] = f.default; if (isRoot) (rootName === 'cov' ? scope.rootCov : scope.rootRisk)[f.key] = f.default; }
      continue;
    }
    const checked = checkType(f, v, path, prefix, state, err);
    if (checked !== undefined) {
      result[f.key] = checked;
      if (isRoot) (rootName === 'cov' ? scope.rootCov : scope.rootRisk)[f.key] = checked;
    }
  }
  return result;
}

function checkType(f, v, path, prefix, state, err) {
  const name = `${prefix}${f.label}`;
  switch (f.type) {
    case 'string': case 'text': {
      if (typeof v !== 'string') { err(path, 'TYPE', `${name} must be text.`); return undefined; }
      if (f.maxLength && v.length > f.maxLength) { err(path, 'RANGE', `${name} must be ${f.maxLength} characters or fewer.`); return undefined; }
      if (f.pattern && !new RegExp(f.pattern).test(v)) { err(path, 'FORMAT', `${name} is not in the expected format${f.help ? ` (${f.help})` : ''}.`); return undefined; }
      return v.trim();
    }
    case 'integer': case 'number': case 'currency': {
      if (typeof v !== 'number' || !Number.isFinite(v)) { err(path, 'TYPE', `${name} must be a number.`); return undefined; }
      if (f.type === 'integer' && !Number.isInteger(v)) { err(path, 'TYPE', `${name} must be a whole number.`); return undefined; }
      if (f.min !== undefined && v < f.min) { err(path, 'RANGE', `${name} must be at least ${f.min}.`); return undefined; }
      if (f.max !== undefined && v > f.max) { err(path, 'RANGE', `${name} must be no more than ${f.max}.`); return undefined; }
      return v;
    }
    case 'boolean': {
      if (typeof v !== 'boolean') { err(path, 'TYPE', `${name} must be true or false.`); return undefined; }
      return v;
    }
    case 'date': {
      if (!parseIsoDate(v)) { err(path, 'FORMAT', `${name} must be a valid date (YYYY-MM-DD).`); return undefined; }
      if (f.min && v < f.min) { err(path, 'RANGE', `${name} must be on or after ${f.min}.`); return undefined; }
      if (f.max && v > f.max) { err(path, 'RANGE', `${name} must be on or before ${f.max}.`); return undefined; }
      return v;
    }
    case 'zip': {
      if (typeof v !== 'string' || !/^\d{5}$/.test(v)) { err(path, 'FORMAT', `${name} must be a 5-digit ZIP code.`); return undefined; }
      if (state && STATE_INFO[state] && !zipMatchesState(v, state)) { err(path, 'ZIP_STATE', `${name} ${v} is outside the ZIP ranges used for ${state} in this demo.`); return undefined; }
      return v;
    }
    case 'select': {
      const allowed = optValues(f);
      if (!allowed.includes(v)) { err(path, 'ENUM', `${name}: "${v}" is not an available choice. Choose one of: ${allowed.map((a) => optLabel(f, a)).join(', ')}.`); return undefined; }
      return v;
    }
    case 'multiselect': {
      const allowed = optValues(f);
      if (!Array.isArray(v) || v.some((x) => !allowed.includes(x))) { err(path, 'ENUM', `${name} contains an unavailable choice.`); return undefined; }
      return v;
    }
    default:
      err(path, 'SCHEMA', `${name} has unsupported type "${f.type}" in the product definition.`);
      return undefined;
  }
}

/** Build a flat list of {path,type,...} for discovery and for validating rating-config input references. */
export function schemaPaths(product) {
  const paths = new Map();
  paths.set('risk.state', { type: 'select', options: product.states });
  for (const s of product.sections) {
    const root = s.group === 'coverage' ? 'cov' : 'risk';
    if (s.repeat) {
      paths.set(`${root}.${s.repeat.key}`, { type: 'array' });
      for (const f of s.repeat.fields) paths.set(`${root}.${s.repeat.key}[].${f.key}`, { ...f, array: s.repeat.key });
    } else for (const f of s.fields || []) paths.set(`${root}.${f.key}`, f);
  }
  return paths;
}

/** JSON Schema (draft 2020-12) for the `risk` and `coverages` objects of a product version. */
export function toJsonSchema(product) {
  const prim = (f) => {
    const s = { title: f.label };
    if (f.help) s.description = f.help;
    switch (f.type) {
      case 'string': case 'text': s.type = 'string'; if (f.maxLength) s.maxLength = f.maxLength; break;
      case 'integer': s.type = 'integer'; break;
      case 'number': case 'currency': s.type = 'number'; break;
      case 'boolean': s.type = 'boolean'; break;
      case 'date': s.type = 'string'; s.format = 'date'; break;
      case 'zip': s.type = 'string'; s.pattern = '^\d{5}$'; break;
      case 'select': s.enum = optValues(f); break;
      case 'multiselect': s.type = 'array'; s.items = { enum: optValues(f) }; break;
      default: break;
    }
    if (f.min !== undefined) s.minimum = f.min;
    if (f.max !== undefined) s.maximum = f.max;
    if (f.default !== undefined) s.default = f.default;
    if (f.showIf) s['x-showIf'] = f.showIf;
    if (f.requiredIf) s['x-requiredIf'] = f.requiredIf;
    return s;
  };
  const objectFor = (fields) => ({
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries(fields.map((f) => [f.key, prim(f)])),
    required: fields.filter((f) => f.required && !f.showIf && !f.requiredIf).map((f) => f.key),
  });
  const groups = { risk: { type: 'object', additionalProperties: false, properties: {}, required: [] }, coverages: { type: 'object', additionalProperties: false, properties: {}, required: [] } };
  for (const s of product.sections) {
    const g = groups[s.group === 'coverage' ? 'coverages' : 'risk'];
    if (s.repeat) {
      g.properties[s.repeat.key] = { type: 'array', title: s.title, minItems: s.repeat.min ?? 0, maxItems: s.repeat.max ?? 99, items: objectFor(s.repeat.fields) };
      if ((s.repeat.min ?? 0) > 0) g.required.push(s.repeat.key);
    } else {
      const o = objectFor(s.fields || []);
      Object.assign(g.properties, o.properties);
      g.required.push(...o.required);
    }
  }
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Pilot quote inputs (synthetic)', type: 'object', properties: { risk: groups.risk, coverages: groups.coverages }, required: ['risk', 'coverages'], 'x-note': 'Conditional visibility and requiredness (x-showIf / x-requiredIf), cross-field checks and eligibility rules are enforced by the server; this schema describes shape only.' };
}
