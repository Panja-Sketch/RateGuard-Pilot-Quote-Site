# Security and data rules

Scope: a **synthetic** demo target. It is hardened reasonably for a demo; it is not a production insurance system and has not been penetration-tested.

## Data

- Synthetic data only — seed data, samples, examples and tests. A test scans seeds for real-world markers (SSN-like numbers, e-mail addresses, insurer/vendor names).
- The UI tells users to enter fictional people, addresses and businesses. No real lookups are made.
- Every quote carries the disclaimer; bind is simulated and labelled.

## Secrets and credentials

- No credentials, tokens, keys or service-account files in the repository (`tests/hygiene.test.js` scans for private keys, `AIza…`, `ya29.`, service-account JSON, AWS/Slack/GitHub/OpenAI-style tokens; `.gitignore` covers `data/`, `.env*`, `*.pem`, `*.key`, `service-account*.json`).
- The demo passwords in the README are intentionally public and for local use; they are hashed with scrypt in memory, compared in constant time, and can be overridden by environment variables.
- The token-signing secret comes from `PILOT_AUTH_SECRET` or a file generated in `./data` (mode 0600, git-ignored). Cloud mode uses Application Default Credentials; no keys are ever created.

## Authentication and authorisation

- Roles `agent`, `pricing_analyst`, `pricing_approver`, `admin`, `api_client`; one permission matrix (`server/auth.js`) enforced by route middleware.
- Configuration editing, import, approval, promotion and rollback are role-gated; **four-eyes**: whoever created or submitted a version cannot approve it; reviewers cannot review their own feedback.
- Failed sign-ins are throttled (10 per 5 min per IP+user; successful sign-ins do not count). Tokens are HMAC-signed, expire after 8 h, and are verified in constant time.
- Pinning draft versions in a quote request requires `quote:pin`.

## Input validation and safe errors

- Every request is validated server-side against the product version in force; unknown fields are rejected; types, ranges, enums, ZIP/state consistency and cross-field rules are enforced. JSON body ≤ 2 MB, uploads ≤ 6 MB, batch ≤ 200.
- Errors are `{error:{code,message}}`; unexpected exceptions return a generic 500 and are logged server-side only (no stack traces or paths to clients).
- Helmet security headers; a strict Content-Security-Policy (`script-src 'self'`, no inline scripts, `frame-ancestors 'none'`); CORS is off unless `PILOT_CORS_ORIGINS` lists origins.
- The frontend never assigns HTML strings (a test greps for `innerHTML`/`insertAdjacentHTML`/`document.write`); all text goes through text nodes.

## The rating model is not a code-execution surface

- Rating logic is JSON in a **closed vocabulary** (7 step ops, a fixed expression op set, depth/size limits). Uploaded or edited configuration is data; there is no `eval`, `Function`, `vm`, `child_process`, spreadsheet formula engine or macro support anywhere (a test checks the source).
- Object-prototype tricks (`constructor`, `__proto__`) are rejected as unsupported operations (tested).

## XLSX safety

Uploaded workbooks are scanned at the ZIP level **before** any spreadsheet parser reads them: macros (`vbaProject.bin`, macro-enabled content types), external links, OLE/ActiveX/embeddings, data connections, path-traversal entry names, entry-count and **decompressed-size (zip-bomb)** limits, 5 MB file limit, `.xls/.xlsm/.xlsb` rejected. Rejected files are never opened and not retained. Accepted files are read as data: formulas, error values, merged cells, hidden sheets and unknown sheets are reported; formulas are never evaluated. See [XLSX_PROFILE.md](XLSX_PROFILE.md).

## Integrity and audit

- Approved/active versions are frozen with a SHA-256 content hash; stored quotes are immutable and carry the version IDs and hashes used.
- Audit entries (who/what/when, with detail) are chained by SHA-256; `/audit/verify` detects edited or removed entries (tested). This is tamper-*evident*, not tamper-proof; production would also stream entries to write-once storage.

## Known limitations (be honest about them)

- Local demo tokens and the in-memory throttle are single-process; cloud mode needs Firebase Authentication or IAM (documented, untested here).
- No rate limiting beyond sign-in throttling and size limits; no CSRF concern for bearer-token APIs, but no cookie sessions exist.
- The audit chain and sequence counters assume a single writer (see GOOGLE_CLOUD.md).
- Dependencies are pinned by `package-lock.json`. `npm audit --omit=dev` currently reports **2 moderate advisories**, both the same issue reached through `exceljs → uuid < 11.1.1` (a buffer-bounds bug in uuid v3/v5/v6 when a caller supplies an output buffer). The pilot passes no untrusted input to uuid and we believe the path is not reachable, but that was not verified exhaustively; the only "fix" npm offers is a breaking downgrade of ExcelJS. Accepted for a local synthetic demo; re-check and run `npm audit` before any deployment.
