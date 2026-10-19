# Pilot Quote Site (synthetic)

A realistic, configurable, end-to-end **synthetic** insurance quoting and rating site, built as a **test target** for a future independent rating-assurance tool.

It takes a user's chosen line of business and risk details, applies versioned, state-aware, effective-dated rating configuration, and returns a deterministic **illustrative** quote with a premium breakdown, a safe rating trace and the exact configuration versions used. A pricing workbench lets you inspect, edit, validate, approve, promote and roll back that configuration, including importing rate tables from a documented XLSX profile.

> **Everything here is synthetic.** Rates, rules, people, addresses and businesses are invented. A quote is an illustration — **not an offer, binder, policy or coverage**. Bind is **simulated** and never creates coverage.

> **Separation from RateGuard.** This pilot is a standalone repository. It is **not integrated** with RateGuard Enhanced (the separate, current product), and **RateGuard v3 does not exist yet** — it has not been implemented. The pilot only exposes a clean, documented API boundary ([docs/INTEGRATION_CONTRACT.md](docs/INTEGRATION_CONTRACT.md)) that a future RateGuard v3 *could* call. Nothing in this repository performs RateGuard's independent assurance analysis. The `rateguard-enhanced` repository was inspected read-only for stack conventions and was not modified.

## Quick start

Requirements: **Node.js 20+** (developed on Node 24), npm. No cloud account, no Docker, no database needed.

```bash
cd RateGuard-Pilot-Quote-Site
npm install
npm start                 # http://localhost:3000
```

On first start the app seeds synthetic products, configuration versions and a few saved submissions into `./data/` (git-ignored). Reset any time with `npm run seed:reset` (or stop the server and delete `./data`).

### Demo sign-in

| Username | Role | What it can do |
| --- | --- | --- |
| `agent.demo` | agent | Quote, save/retrieve submissions, simulate bind, renewal/endorsement scenarios |
| `analyst.demo` | pricing_analyst | Everything above + edit drafts, import XLSX, validate, submit for approval, run scenarios |
| `approver.demo` | pricing_approver | Approve/reject, promote, roll back, review feedback (cannot approve what they created/submitted) |
| `admin.demo` | admin | All permissions (the four-eyes rule still applies) |
| `rateguard.client` | api_client | API-only: quote, batch, discovery, validate drafts, scenario runner (no UI workbench) |

Password for the four human demo users: **`pilot-demo-2026`**. Password for `rateguard.client`: **`pilot-api-demo-2026`**.
These are public, synthetic demo credentials for local use only. Override with `PILOT_DEMO_PASSWORD` / `PILOT_API_CLIENT_PASSWORD` (see [.env.example](.env.example)).

## A 10-minute tour

1. **Quote each line.** Sign in as `agent.demo` → *New quote* → pick Personal Auto, Homeowners, Commercial Property or BOP. Each has its own schema-driven journey (drivers & vehicles; roof & protection; construction & values; class, revenue & liability). Finish with *Get quote*. Open *Why this price*, *Rating trace* and *Versions & configuration*.
2. **See eligibility outcomes.** Open the seeded TX homeowners submission (older asphalt roof → **referral**), or add an SR-22 driver in Personal Auto. Coastal FL homeowners with a flat wind deductible → **more information required**.
3. **Effective dates & state overrides.** In the workbench (*analyst*) use *Which versions apply?* to resolve FL vs GA on different dates. `PA-CA-v2` is future-dated (2027-01-01).
4. **A normal rate change.** Open `HO-NAT-v3` (demo: +4% base rates) → *Validate* → *Run scenarios…* with expected change `4` → everything moves ≈ +4%. Submit as analyst; approve + promote as `approver.demo`; quote on/after the effective date and see the new version ID on the quote.
5. **An intentional defect.** Open `HO-NAT-v4` (silent defect: roof age ≥ 21 factor 1.35 → 1.25). It **passes** the pilot's structural validation. *Run scenarios…* with expected change `0` flags exactly the roof-age scenarios. `HO-NAT-v5` (structural defects) **fails** validation with specific messages (range gap, out-of-bounds factor, incomplete table).
6. **XLSX.** *XLSX import* → *Use* a sample (e.g. `HO_NAT_rate_change_plus4pct.xlsx`) → inspect → confirm mapping → preview diff → create draft; view *Provenance* (sheet/cell). Try the formula, ambiguous-column, renamed-column and unsafe samples.
7. **Audit & feedback.** *Audit trail* → verify the hash chain. *Feedback* → corrected mapping suggestions are reviewed before they become hints.

More detail: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## What works

- **Four lines, four distinct journeys** — Personal Auto, Homeowners, Commercial Property, BOP — across **10 demo states** (AZ, CA, FL, GA, IL, NY, NC, OR, TX, WA; a configurable synthetic set, *not* a claim about real footprints). Inputs, validation messages, eligibility rules and rating logic are all product-specific.
- **Outcomes beyond a price:** `QUOTED`, `REFERRED`, `DECLINED`, `INFO_REQUIRED`, `INVALID` (field-level errors), `RATING_ERROR`.
- **Deterministic, inspectable rating engine** with a closed set of operations (exact / range / multi-key lookup, conditional select, factors, discounts & surcharges, fees, per-vehicle loops, min/max premium, renewal cap, half-up rounding). No code, macros or spreadsheet formulas are ever executed. → [docs/RATING_MODEL.md](docs/RATING_MODEL.md)
- **National base + explicit state overrides + effective dates**, selected at rating time; every result stamps product/rating **version IDs, hashes and effective dates**.
- **Pricing workbench:** version timeline, table/parameter/step/rule/limit editors, validation (structure, references, range gaps/overlaps, plausible bounds, option completeness, smoke scenarios, impact vs previous version), before/after diffs, draft → validate → submit → approve (four-eyes) → promote → rollback, audit trail with hash chain.
- **XLSX import** for a documented profile with safety scan, sheet/table/column detection, human-confirmed mapping, cell-level provenance, cell diff between workbooks, formula/merged/hidden/error/unknown-sheet flagging. → [docs/XLSX_PROFILE.md](docs/XLSX_PROFILE.md)
- **API** for single quote, batch (≤ 200), product/input-schema discovery (incl. JSON Schema), rating-version discovery & resolution, draft validation, trace & components; OpenAPI at `/api/v1/openapi.json`. → [docs/API.md](docs/API.md)
- **Saved submissions** (save/retrieve/edit/requote), **renewal** and **endorsement** (pro-rated) test scenarios, **simulated** bind.
- **Feedback workflow** (mapping corrections, terminology, scenario usefulness, explanation comments) — scoped, reviewed, audited, and incapable of changing rates.
- **Pilot test tooling:** a scenario runner that compares two pilot configurations over a synthetic scenario set.
- **Tests:** 72 backend tests (`npm test`) and 15 headless-browser UI tests (`npm run test:ui`).

## What is simulated

- All pricing (synthetic numbers), all people/addresses/businesses, "credit"/insurance-score tiers, FEMA flood zone, protection class, wildfire/coastal exposure answers (self-declared, no lookups).
- **Bind** → a `SIM-…` pseudo policy number on a record labelled *no coverage exists*.
- **Identity** → local demo users with signed tokens (Firebase Authentication is the documented cloud path; code path present but not exercised by tests).
- **Cloud services** → none are used locally; storage is a JSON file + local blob folder behind repository interfaces.

## What is not built

- **RateGuard v3** and any integration with it or with RateGuard Enhanced (none exists; see the contract doc for the intended boundary).
- **Independent expected-premium model / assurance** (the pilot's scenario runner uses the pilot's own engine on both sides).
- **Firestore / Cloud Storage / Pub/Sub / BigQuery / Vertex AI** adapters beyond a documented design (an untested Firestore store skeleton is in `server/store/`); no cloud deployment was performed and no cloud resources exist.
- Portfolio-impact estimation, asynchronous batch jobs (batch is synchronous, ≤ 200 scenarios), AI-assisted mapping/ticket summarisation.
- Arbitrary insurer workbooks, PDFs/filings, real vehicle/address lookups, payments, documents, billing, claims, agent/commission/underwriter queues, multi-tenant isolation.
- Rate-book diff between **state overrides and national** in a merged view in the UI (the API merges; the UI shows the override patch).

See [docs/ROADMAP.md](docs/ROADMAP.md) for next steps and the session-resume plan.

## Tests

```bash
npm test             # backend: engine, versioning, products, XLSX, API, hygiene  (72 tests, ~25 s)
npm run test:ui      # headless Chrome/Edge end-to-end UI tests (15 tests, ~60 s; auto-skips if no browser)
npm run test:all
```

The UI tests use `puppeteer-core` and a locally installed Chrome/Edge (set `PILOT_BROWSER` to point at another Chromium).

## Configuration (environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port (Cloud Run sets `PORT`) |
| `PILOT_DATA_DIR` | `./data` | Local store, uploaded workbooks, generated auth secret |
| `PILOT_STORE` | `file` | `memory` for an ephemeral store |
| `PILOT_DEMO_PASSWORD`, `PILOT_API_CLIENT_PASSWORD` | demo defaults | Override demo passwords |
| `PILOT_AUTH_SECRET` | generated into `data/.auth-secret` | Token signing secret |
| `AUTH_MODE` | `demo` | `firebase` verifies Firebase ID tokens (cloud; needs `firebase-admin`) |
| `PILOT_CORS_ORIGINS` | none | Comma-separated origins allowed to call `/api` cross-origin (e.g. Firebase Hosting) |

## Project layout

```
server/engine/      rating engine, expression language use, input validation, config validation, diff, merge
server/services/    versions (lifecycle), quote, submissions, workbooks, feedback, scenario runner, audit
server/xlsx/        safety scan + parser, mapping/import/export/compare, sample workbook builder
server/seed/        synthetic products, national/state rating content, scenario sets, demo defects
server/routes/      REST API (/api/v1)        server/store/  repository interfaces (memory, file, blobs)
shared/expr.js      bounded expression language (server + browser)
public/             build-free ES-module frontend (Firebase Hosting ready)
docs/               architecture, API (+openapi.json), rating model, XLSX profile, contract, cloud, security, roadmap
samples/            synthetic sample workbooks + MANIFEST.json      scripts/  samples, openapi, data reset
tests/              backend tests; tests/ui headless-browser tests
```

## Google Cloud stack (not deployed)

Compatible with the general stack used by RateGuard Enhanced — Firebase Hosting (frontend), Firebase Authentication, Cloud Run (API + rating), Firestore, Cloud Storage, optional Pub/Sub / BigQuery / Vertex AI — sized for a ~$290 credit. **Nothing has been deployed and no cloud resource has been created.** Required vs optional services, emulator setup and separate deployment instructions: [docs/GOOGLE_CLOUD.md](docs/GOOGLE_CLOUD.md).

## Security & data rules

Synthetic data only; no credentials in the repo (a test scans for them); role-protected configuration changes with four-eyes approval; server-side validation of every input; safe error handling; immutable approved versions; hash-chained audit. → [docs/SECURITY.md](docs/SECURITY.md)
