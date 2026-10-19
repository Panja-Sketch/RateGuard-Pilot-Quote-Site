# XLSX support: Pilot Rate Workbook Profile v1

The pilot imports rate tables from `.xlsx` files that follow a **documented profile**. It is *not* a general Excel importer: anything outside the profile is flagged for a person to map or ignore. Nothing is executed and nothing is guessed.

## The profile

| Element | Rule |
| --- | --- |
| Sheet `RT_<TABLE>` | one rate table (e.g. `RT_ROOF_AGE`), header in **row 1**, data from row 2. Blank rows are ignored. |
| Columns | exact key → one column named after the key (`state`, `roof_type`, …); range key → `<name>_min` (**inclusive**) and `<name>_max` (**exclusive**; blank = unbounded); the rate/factor in **`value`** (a plain number). Order is irrelevant; extra columns are ignored only if unmapped. |
| Sheet `PARAMS` | `key`, `value` (and optional `description`). Only **existing** parameter keys of the base version can be updated; types must match (number/boolean/string). |
| Sheet `META` | optional key/value: `profile`, `productId`, `scope`, `state`, `versionId`, `effectiveFrom`, `contentHash`. Used to pre-select the base version and warn on product/profile mismatches. |
| Sheets `README`, `NOTES` | ignored |
| Not supported | formulas, macros, external links, OLE/ActiveX, data connections, merged cells in table sheets, legacy `.xls`, macro formats. |

Download templates from the UI (*XLSX import → Export a current version as a template*) or `GET /api/v1/rating-versions/{id}/export.xlsx`; sample files live in [`samples/`](../samples) with a `MANIFEST.json` (regenerate with `npm run samples`).

## Pipeline (`server/xlsx/*`, `server/services/workbooks.js`)

1. **Upload** (`POST /workbooks`, raw bytes, `X-Filename`): size ≤ 5 MB → **ZIP safety scan** → only then parsed with ExcelJS **as data**. Unsafe files return `accepted:false` with findings, are not opened and not stored.
2. **Inspect** (`POST /workbooks/{id}/inspect`): per sheet — visibility, rows/columns, formula-cell count (with the first cell addresses), error values, merged ranges; per candidate table — header row, columns (`numeric|text`, samples), candidate value column, row count; `META`; issues.
3. **Suggest mapping** against a chosen **base version** (the draft is cloned from it). Suggestions carry a confidence — `exact`, `hint` (reviewed feedback), `normalized`, `pattern` (`Age From`→`age_min`), `synonym` (`Factor`→`value`), `suggested` — and a status `ready | needs_confirmation | incomplete`. Ambiguity (two columns match the same target) is reported, never resolved silently.
4. **Confirm** — a person confirms each table. The API refuses unconfirmed mappings (`UNCONFIRMED_MAPPING`).
5. **Preview** (`POST /workbooks/{id}/preview`): import issues, structured **diff vs the base version** (with % changes), and the pilot's validation report for the would-be draft.
6. **Import** (`POST /workbooks/{id}/import`): creates a new **draft** (never active) with `source` (file, SHA-256, profile, who confirmed) and **provenance** for every imported value (`tables.<T>[row] → {sheet, row, cells:{col:"Sheet!C5"}}`, `params.<key> → cell`). The draft must still be validated, submitted and approved by a different person.
7. **Compare** (`POST /workbooks/compare`): cell-by-cell diff of two uploaded workbooks (sheet, cell, column, row key, before, after).
8. **Export** a version to the profile; a round trip (export → import) yields zero differences (tested).

## What gets flagged (and blocks import where marked)

| Code | Meaning | Blocks import |
| --- | --- | --- |
| `MACROS`, `EXTERNAL_LINKS`, `EMBEDDED_OBJECTS`, `DATA_CONNECTIONS`, `UNSAFE_PATH`, `ZIP_BOMB`, `TOO_MANY_ENTRIES`, `FILE_TOO_LARGE`, `NOT_XLSX`, `UNSUPPORTED_FORMAT`, `CORRUPT_ZIP` | unsafe/unsupported container | **rejected at upload** |
| `FORMULAS_UNSUPPORTED` | formula cells (address + formula shown); never evaluated | yes |
| `ERROR_VALUES` | `#REF!`, `#N/A`, … | yes |
| `MERGED_CELLS` | error on `RT_` sheets, warning elsewhere | on `RT_` sheets |
| `HIDDEN_SHEET` | hidden content is still read; review it | no (warning) |
| `DUPLICATE_HEADER` | same header twice | yes |
| `MISSING_KEY`, `MISSING_VALUE`, `NOT_NUMERIC`, `BAD_RANGE` | blank/invalid cell, with `Sheet!Cell` | yes |
| `UNKNOWN_TARGET`, `MISSING_COLUMN`, `AMBIGUOUS_MAPPING`, `UNCONFIRMED_MAPPING`, `NOTHING_IMPORTED` | mapping problems | yes |
| `UNKNOWN_PARAM`, `NOT_NUMERIC`/`NOT_BOOLEAN` in `PARAMS` | cannot add or retype parameters | yes |
| `UNMAPPED_SHEET` | a sheet is neither mapped nor ignored | no (warning; data not imported) |

After import, the normal **version validation** adds range gaps/overlaps, out-of-bounds factors and option completeness; the seeded `HO_NAT_defect_structural.xlsx` demonstrates all three.

## Feedback loop (reviewed, scoped, never automatic)

If a user changes a suggested column during mapping, the import records a `mapping_correction` feedback item (status `submitted`) tied to the product, profile and the draft version. A reviewer who is not the author accepts it → a **versioned, product-scoped hint** (`HINT-…`, `version`, `supersedes`) that the *next* inspection shows as a `hint` suggestion — still unconfirmed. Hints do not leak across products; rejected feedback creates nothing. Feedback never changes rates, calculations or validation results (tested by comparing result hashes and content hashes before/after).

## Sample workbooks (`samples/`)

Templates for all four lines (`*_NAT_v2_current.xlsx`), normal change (`HO|PA_NAT_rate_change_plus4pct.xlsx`), intentional defects (`*_defect_silent.xlsx`, `*_defect_structural.xlsx`), formula blocker, renamed columns, ambiguous columns, and two unsafe files (macro part, external link). `MANIFEST.json` states what each should do; a test keeps the manifest and generator in sync.
