// Seeds the store with synthetic products, versioned configuration and demo drafts.
import { PRODUCTS, PRODUCT_CONTENT } from './products.js';
import { paNational, paStateOverrides } from './rating-pa.js';
import { hoNational, hoStateOverrides } from './rating-ho.js';
import { cpNational, cpStateOverrides } from './rating-cp.js';
import { bopNational, bopStateOverrides } from './rating-bop.js';
import { applyRateChange, applySilentDefect, applyStructuralDefect, RATE_CHANGE_NOTE } from './defects.js';
import { DEMO_STATES } from '../engine/geo.js';
import { hashOf } from '../engine/util.js';
import { ABBR } from '../services/versions.js';

const NATIONAL = { 'personal-auto': paNational, homeowners: hoNational, 'commercial-property': cpNational, bop: bopNational };
const OVERRIDES = { 'personal-auto': paStateOverrides, homeowners: () => hoStateOverrides(), 'commercial-property': () => cpStateOverrides(), bop: () => bopStateOverrides() };

const SEED_ACTORS = { creator: { id: 'analyst.demo', role: 'pricing_analyst' }, approver: { id: 'approver.demo', role: 'pricing_approver' }, system: { id: 'system', role: 'system' } };

function activeDoc({ id, kind = 'rating', productId, lob, scope, versionNumber, label, effectiveFrom, content, basedOn = null, createdAt, ticket = null }) {
  const approvedAt = createdAt.replace('T09', 'T15');
  const hash = hashOf(content);
  return {
    id, kind, productId, lob, scope, versionNumber, label, effectiveFrom, effectiveTo: null, status: 'active', content, contentHash: hash, basedOn, changeTicket: ticket,
    source: { type: 'seed', note: 'Synthetic seed data' }, provenance: null, demo: null, frozen: true,
    createdAt, createdBy: SEED_ACTORS.creator.id, updatedAt: approvedAt, updatedBy: SEED_ACTORS.approver.id,
    validation: { at: createdAt, by: SEED_ACTORS.creator.id, valid: true, contentHash: hash, errors: 0, warnings: 0 },
    submittedBy: SEED_ACTORS.creator.id, submittedAt: createdAt, approvedBy: SEED_ACTORS.approver.id, approvedAt, promotedBy: SEED_ACTORS.approver.id, promotedAt: approvedAt,
    transitions: [
      { status: 'draft', by: SEED_ACTORS.creator.id, role: 'pricing_analyst', at: createdAt, note: 'seeded' },
      { status: 'pending_approval', by: SEED_ACTORS.creator.id, role: 'pricing_analyst', at: createdAt, note: 'seeded' },
      { status: 'approved', by: SEED_ACTORS.approver.id, role: 'pricing_approver', at: approvedAt, note: 'seeded' },
      { status: 'active', by: SEED_ACTORS.approver.id, role: 'pricing_approver', at: approvedAt, note: 'seeded' },
    ],
  };
}

export async function seedAll({ store, versions, audit, clock }) {
  const now = clock().toISOString();
  for (const p of PRODUCTS) {
    await store.put('products', { id: p.id, lob: p.lob, name: p.name, tagline: p.tagline, icon: p.icon, states: DEMO_STATES, synthetic: true });
  }
  await audit.record(SEED_ACTORS.system, 'SEED_STARTED', { type: 'system', id: 'seed' }, 'Seeding synthetic products and configuration', {});

  for (const p of PRODUCTS) {
    const abbr = ABBR[p.id];
    const base = { productId: p.id, lob: p.lob };
    // product definition v1
    await versions.insertSeed(activeDoc({ ...base, id: `${abbr}-PROD-v1`, kind: 'product', scope: { level: 'product' }, versionNumber: 1, label: 'Initial synthetic product definition', effectiveFrom: '2025-01-01', content: PRODUCT_CONTENT[p.id], createdAt: '2025-01-02T09:00:00.000Z' }));
    // national v1 and v2
    const nat1 = NATIONAL[p.id](1); const nat2 = NATIONAL[p.id](2);
    await versions.insertSeed(activeDoc({ ...base, id: `${abbr}-NAT-v1`, scope: { level: 'national' }, versionNumber: 1, label: '2025 national base rates (synthetic)', effectiveFrom: '2025-01-01', content: nat1, createdAt: '2025-01-02T09:00:00.000Z', ticket: { reference: `SYN-${abbr}-001`, text: 'Synthetic initial national rate book.' } }));
    await versions.insertSeed(activeDoc({ ...base, id: `${abbr}-NAT-v2`, scope: { level: 'national' }, versionNumber: 2, label: 'July 2026 national rate revision (synthetic)', effectiveFrom: '2026-07-01', content: nat2, basedOn: `${abbr}-NAT-v1`, createdAt: '2026-06-15T09:00:00.000Z', ticket: { reference: `SYN-${abbr}-014`, text: 'Synthetic mid-year base-rate revision.' } }));
    // state overrides
    for (const o of OVERRIDES[p.id](nat2)) {
      await versions.insertSeed(activeDoc({ ...base, id: `${abbr}-${o.state}-v${o.seq}`, scope: { level: 'state', state: o.state }, versionNumber: o.seq, label: o.label, effectiveFrom: o.effectiveFrom, content: o.content, basedOn: o.seq > 1 ? `${abbr}-${o.state}-v${o.seq - 1}` : null, createdAt: o.effectiveFrom > '2026-12-31' ? '2026-09-01T09:00:00.000Z' : '2025-01-02T09:00:00.000Z' }));
    }
    // demo drafts (created through the normal draft path so they appear in the audit trail)
    const analyst = SEED_ACTORS.creator;
    const rc = await versions.createDraft(analyst, { productId: p.id, scope: { level: 'national' }, fromVersionId: `${abbr}-NAT-v2`, label: 'DEMO – normal rate change: base rates +4.0%', effectiveFrom: '2026-12-01', changeTicket: { reference: `SYN-${abbr}-RC1`, text: `Synthetic ticket: ${RATE_CHANGE_NOTE[p.id]}, effective 2026-12-01. Expected: every quoted premium moves by about +4% of its base-rated components; nothing else changes.` }, demo: { kind: 'rate_change', description: 'A normal, intended rate change. Validates cleanly.' }, content: applyRateChange(p.id, nat2, 4) });
    const sd = applySilentDefect(p.id, nat2);
    await versions.createDraft(analyst, { productId: p.id, scope: { level: 'national' }, fromVersionId: `${abbr}-NAT-v2`, label: 'DEMO – intentional silent defect (passes structural validation)', effectiveFrom: '2026-12-01', changeTicket: { reference: `SYN-${abbr}-DEF1`, text: 'Synthetic ticket claims: "no pricing change intended; only refactoring tables". The candidate actually contains a mis-keyed value.' }, demo: { kind: 'defect_silent', description: `Hidden defect: ${sd.note.change}. Structurally valid, so the pilot's own validation cannot prove it wrong; an independent expectation is needed.`, defect: sd.note }, content: sd.content });
    const st = applyStructuralDefect(p.id, nat2);
    await versions.createDraft(analyst, { productId: p.id, scope: { level: 'national' }, fromVersionId: `${abbr}-NAT-v2`, label: 'DEMO – intentional structural defects (fails validation)', effectiveFrom: '2026-12-01', changeTicket: { reference: `SYN-${abbr}-DEF2`, text: 'Synthetic ticket: table clean-up.' }, demo: { kind: 'defect_structural', description: `Defects the pilot validation should catch: ${st.notes.join('; ')}.`, defect: { notes: st.notes } }, content: st.content });
  }
  await audit.record(SEED_ACTORS.system, 'SEED_COMPLETED', { type: 'system', id: 'seed' }, 'Seed completed', { at: now });
}
