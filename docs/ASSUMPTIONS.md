# Assumptions, decisions and what was (and was not) inspected

## RateGuard Enhanced (read-only reference)

The sibling repository `rateguard-enhanced` was inspected **read-only**. It was not edited, committed, deployed or reconfigured, and no code was copied from it. What was learned (and mirrored only as *cloud shape*):

- Python/FastAPI backend and Next.js frontend; Cloud Run; Firestore accessed only by the API through the server client (rules deny all browser access; emulator on port 8085); Cloud Storage artifacts; Pub/Sub + BigQuery for portfolio impact; Vertex AI (`gemini-3.1-flash-lite`) for bounded assistance; Firebase Authentication with server-assigned roles.
- It already contains a *demo* black-box rating engine contract (`POST /quote`, `/quote/batch`, `GET /capabilities`, canonical vs defective versions) and a “Controlled Workbook v1” (`RG_*`) contract. The pilot's workbook profile and API are **independent designs**; they were not aligned to those contracts, and no compatibility is claimed.
- RateGuard Enhanced is **the current product**. RateGuard v3 is **future and unbuilt**; this repository does not describe it as existing.

## Reference quote sites

The brief lists public quote flows (Progressive, GEICO, Allstate, State Farm, Liberty Mutual, The Hartford, USAA, Nationwide, Chubb) as things to study. **The sites were not fetched in this session** (no browsing was performed). Input sets reflect general knowledge of common online quote flows and the descriptions in the brief (e.g. drivers/vehicles/garaging/limits/discounts for auto; address, year built, construction, roof, protection, dwelling limit and deductible for homeowners; construction/occupancy/protection/values for commercial property; class, revenue, employees, claims for BOP). Nothing is copied from those sites; no brand, wording or layout is reused; Guidewire is not referenced in the product and is only a workflow reference in the brief.

## Product and modelling decisions

- **One product per line** (`personal-auto`, `homeowners`, `commercial-property`, `bop`). The data model supports several products per line; seeding more is mechanical.
- **12-month terms**, USD, whole-term premium; payment plans are derived (down payment %, instalment fee).
- **Request layout:** `risk` holds risk data and arrays (drivers, vehicles); `coverages` holds policy-level coverages and discounts; per-vehicle comprehensive/collision deductibles sit on each vehicle. `state` is a top-level request field (and duplicated into `risk.state` internally).
- **Insurance-score tiers** are a synthetic stand-in; CA's override removes them to show a state difference. **Gender is deliberately not collected** (restricted in some jurisdictions). No claim of legal accuracy is made about any state behaviour — the state differences are *illustrations of mechanism*.
- **ZIP validation** uses coarse ZIP3 ranges per demo state (`server/engine/geo.js`), not a real ZIP database; synthetic territories are bands of those ranges.
- **Flood zone, wildfire exposure, protection class, distance to coast** are answered by the user (no external lookups).
- **Referral/decline/info** rules produce no premium by design (a firm price cannot be released).
- **Renewal cap:** the cap applies only when the request supplies `priorTermPremium`.
- **Endorsement:** pro-rata by days; both risks rated with versions in force on the policy effective date.
- **Schedule rating (BOP):** a demo "underwriter" field available to anyone in the demo, capped by the rating plan (±25 %, CA ±15 %).
- **Rounding:** per component, half-up; configurable places.
- **Time:** the server never reads the clock while rating. The UI defaults the effective date to *today + 14 days*; seeded scenarios use fixed dates (2026-10-15) so numbers are reproducible.
- **Demo defects:** "silent" and "structural" candidates are generated from `HO/PA/CP/BOP-NAT-v2` by `server/seed/defects.js`; their tickets are synthetic text the pilot stores but does not analyse.

## Technology decisions

Node.js 20+ (developed on 24), Express 4, ExcelJS (read XLSX as data), JSZip (safety scan), Helmet; no frontend build; `node:test` for backend tests; `puppeteer-core` (dev) + a locally installed Chromium-based browser for UI tests. File-based local persistence behind a repository interface. Chosen over Python/Next.js to keep the pilot a tiny, build-free, single-command project that is independent of RateGuard's stack.

## Not verified

- The Firestore/GCS adapters and Firebase token verification were **not** run against any emulator or cloud service.
- No deployment, billing, quota or IAM behaviour was exercised.
- Browser tests ran on Chrome/Edge on Windows only; other browsers are untested.
