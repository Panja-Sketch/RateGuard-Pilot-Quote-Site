// The pilot's own scenario runner ("pilot test tooling"). It compares two configurations of THIS
// pilot over a synthetic scenario set so a configuration owner can see the effect of a change.
// It is NOT RateGuard assurance and has no independent expected-premium model: both sides use the
// same pilot rating engine. A future RateGuard v3 would supply the independent expectation.
import { HttpError, isPlainObject } from '../engine/util.js';
import { scenarioSet } from '../seed/scenarios.js';
import { DEMO_STATES } from '../engine/geo.js';

const round2 = (x) => Math.round(x * 100) / 100;

export class TestToolsService {
  constructor(ctx) { this.ctx = ctx; }

  scenarioSet(productId, { states, variationStates } = {}) {
    return scenarioSet(productId, { states: states || DEMO_STATES, variationStates: variationStates || ['AZ', 'FL', 'NY'] });
  }

  /**
   * body: {productId, baseline:{national?,state?}, candidate:{national?,state?}, states?, variationStates?,
   *        expectedChangePct?, tolerancePct?, label?}
   * Omitted baseline pins mean "whatever is in force on the scenario date".
   */
  async compare(actor, body) {
    if (!isPlainObject(body) || typeof body.productId !== 'string') throw new HttpError(400, 'BAD_REQUEST', 'productId is required.');
    if (!isPlainObject(body.candidate) || (!body.candidate.national && !body.candidate.state)) throw new HttpError(400, 'BAD_REQUEST', 'candidate must pin a national and/or state version id.');
    const states = Array.isArray(body.states) && body.states.length ? body.states.filter((s) => DEMO_STATES.includes(s)) : DEMO_STATES;
    const variationStates = Array.isArray(body.variationStates) ? body.variationStates.filter((s) => DEMO_STATES.includes(s)) : ['AZ', 'FL', 'NY'];
    const scenarios = this.scenarioSet(body.productId, { states, variationStates });
    const expected = typeof body.expectedChangePct === 'number' ? body.expectedChangePct : null;
    const tol = typeof body.tolerancePct === 'number' ? body.tolerancePct : 1.5;
    const rows = [];
    for (const sc of scenarios) {
      // a state-pinned candidate only applies to scenarios in that state
      if (body.candidate.state) {
        const doc = await this.ctx.versions.mustGet(body.candidate.state);
        if (doc.scope?.state !== sc.state) continue;
      }
      const basePin = { ...(body.baseline || {}) };
      const a = await this.ctx.quotes.quote(actor, { ...sc, ratingVersionIds: Object.keys(basePin).length ? basePin : undefined, options: { trace: false } }, { allowPins: true });
      const candPin = { ...body.candidate };
      if (candPin.national && !('state' in candPin)) candPin.state = undefined; // keep date-resolved state override
      const b = await this.ctx.quotes.quote(actor, { ...sc, ratingVersionIds: cleanPin(candPin), options: { trace: false } }, { allowPins: true });
      const before = a.premium?.total ?? null; const after = b.premium?.total ?? null;
      const pct = before && after != null ? round2(((after - before) / before) * 100) : null;
      const row = { scenarioId: sc.scenarioId, state: sc.state, statusBefore: a.status, statusAfter: b.status, before, after, delta: before != null && after != null ? round2(after - before) : null, pct };
      if (a.premium && b.premium) row.componentChanges = topComponentChanges(a.premium, b.premium);
      row.flag = null;
      if (row.statusBefore !== row.statusAfter) row.flag = 'STATUS_CHANGED';
      else if (expected !== null && pct !== null && Math.abs(pct - expected) > tol) row.flag = 'OUTSIDE_EXPECTATION';
      rows.push(row);
    }
    const priced = rows.filter((r) => r.pct !== null);
    const summary = {
      scenarios: rows.length, changed: priced.filter((r) => Math.abs(r.pct) >= 0.005).length, unchanged: priced.filter((r) => Math.abs(r.pct) < 0.005).length,
      statusChanged: rows.filter((r) => r.flag === 'STATUS_CHANGED').length, outsideExpectation: rows.filter((r) => r.flag === 'OUTSIDE_EXPECTATION').length,
      averagePct: priced.length ? round2(priced.reduce((s, r) => s + r.pct, 0) / priced.length) : 0,
      maxPct: priced.length ? Math.max(...priced.map((r) => r.pct)) : 0, minPct: priced.length ? Math.min(...priced.map((r) => r.pct)) : 0,
      expectedChangePct: expected, tolerancePct: expected === null ? null : tol,
    };
    const seq = ((await this.ctx.store.get('meta', 'run-seq'))?.n ?? 0) + 1;
    await this.ctx.store.put('meta', { id: 'run-seq', n: seq });
    const run = {
      id: `RUN-${String(seq).padStart(4, '0')}`, productId: body.productId, label: (body.label || '').toString().slice(0, 100) || null, baseline: body.baseline || 'in-force', candidate: body.candidate,
      createdAt: this.ctx.clock().toISOString(), createdBy: actor.id, summary, rows,
      notice: 'Pilot test tooling: compares two configurations of this pilot with the same pilot engine. Not RateGuard assurance and not an independent expected-premium model.',
    };
    await this.ctx.store.put('scenarioRuns', run);
    await this.ctx.audit.record(actor, 'SCENARIO_RUN', { type: 'scenarioRun', id: run.id }, `Scenario run ${run.id}: ${summary.changed}/${summary.scenarios} scenarios changed (avg ${summary.averagePct}%)`, { candidate: body.candidate, summary });
    return run;
  }

  async getRun(id) {
    const r = await this.ctx.store.get('scenarioRuns', id);
    if (!r) throw new HttpError(404, 'NOT_FOUND', `Run ${id} was not found.`);
    return r;
  }

  async listRuns() {
    return (await this.ctx.store.list('scenarioRuns')).map(({ rows, ...rest }) => rest).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

function cleanPin(p) { const o = {}; for (const [k, v] of Object.entries(p)) if (v !== undefined) o[k] = v; return Object.keys(o).length ? o : undefined; }

function topComponentChanges(a, b) {
  const am = new Map(a.components.map((c) => [c.id, c.amount])); const bm = new Map(b.components.map((c) => [c.id, c.amount]));
  const ids = new Set([...am.keys(), ...bm.keys()]);
  return [...ids].map((id) => ({ id, before: am.get(id) ?? 0, after: bm.get(id) ?? 0, delta: round2((bm.get(id) ?? 0) - (am.get(id) ?? 0)) })).filter((x) => Math.abs(x.delta) >= 0.005).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3);
}
