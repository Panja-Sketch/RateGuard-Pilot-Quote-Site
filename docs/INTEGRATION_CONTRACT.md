# Intended future integration contract (RateGuard v3)

> **Status: design only.** RateGuard v3 has **not** been built and does not exist. RateGuard Enhanced (the current, separate product) is **not** integrated with this pilot and nothing here changes it. This document describes the API boundary the pilot exposes so that a *future* RateGuard v3 — or any other independent verifier — could call it without reading the pilot's source code. Nothing in the pilot claims to perform RateGuard's analysis.

## Why a boundary at all

The intended future flow (from the project brief) is: take a pasted rate-change request (e.g. Jira text) and approved rate-book workbooks → interpret the change against prior approved pricing → generate targeted rating tests → **call a rating implementation through an API without reading its source** → compare with an **independent** expected-pricing model → explain mismatches. The pilot plays the role of the *implementation under test*: a realistic quote/rating service with a configurable rate book.

The pilot's own rating engine is therefore deliberately independent of any future expected-premium oracle (no shared code, no shared tables). The pilot's scenario runner only compares the pilot against itself; it is test tooling, not assurance.

## The calls a verifier needs

| Need | Call |
| --- | --- |
| Which products and inputs exist? | `GET /products`, `GET /products/{id}/schema?date=` (JSON Schema + conditional rules) |
| Which rating versions exist and apply? | `GET /rating-versions?productId=&state=`, `GET /rating-versions/resolve?productId=&state=&date=` |
| Price one scenario | `POST /quotes` |
| Price many scenarios | `POST /quotes/batch` (≤ 200, synchronous) |
| Price against a **candidate** (draft) version before it is promoted | `POST /quotes` with `ratingVersionIds: {national: "<draft id>"}` (api_client / pricing roles) |
| Check a draft is structurally valid | `POST /rating-versions/validate` or `POST /rating-versions/{id}/validate` |
| See *why* a premium came out as it did | `trace`, `premium.components`, `premium.modifiers`, `appliedConfig` in the result |

## What every request/result preserves

Request fields: scenario ID, product & LOB, state/jurisdiction, transaction type, effective date, risk inputs, coverages, optional version pins. Result fields (always echoed or produced): scenario ID, product, LOB, state, transaction type, effective date, **rating date**, risk and coverages, **product version ID + hash**, **rating version IDs + hashes** (national and any state override), `effectiveConfigHash`, `status`, premium **total and components/modifiers/fees/adjustments**, **applied table and step identifiers** and a safe step trace (which table row matched, which version supplied it), eligibility/referral/validation outcome, and a deterministic `resultHash`. Full schemas: [API.md](API.md) and `/api/v1/openapi.json`.

## Authentication boundary

| Environment | Mechanism | Role |
| --- | --- | --- |
| Local demo (implemented, tested) | `POST /auth/login` as `rateguard.client`; HMAC-signed bearer token | `api_client`: quote, batch, discovery, validate (read-only), pin versions, run pilot scenario sets; **cannot** edit/approve/promote, read submissions or the audit trail |
| Cloud (documented, **not deployed**) | Cloud Run IAM (`roles/run.invoker`) with a Google-signed ID token from the verifier's service account, *or* Firebase Authentication ID tokens with a custom `pilotRole` claim (`AUTH_MODE=firebase`, code path present, untested) | `api_client` |

No API key, shared secret or service-account key is stored in this repository. A verifier never needs filesystem or database access.

## Behavioural guarantees a verifier can rely on

- **Determinism:** identical request + identical configuration ⇒ identical result (no clock, randomness or network in rating). `resultHash` makes that checkable.
- **Version selection is explicit and reproducible:** national version in force on the rating date, then the state override in force on that date; pins override.
- **No firm price when there is no firm answer:** referral/decline/information-required/invalid/rating-error results carry **no** premium. A failure is never converted to a pass or a zero.
- **Immutability:** approved/active versions never change; a change is a new version with a new ID and effective date. Stored quotes are immutable and tied to version IDs.
- **Feedback cannot move a price:** reviewed feedback only produces *suggestions* for workbook mapping; it never edits rates, calculations or results.

## Things a future integration will probably need (not built)

- Asynchronous batches for portfolio-scale runs (Pub/Sub + a worker; the pilot batch is synchronous ≤ 200).
- A connector registration/versioning layer on the verifier side (the pilot already advertises engine name/version in every result).
- Portfolio analytics export (BigQuery) of synthetic quotes for impact estimation.
- Contract tests owned by the verifier that exercise this OpenAPI document.

## Example sequence

```text
1. GET  /rating-versions?productId=homeowners&status=draft          -> finds HO-NAT-v3 (candidate)
2. POST /rating-versions/HO-NAT-v3/validate                         -> structural report (read-only for api_client)
3. POST /quotes/batch  {scenarios:[…], defaults:{…}}                -> baseline results (versions in force)
4. POST /quotes/batch  same scenarios + ratingVersionIds:{national:"HO-NAT-v3"} -> candidate results
5. verifier compares both against ITS OWN expected prices and explains any mismatch
```
