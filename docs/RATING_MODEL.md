# Rating model

All numbers in the seed configuration are **invented**. The *shape* of the model is what matters: a small, closed, inspectable language that cannot run arbitrary code.

## Documents and versions

Two kinds of versioned, immutable-once-approved documents (collection `documents`):

- **Product version** (`kind: product`, e.g. `HO-PROD-v1`): the question set — sections, fields (`string|text|integer|number|currency|boolean|date|zip|select|multiselect`), `min/max`, options, conditional `showIf`/`requiredIf`, cross-field `checks`, supported states, term. It drives the UI wizard *and* API validation.
- **Rating version** (`kind: rating`, e.g. `HO-NAT-v2`, `HO-FL-v1`): `scope` (`national` or `state`), `effectiveFrom/To`, and `content`.

Statuses: `draft → validated → pending_approval → approved → active` (plus `rejected`, `rolled_back`). Active versions are frozen (`contentHash` = SHA-256 of canonical JSON).

## National base + state overrides + effective dates

- A **national** version is a complete rate book (tables, derived values, rules, calculation plan, limits, payment plans).
- A **state override** is a *patch*: `params`, replacement `tables` (by name), `rules` (replace by id / add), `removeRules`, `stepOverrides` (replace or remove a step by id), `additionalSteps` (insert after a step), `limits` (shallow merge), `paymentPlans`.
- **Selection** (`VersionService.resolveRating`): for the *rating date* choose the active national version with the greatest `effectiveFrom ≤ date` (and `date < effectiveTo`), then the active state override for the state by the same rule. Rating date = `effectiveDate` for new business/renewal, **`policyEffectiveDate` for endorsements**. Explicit pins override (pricing/API roles).
- **Merge** records an `origin` for every table/rule/step/param so results can say *which version supplied which table*.

Seed examples (illustrative): `PA-NAT-v1` (2025-01-01), `PA-NAT-v2` (2026-07-01, +3.5% base rates); `PA-CA-v1` (no insurance-score rating, heavier mileage weighting), `PA-CA-v2` (**future-dated** 2027-01-01); `HO-FL-v1` (fee, catastrophe-fund surcharge, hurricane-deductible information rule), `HO-CA-v1` (wildfire loads + decline very-high wildfire), `HO-TX-v1` (percentage wind/hail credits, older-asphalt-roof referral); CP and BOP overrides for FL/TX/NY/CA. States without an override use national rates.

## Execution order (`server/engine/rate.js`)

1. **derive** steps (cheap values rules may use: ages, zip3, replacement-cost estimate).
2. **rules** → each `{id, kind: decline|refer|info, message, when}`; decision priority `DECLINE > REFER > INFO_REQUIRED`. Any non-eligible decision stops here — **no premium is produced**.
3. **plan** steps build premium components, modifiers and fees.
4. **finalize**: round each component half-up, sum with fees, apply renewal cap (if `RENEWAL` with `priorTermPremium`), minimum premium, maximum premium; total = components + fees + adjustments (an invariant tested for every quote). Payment plans are derived from the total.

## Supported operations (closed set)

| Step `op` | Meaning |
| --- | --- |
| `set` | `out = expr` |
| `lookup` | `out = TABLE[key exprs]` — exact, **range** (`min` inclusive, `max` exclusive), and multi-key (several exact + range columns). A miss is `NO_RATE_FOUND`, more than one hit is `AMBIGUOUS_RATE`; neither is silently defaulted (unless the table declares `onMiss:"default"`). |
| `select` | conditional selection: first matching case, else default |
| `component` | adds a premium component (`label`, `amount`, `tags`, `coverage`) |
| `modifier` | multiplies matching components (by `tags` or `*`) — discounts, surcharges, factors; recorded with its dollar effect |
| `fee` | flat amount not subject to modifiers |
| `foreach` | repeats steps per list item (vehicles) with bound locals (e.g. the vehicle's primary driver); variables are iteration-local |
| any step | optional `when` condition |

Expressions (`shared/expr.js`) are JSON: literals, `{in:"risk.x"}` inputs (roots `risk`, `cov`, `sys`, loop locals), `{v:"var"}`, `{p:"param"}`, `{list:[…]}`, `{agg:sum|min|max|count|any|all, over, expr, where}` and ops `add sub mul div min max abs floor ceil clamp round eq ne gt gte lt lte in not and or if coalesce years_between year len at`. Limits: depth 24, 400 nodes. There is **no** `eval`, `Function`, formula engine, I/O or randomness (a test greps the source for these).

## Rounding and money

Half-up rounding with a small float guard, applied per component; sums are done in integer cents. Places are configurable (0–4) per version. Currency is USD only.

## Eligibility, referral and "more information"

Rules are data, versioned with the rate book, and can be overridden per state (`HO_FL_INFO_HURRICANE_DED`, `HO_TX_REF_OLD_ASPHALT`, `PA_NY_REF_UNDER18`, `HO_CA_DECL_WILDFIRE`, …). Messages are user-readable and shown verbatim.

## Validation gate

See [API.md](API.md#validation-of-a-draft-rating-version). It is the pilot's *own* configuration gate; it intentionally cannot catch a mis-keyed-but-plausible factor.

## Trace

Every quote can carry the ordered step trace: derived values, each lookup (table, inputs, matched row, version that supplied the table, value), components (raw amount), modifiers (factor, targets, effect), fees. The trace never contains source code or configuration beyond the rows that were matched.
