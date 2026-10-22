# Finance bridge contract v1

This document describes the original fixed proof at `/finance-demo/`. The
in-product configurable extension at `/workbench/wiring` is defined in
`WIRING.md`; it preserves these unit/sign/missing-data contracts while allowing
selected centres, expense reclassification, method and period choices.

This is a **source-specific, synthetic integration**, not a universal finance model.
No company mapping has been inferred or approved.

## Scope and identity

- Currency: USD only. Calendar FY2026; months are integers 1–12, no timezone.
- Operations is reporting BU `1`. Service Delivery → reporting centre `3`;
  Supply Chain → `4`. These names agree exactly in both original sources.
- Accounts use exact original names, in original reporting ID order `0–9`:
  Revenue, COGS, Salaries & Benefits, Contractors, Travel, Software & Licences,
  Facilities, Marketing, Professional Fees, Depreciation.
- All ten accounts and all twelve months must exist for each supported centre.
  Extra/unmapped centres/accounts, duplicate grains, absent fields, missing
  amounts and out-of-range periods are errors before writes. Other centres,
  including differently named Corporate centres, are deliberately out of scope.

## Units and precision

The forecast SQLite stores integer **cents**. Its original `data.rows()` divides
by `100.0` and its original `project()` returns **dollar floats rounded to two
decimals**, not cents. The adapter converts via `Decimal(str(value)) * 100`,
rejecting nonfinite or sub-cent values. Never divide that output by 100 again.

The reporting source ordinarily stores whole **USD dollars** in integer `amount`.
Writing rounded whole dollars would lose pennies. In this demo only, the private
reporting ledger is **unit-lifted to integer cents**. Its unchanged `totals()`
performs integer SQL sums/sign operations on those cents. The adapter divides
the final integers by 100 using Decimal and emits fixed two-decimal **dollar
strings** for the UI. This deliberate storage adaptation preserves pennies
through aggregation. A test proves whole-dollar evaluation and cent-lifted
evaluation are equivalent. Do not attach original commentary, exports, thresholds
or KPI modules to the lifted ledger: those assume dollar amounts.

The source forecast uses binary floats internally, which remains unchanged.
This bounded fixture and input domain are tested; this is not a claim of arbitrary
precision for every possible input to the original engine.

## Signs and report periods

Revenue and costs are positive stored magnitudes. Reporting source determines
OpEx (IDs 2–9) and operating profit (revenue − all costs).
Difference is current forecast minus baseline; an expense increase is adverse,
and reduces profit. It is **not actual-versus-budget variance**.

The baseline is the unchanged Q3 Forecast. Jan–Sep actuals are closed and must
equal Q3 values; future actuals must be null, never zero. Changed scenario is
Q3 Forecast plus a user adjustment; no actual ledger rows are fabricated.
Q4 is source December YTD less source September YTD. Monthly October, November,
December results also run through source aggregation. The original `report()`
UI envelope is intentionally not used: it suppresses future P&L when actuals
are unavailable. Original `totals()` is the reused reporting capability.

The source reporting query does not filter year. Therefore each temporary ledger
contains exactly FY2026 forecast rows; no other years/scenarios are mixed in.
No reporting zero-default is allowed to hide incomplete inputs: validate the
entire grid first.

## Supported input

`POST <BASE_PATH>api/run` with JSON `{"adjustment":360}`.
Only this required field is accepted. Adjustment is total **USD across Q4** for
Contractors, an integer multiple of 6 between −600 and 6000 inclusive.
The source divides it across 2 centres × 3 months. Multiples of six prevent
allocation rounding residuals; no replacement allocation algorithm is added.
Method `forecast`, revenue growth `0`, and headcount cost `0` are fixed.

Response: `adjustment`, `currency`, `period`, `lines` (id/name/baseline/current/
difference dollar strings), `months` (period plus lines), `note`, `sourceHashes`.
See `src/finance-api.ts` for the artifact-local client interface.
400 invalid input; 413 oversized body; 415 non-JSON; 503 busy; 500 calculation
failure. Reset is another run with zero. No persistent state or sessions.

## Isolation and repeat application

Each request is a fixed Python subprocess, with no inherited secret environment,
no arbitrary upload execution or code path selection. A private `/tmp` directory
contains both databases; separate dynamically named Python packages prevent
the two `finance.data` modules colliding. Paths are injected before initialization.
Each request reconstructs baseline and scenario, then removes its databases.
Replacing a forecast validates first and atomically replaces rows, never appends.
Maximum four active requests, 4 KiB body and 15 second process deadline.
This is process/data isolation, **not an OS security sandbox for untrusted code**.
