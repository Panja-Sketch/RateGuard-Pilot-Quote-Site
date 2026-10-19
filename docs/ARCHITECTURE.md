# Architecture

```
 Browser (build-free ES modules, public/)            Future verifier (not built)
        │  fetch /api/v1/*                                   │  same REST API
        ▼                                                    ▼
 ┌──────────────────────────────  Express app (server/app.js)  ────────────────────────────────┐
 │ helmet/CSP · JSON limits · auth middleware · role guards · error mapper                       │
 │  routes/api.js                                                                                │
 │   ├─ QuoteService ──► VersionService.resolve* ──► quoteCore.rateCore ──► engine/rate.js       │
 │   │                    (national + state, dates)   (validate inputs → rules → plan → limits)  │
 │   ├─ SubmissionService (save/rate/bind-sim/renewal/endorsement)                               │
 │   ├─ VersionService (draft→validate→submit→approve→promote→rollback, diff, four-eyes)         │
 │   │     └─ engine/validateConfig.js (+ smoke runs via quoteCore, impact vs baseline)          │
 │   ├─ WorkbookService ─► xlsx/profile.js (safety scan + parse) · importer.js (map/import/diff) │
 │   ├─ FeedbackService · TestToolsService (pilot scenario runner) · AuditLog (hash chain)       │
 └───────────────┬──────────────────────────────────────┬────────────────────────────────────────┘
                 ▼                                      ▼
   Repository (async) store/store.js               Blob store (store/blobs.js)
   MemoryStore · FileStore (./data JSON)           Memory · ./data/blobs        [Firestore / GCS skeletons: untested]
```

## Design decisions

- **Plain Node (ESM) + Express, no build step.** Matches Cloud Run well, keeps the demo runnable with `npm install && npm start`, and the frontend is static files that Firebase Hosting can serve unchanged. (RateGuard Enhanced uses Python/FastAPI + Next.js; only the *cloud shape* is mirrored, no code is shared — deliberately, so a future verifier is independent.)
- **Rating logic is data.** A bounded JSON language (`shared/expr.js`) plus seven step ops. The same module is used by the browser for form `showIf` visibility, so UI and server agree on conditional questions.
- **Everything is versioned and effective-dated.** Product versions and rating versions share one registry and lifecycle. A quote's result names every version it used and a hash of the merged configuration.
- **Repository interface is async from day one** (`get/put/delete/list/count/clear`) so Firestore can replace the local stores without touching services. Services receive `{store, blobs, clock, audit}` — tests inject an in-memory store and a fixed clock.
- **Determinism.** No clock, randomness or I/O inside rating; ids and timestamps are added outside the deterministic result (`resultHash` excludes them).
- **Business outcome ≠ transport status.** A referral or invalid input is a normal 200 with a `status`; only contract violations are 4xx.
- **Validation is layered:** input validation (per product version) → eligibility rules (per rating version) → rating-time errors (`NO_RATE_FOUND`, `AMBIGUOUS_RATE`) → pre-activation *configuration* validation with smoke scenarios.
- **Independence from a future oracle.** The scenario runner uses the pilot's engine on both sides and is labelled test tooling. There is intentionally no second implementation here.

## Data model (collections)

`products` · `documents` (product + rating versions, with `transitions`, `validation`, `provenance`, `source`, `demo`) · `submissions` · `quotes` (immutable) · `workbooks` · `feedback` · `hints` · `scenarioRuns` · `audit` · `meta` (counters, audit head).

## Frontend

`public/js/main.js` (shell + hash router) · `lib/form.js` (schema-driven forms: any product renders from its definition) · `pages/*` (home, start, wizard, quote, submissions, API) · `pages/wb/*` (workbench: versions, version editor, diff, XLSX, impact, feedback, audit). All dynamic text is set via text nodes; styles are CSS variables with a dark-mode media query; layouts are responsive (tested at 390 px).

## Request lifecycle for a quote

1. `normalizeRequest` (shape checks → 400).
2. Resolve product version and national/state rating versions for the **rating date** (or pins).
3. `validateInputs` against the product version (hidden conditional fields are stripped) → `INVALID` with `{path,code,message}`.
4. `runRating`: derive → rules → (if eligible) plan → finalize.
5. Shape result: versions, validation, eligibility, premium, trace, applied config, `resultHash`; optionally persist (immutable) and audit.
