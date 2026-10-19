// Shared renderers for validation reports and configuration diffs.
import { h } from '../../lib/dom.js';
import { money, pct } from '../../lib/format.js';
import { exprStr, stepSummary } from '../../lib/exprstr.js';

export function renderReport(report) {
  const list = (items, kind, title) => (items?.length ? h('div', { class: `notice ${kind}` }, h('strong', null, `${title} (${items.length})`), h('ul', null, items.map((i) => h('li', null, h('span', { class: 'badge', style: { marginRight: '.4rem' } }, i.code), i.message)))) : null);
  const out = h('div');
  out.append(h('div', { class: `notice ${report.valid ? 'ok' : 'bad'}`, role: 'status' }, h('strong', null, report.valid ? 'Validation passed' : 'Validation failed'), report.valid ? ' — structure, references, ranges, completeness and the smoke run are clean.' : ` — ${report.errors.length} error(s) must be fixed before this can be submitted.`));
  out.append(list(report.errors, 'bad', 'Errors'), list(report.warnings, 'warn', 'Warnings'), list(report.info, 'info', 'Information'));
  if (report.smoke) out.append(h('div', { class: 'grid grid-4', style: { marginBottom: '1rem' } },
    stat(`${report.smoke.quoted}/${report.smoke.scenarios}`, 'smoke scenarios quoted'), stat(report.smoke.failed, 'rating failures'), stat(report.smoke.statusChanged ?? 0, 'scenarios whose outcome changed'),
    stat(report.smoke.minPremium != null ? `${money(report.smoke.minPremium)} – ${money(report.smoke.maxPremium)}` : '—', 'premium range')));
  if (report.impact) {
    const im = report.impact;
    out.append(h('div', { class: 'card' }, h('h4', null, 'Impact versus the version this replaces (pilot smoke scenarios)'),
      h('div', { class: 'grid grid-4' }, stat(`${im.changed}/${im.compared}`, 'scenarios changed'), stat(pct(im.averagePct), 'average change'), stat(`${im.maxAbsPct}%`, 'largest |change|'), stat(im.largest?.[0]?.scenarioId?.split(':').slice(1).join(' ') ?? '—', 'most affected')),
      im.largest?.length ? h('table', { class: 't', style: { marginTop: '.6rem' } }, h('thead', null, h('tr', null, ['Scenario', 'Before', 'After', 'Change'].map((c) => h('th', { class: c === 'Scenario' ? '' : 'num' }, c)))),
        h('tbody', null, im.largest.map((r) => h('tr', null, h('td', null, r.scenarioId), h('td', { class: 'num' }, money(r.before)), h('td', { class: 'num' }, money(r.after)), h('td', { class: 'num' }, pct(r.pct)))))) : null));
  }
  out.append(h('p', { class: 'small muted' }, 'Validation is the pilot\'s own gate: it catches structure, references, range gaps/overlaps, plausible-bounds and completeness problems and runs smoke scenarios. It cannot prove a plausible number is the intended number.'));
  return out;
}
const stat = (value, label) => h('div', { class: 'stat' }, h('b', null, String(value)), h('span', null, label));
export { stat };

export function renderDiff(d) {
  const out = h('div');
  const s = d.summary;
  out.append(h('div', { class: 'grid grid-4', style: { marginBottom: '1rem' } }, stat(s.total, 'changes'), stat(s.changed, 'changed'), stat(s.added, 'added'), stat(s.removed, 'removed')));
  if (d.meta?.length) out.append(h('div', { class: 'card' }, h('h4', null, 'Metadata'), d.meta.map((m) => h('div', { class: 'diff-row' }, h('span', { class: 'badge' }, 'meta'), h('span', null, m.path), h('span', null, `${m.before ?? '—'} → ${m.after ?? '—'}`)))));
  if (!d.changes.length) { out.append(h('div', { class: 'notice ok' }, 'No content differences.')); return out; }
  const groups = { param: 'Parameters', table: 'Tables', 'table-row': 'Rate table values', rule: 'Eligibility / referral rules', step: 'Calculation steps', limits: 'Limits, rounding, payment plans' };
  for (const [area, title] of Object.entries(groups)) {
    const items = d.changes.filter((c) => c.area === area);
    if (!items.length) continue;
    out.append(h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h4', { style: { margin: 0 } }, `${title} (${items.length})`)),
      h('div', { class: 'card-body', style: { padding: '.4rem 1.2rem' } }, items.slice(0, 400).map((c) => h('div', { class: 'diff-row' },
        h('span', { class: `badge ${c.kind === 'added' ? 'ok' : c.kind === 'removed' ? 'bad' : 'warn'}` }, c.kind),
        h('span', null, h('strong', null, c.path), c.key ? h('span', { class: 'muted' }, `  ${c.key}`) : null, c.note ? h('span', { class: 'muted' }, `  (${c.note})`) : null),
        h('span', { class: 'mono' }, valueText(c)))))));
  }
  return out;
}

function valueText(c) {
  const fmt = (x) => (x === undefined ? '—' : typeof x === 'object' && x !== null ? (x.op ? stepSummary(x) : x.when ? exprStr(x.when) : JSON.stringify(x).slice(0, 90)) : String(x));
  if (c.kind === 'added') return `+ ${fmt(c.after)}`;
  if (c.kind === 'removed') return `− ${fmt(c.before)}`;
  return `${fmt(c.before)} → ${fmt(c.after)}${typeof c.pct === 'number' ? `  (${pct(c.pct)})` : ''}`;
}
