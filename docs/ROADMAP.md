# Roadmap, status and session-resume plan

## Status against the brief (as of this build)

| Area | Status |
| --- | --- |
| Four lines, distinct journeys, 10 demo states, validation + referral/decline/info outcomes | ✅ built and tested |
| Deterministic bounded rating engine, trace, components, version stamping | ✅ |
| National base + state overrides + effective dates (tested incl. future-dated, endorsement date rule, rollback fallback) | ✅ |
| Workbench: draft/validate/approve/promote/rollback, diff, audit chain, roles, four-eyes | ✅ |
| Editors: tables, parameters, calculation steps (JSON), rules (JSON), limits/payment plans | ✅ (steps/rules are JSON-edited, not drag-and-drop) |
| XLSX import/mapping/diff/provenance/safety for the documented profile + samples + templates | ✅ |
| Normal rate change + intentional defects (silent & structural) | ✅ |
| Single quote, batch, schema discovery, version discovery/resolution, draft validation, trace | ✅ OpenAPI + docs + tests |
| Saved submissions, renewal/endorsement scenarios, simulated bind | ✅ |
| Feedback workflow (reviewed, scoped, cannot change rates) | ✅ |
| Local run instructions, README, tests (64 backend + 15 UI) | ✅ |
| Cloud: Dockerfile, firebase.json, deny-all rules, deploy instructions | ✅ files/docs only — **nothing deployed** |
| Firestore/GCS adapters, Firebase token verification | ⚠️ skeletons, **untested** |
| RateGuard v3 integration | ❌ does not exist; contract documented only |
| Pub/Sub async batches, BigQuery analytics, Vertex assistance, portfolio impact | ❌ not built (not required yet) |

## Next steps (suggested order)

1. **Verify the cloud paths locally with emulators** — run the backend suite against `createFirestoreStore` with the Firestore emulator; add a Firestore transaction for audit-head/sequence counters; add a contract test for `AUTH_MODE=firebase` using the Auth emulator.
2. **Merged-view in the workbench** — show a state override *merged* with the national version in force (the API already merges), and diff merged-vs-merged across dates.
3. **More products and richer rating realism** — second product per line (e.g. HO-5, condo; hired-auto BOP), more state overrides, multi-location property schedules, ACV/coinsurance penalties, minimum earned premium, taxes/surcharges per state.
4. **Workbench UX** — structured step/rule editors with expression builders and live "test this step", row-level undo, bulk edit (scale a column by %), import of *state-override* workbooks (the importer already accepts a state version as base).
5. **Scenario authoring** — save custom scenario sets per product, import scenarios from XLSX/CSV, attach expected premiums *supplied by an external verifier* (never computed by the pilot).
6. **Async batch + portfolio synthetic data** (only if/when a verifier needs ≥ 200 scenarios): Pub/Sub worker, synthetic portfolio generator, optional BigQuery export.
7. **Optional bounded Vertex assistance** (mapping suggestions / ticket summary) behind a feature flag, outputs shown as unconfirmed suggestions and recorded as feedback.
8. **When RateGuard v3 exists:** run its contract tests against `/api/v1/openapi.json`, register the pilot as a connector, and add a `docs/INTEGRATION_RESULTS.md` — only then update the README's integration statements.

## Session-resume plan (for new sessions / cache expiry)

1. Open `CLAUDE.md` (repo root) — rules, commands, layout, invariants.
2. `npm install && npm test` (≈ 25 s) and optionally `npm run test:ui`. Everything must be green before changes.
3. Skim `docs/ARCHITECTURE.md` and the section of `docs/ROADMAP.md` for the item you pick.
4. Work in small steps; add/adjust tests with each change; keep `docs/openapi.json` in sync (`npm run openapi`; a test enforces it) and `samples/` in sync (`npm run samples`; a test enforces it).
5. Do **not** modify `../rateguard-enhanced`. Do **not** deploy or create cloud resources without explicit approval. Keep all data synthetic.
6. Before ending a session: update the status table above, keep README's "works / simulated / not built" truthful.

## Invariants worth protecting (tests exist for most)

- Rating is deterministic and has no dynamic-code execution path.
- Non-quoted outcomes never carry a premium; failures are never turned into passes.
- Approved/active versions are immutable; approvals obey four-eyes; every state change is audited and the chain verifies.
- Feedback never changes configuration or results.
- Every quote names the versions (IDs + hashes) it used.
- The pilot never claims integration with RateGuard Enhanced or the existence of RateGuard v3.
