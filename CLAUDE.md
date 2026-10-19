# CLAUDE.md — Pilot Quote Site

Synthetic insurance rating/quoting pilot: a **test target** for a *future* RateGuard v3. Standalone repository.

## Hard rules

- **Never modify `../rateguard-enhanced`** (read-only reference for stack conventions). Don't copy its code. Don't claim integration with it. **RateGuard v3 does not exist** — never describe it as existing.
- **Synthetic data only.** No real insurer/customer/employer data, no credentials or keys in the repo (a test scans for them).
- **No cloud deployment or resource creation** without the user's explicit approval. Local-first. Cloud adapters under `server/store/{firestore,gcs}.js` are untested skeletons.
- Quotes are *illustrative*; bind is *simulated*. Keep those labels.
- Rating stays deterministic, bounded and free of dynamic-code execution (`eval`, `Function`, spreadsheet formulas, macros).
- Feedback must never change rates, calculations or results.

## Commands

```bash
npm install
npm start                 # http://localhost:3000  (demo users in README; password pilot-demo-2026)
npm test                  # backend tests (~25 s)
npm run test:ui           # headless-browser tests (needs Chrome/Edge; auto-skips otherwise)
npm run samples           # regenerate samples/*.xlsx + MANIFEST.json (a test checks they match)
npm run openapi           # regenerate docs/openapi.json (a test checks it matches the routes)
npm run seed:reset        # delete ./data (re-seeds on next start)
```

## Layout (see docs/ARCHITECTURE.md)

`server/engine` (rating, input + config validation, diff, merge) · `server/services` (versions lifecycle, quote, submissions, workbooks, feedback, test tooling, audit) · `server/xlsx` · `server/seed` (all synthetic content) · `server/routes/api.js` · `shared/expr.js` (expression language, also used by the browser) · `public/` (build-free ES modules) · `docs/` · `samples/` · `tests/` (+ `tests/ui`).

## Conventions

- Match the surrounding style: ES modules, 2-space indent, terse helpers, comments only for non-obvious intent.
- Seed content is built with `server/seed/helpers.js` (`T`, `E`, `S`, `R`, `F`). After changing seed tables, run all tests; scenario sets (`server/seed/scenarios.js`) double as smoke scenarios for config validation.
- New API route ⇒ add it to `scripts/build-openapi.js`, run `npm run openapi`, extend `tests/api.test.js`.
- New UI text goes through `h()` (text nodes). Never use `innerHTML`.
- Business outcomes are HTTP 200 + `status`; only contract problems are 4xx.

## Where things are decided

Roles/permissions: `server/auth.js`. Version selection: `VersionService.resolveRating`. Lifecycle + four-eyes: `server/services/versions.js`. Quote shaping: `server/services/quote.js`. Validation gate: `server/engine/validateConfig.js`. XLSX profile: `server/xlsx/*`. Status/next steps: `docs/ROADMAP.md`.
