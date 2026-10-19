import { clone } from './util.js';

/**
 * Combine a national/base content block with an optional state override block.
 * State override block shape (all keys optional):
 *   params:{k:v}                      replace/add parameters
 *   tables:{NAME:table}               replace/add whole tables by name
 *   rules:[rule]                      replace by id, or add
 *   removeRules:[id]                  drop national rules
 *   stepOverrides:{stepId:step|null}  replace (or remove with null) a step anywhere in derive/plan
 *   additionalSteps:[{after:stepId|"__end__", section:"plan"|"derive", step}]
 *   limits:{...}                      shallow-merged over national limits
 *   paymentPlans:[...]                replaces national list when present
 * Returns {content, origins} where origins maps each item to the version id that supplied it.
 */
export function mergeContent(national, nationalId, override, overrideId) {
  const content = clone(national);
  const origins = { params: {}, tables: {}, rules: {}, steps: {}, limits: nationalId };
  for (const k of Object.keys(content.params || {})) origins.params[k] = nationalId;
  for (const k of Object.keys(content.tables || {})) origins.tables[k] = nationalId;
  for (const r of content.rules || []) origins.rules[r.id] = nationalId;
  walkSteps(content.derive || [], (s) => { origins.steps[s.id] = nationalId; });
  walkSteps(content.plan || [], (s) => { origins.steps[s.id] = nationalId; });
  if (!override) return { content, origins };

  const o = clone(override);
  for (const [k, v] of Object.entries(o.params || {})) { content.params ||= {}; content.params[k] = v; origins.params[k] = overrideId; }
  for (const [k, v] of Object.entries(o.tables || {})) { content.tables ||= {}; content.tables[k] = v; origins.tables[k] = overrideId; }
  if (o.removeRules?.length) {
    content.rules = (content.rules || []).filter((r) => !o.removeRules.includes(r.id));
    for (const id of o.removeRules) delete origins.rules[id];
  }
  for (const r of o.rules || []) {
    content.rules ||= [];
    const i = content.rules.findIndex((x) => x.id === r.id);
    if (i >= 0) content.rules[i] = r; else content.rules.push(r);
    origins.rules[r.id] = overrideId;
  }
  for (const [id, step] of Object.entries(o.stepOverrides || {})) {
    for (const section of ['derive', 'plan']) {
      content[section] = replaceStep(content[section] || [], id, step, (s) => { origins.steps[s.id] = overrideId; });
    }
    if (step === null) delete origins.steps[id];
  }
  for (const add of o.additionalSteps || []) {
    const section = add.section || 'plan';
    content[section] ||= [];
    const inserted = insertAfter(content[section], add.after, add.step);
    if (!inserted) content[section].push(add.step);
    walkSteps([add.step], (s) => { origins.steps[s.id] = overrideId; });
  }
  if (o.limits) { content.limits = { ...(content.limits || {}), ...o.limits }; origins.limits = `${nationalId}+${overrideId}`; }
  if (o.paymentPlans) content.paymentPlans = o.paymentPlans;
  return { content, origins };
}

export function walkSteps(steps, fn) {
  for (const s of steps || []) { fn(s); if (s.op === 'foreach') walkSteps(s.steps, fn); }
}

function replaceStep(steps, id, replacement, onNew) {
  const out = [];
  for (const s of steps) {
    if (s.id === id) { if (replacement !== null) { out.push(replacement); onNew(replacement); } continue; }
    if (s.op === 'foreach') out.push({ ...s, steps: replaceStep(s.steps || [], id, replacement, onNew) });
    else out.push(s);
  }
  return out;
}

function insertAfter(steps, afterId, step) {
  if (afterId === '__end__' || afterId == null) { steps.push(step); return true; }
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].id === afterId) { steps.splice(i + 1, 0, step); return true; }
    if (steps[i].op === 'foreach' && insertAfter(steps[i].steps, afterId, step)) return true;
  }
  return false;
}
