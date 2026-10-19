# Demo script: a normal rate change vs an intentional defect

All numbers are synthetic and come from the seeded configuration (they will match on a fresh `npm run seed:reset`). Default password for the human demo users: `pilot-demo-2026`.

## 0. Setup

`npm start` → http://localhost:3000. Sign in as `analyst.demo`. Open **Pricing workbench**. Product tabs show the version timeline; for Homeowners you will see `HO-NAT-v1` (2025-01-01), `HO-NAT-v2` (2026-07-01, active), and three **demo drafts**: `v3` (normal +4%), `v4` (silent defect), `v5` (structural defects).

## 1. The reference quote

*New quote → Homeowners → AZ → effective 2026-10-15*, or use the API:

```bash
# baseline scenario: AZ home, roof replaced 2005 (roof age 21), everything else the seed defaults
HO-NAT-v2  → $1,606.83   (roof-age factor 1.35 from ROOF_AGE, version HO-NAT-v2)
```
Open **Rating trace** → the `l_roof_age` step shows `ROOF_AGE[age=21] → 1.35 (row 4: age_min 21)` and the version that supplied it.

## 2. A normal, intended rate change (`HO-NAT-v3`: base rates +4.0%)

1. Open `HO-NAT-v3` → **Overview** shows the (synthetic) ticket. **Compare with…** `HO-NAT-v2`: ten `BASE_RATE` rows, each +4.0%.
2. **Validate** → *passes*. The validation report's impact section: 22/22 smoke scenarios change, average +3.66 %, max +3.85 % (less than 4 % because fees and flat-priced components don't scale).
3. **Run scenarios…** (baseline `HO-NAT-v2`, candidate `HO-NAT-v3`, expected change **4**, tolerance 1.5) → every priced scenario sits within +3.06 % … +3.84 %; **0 outside expectation**.
4. **Submit for approval** (analyst). Try to **Approve** as the same analyst → no control (and the API would answer `FOUR_EYES`). Sign in as `approver.demo` → **Approve**, then **Promote to active** (effective 2026-12-01).
5. Quote AZ on **2026-11-30** → `HO-NAT-v2`; on **2026-12-01** → `HO-NAT-v3`; the quote's *Versions & configuration* tab shows the version IDs and hashes. Audit trail: created/validated/submitted (analyst), approved/promoted (approver).
6. **Roll back…** with a reason → quotes on/after the date fall back to `HO-NAT-v2` automatically.

## 3. An intentional *silent* defect (`HO-NAT-v4`)

Ticket text claims "no pricing change intended". The candidate actually changes **one cell**: roof age ≥ 21 factor `1.35 → 1.25`.

1. **Compare with…** `HO-NAT-v2` → exactly one change: `ROOF_AGE [age≥21] 1.35 → 1.25 (−7.41 %)`.
2. **Validate** → **passes** (in bounds, no gaps) — the pilot's own gate cannot know 1.25 is wrong. The impact summary shows only 2 of 22 scenarios changed.
3. **Run scenarios…** with expected change **0**, tolerance 0.5 → **2 flagged**: `roof-age-21` (−6.94 %) and `roof-age-30` (−6.99 %); the other 13 priced scenarios are unchanged. That is *evidence of what the change does*, not proof of what it should do — an independent expectation would be needed (the future RateGuard v3 role).
4. XLSX route to the same defect: *XLSX import → Use `HO_NAT_defect_silent.xlsx` → base `HO-NAT-v2`* → preview shows the single cell, provenance points to `RT_ROOF_AGE!C5`; *Compare two uploaded workbooks* (template vs defect) also reports exactly `RT_ROOF_AGE!C5: 1.35 → 1.25`.

## 4. Intentional *structural* defects (`HO-NAT-v5`)

**Validate** → **fails** with readable errors: `CONSTR row 1: value 112 is outside the plausible range 0.2–5 (possible mis-keyed factor)`; `ROOF_AGE: gap between 15 and 16 — values in the gap would have no rate`; `plan[l_found]: table FOUNDATION has no row for foundation = pier`. It cannot be submitted (`INVALID_TRANSITION`), let alone promoted.

## 5. XLSX safety and mapping demos (`samples/`)

| Sample | What to show |
| --- | --- |
| `HO_NAT_v2_current.xlsx` | template; all mappings `ready`; import ⇒ 0 changes |
| `HO_NAT_rate_change_plus4pct.xlsx` | +4 % on ten rows; provenance per cell |
| `HO_NAT_unsupported_formulas.xlsx` | `FORMULAS_UNSUPPORTED` at `C5` (`=C4*1.04`); import blocked |
| `HO_NAT_renamed_columns.xlsx` | sheet “Roof Age”, “Age From/Age To/Factor” → suggestions need your confirmation; change one → captured as feedback |
| `HO_NAT_ambiguous_columns.xlsx` | two candidate value columns, a blank cell (`MISSING_VALUE` at `D4`), an unknown sheet |
| `UNSAFE_macro_parts.xlsx`, `UNSAFE_external_link.xlsx` | rejected at upload, not stored |

## 6. State overrides and effective dates

Resolver (*Which versions apply?*): FL on 2026-10-15 → `HO-NAT-v2` + `HO-FL-v1`; GA → national only. Personal Auto CA on 2026-12-31 → `PA-CA-v1`, on 2027-01-01 → `PA-CA-v2` (future-dated). TX homeowners before 2026-01-01 → no state override.
Behavioural examples: FL coastal home with a flat wind deductible → *more information required*; TX asphalt roof ≥ 20 years → *referral*; CA very-high wildfire → *not eligible*; CA auto ignores the insurance-score tier.

## 7. Renewal / endorsement / simulated bind

On any quoted submission: **Renewal scenario** (prior-term premium enables the ±15–25 % cap), **Endorsement scenario** (edit coverage → pro-rated change; both risks rated on the policy-effective-date versions), **Simulate bind** (labelled; no coverage).

## 8. Feedback

Quote page → *Why this price* → “Was this explanation clear?”; Workbench → *Feedback* → accept a mapping correction as `approver.demo` → the next inspection shows a `reviewed hint` suggestion for that product only. Premiums and versions do not change.
