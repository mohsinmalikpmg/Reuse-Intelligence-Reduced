# Spend Tracker (synthetic, single-browser demo)

**Standout capability: line-item provenance.** PROJECT -> LINE-ITEM GROUP
(materials vs labour, across invoices) -> original invoice source line. In this
demo an AFE is the project (AFE-100 Field maintenance, AFE-200 Facility upgrade);
a PAR is a suballocation. The home route `/` (and `/trace/:scope[/:group]`, scope
`all`, an AFE or a PAR id, group `materials|labour`) shows grouped pending,
approved-unpaid, paid, rejected (excluded) and committed totals; clicking a group
lists its lines with supplier, invoice ID/number, PAR, category, description,
amount and status, each linking to invoice detail (which shows its own lines).
A reconciliation table proves materials + labour = invoice-row totals.
Budget bars/overrun moved to `/budget`; search and single decisions are secondary.

Traces every CAD dollar from AFE to PAR to invoice, separating pending,
approved-unpaid, paid and rejected spend, and showing committed overrun
separately from projected overrun (including pending exposure).

Not company data, policy or branding. No real payments, no enterprise
authorization: the viewer/reviewer switch is a demo role, not authentication.
See `SCENARIO.md` for the fixture and rules (variant A/C decision flow).

## Start
Requires Node 24 and pnpm 10. Extract the ZIP into its own directory.

    pnpm install --frozen-lockfile
    pnpm run dev          # PORT (default 5173) and BASE_PATH (default /) honored
    pnpm test
    pnpm run typecheck && pnpm run build   # output: dist/public

Use distinct PORT values when running all three apps. `pnpm run serve` serves
the build. No monorepo imports, secrets, database service or migrations needed.
`python3 package-source.py` reproduces a content-addressed ZIP from the explicit
`package-files.json` allowlist. The archive's `source-hashes.json` records source
hashes. Dependencies, browser data, credentials and build clutter are excluded.
See `DEMONSTRATION.md` for the later consolidation acceptance plan.

## Architecture
- `src/domain/model.ts` - pure domain: normalized maps (suppliers, afes, pars,
  invoices keyed by id; AFE.parIds, PAR.invoiceIds indexes), reference validation,
  PAR -> AFE -> portfolio rollup selectors, independent row reconciliation,
  overrun trail, duplicate detection, transitions, storage codec.
- `src/domain/domain.test.ts` - fixture totals, every PAR/AFE rollup, missing refs,
  transition boundaries, approved-to-paid leaves committed unchanged, overrun trail.
- `src/domain/lines.ts` - immutable source-line fixture (I1-M/I1-L ... I8-M/I8-L,
  integer cents; each pair sums to the invoice), `validateLines` (id format,
  duplicates, refs, category, positive integer cents, two lines per invoice, sum
  reconciliation), `tracedLines`, `linesOfInvoice`, `groupTrace`. Lines are never
  persisted; their status is derived from the persisted invoice status, so saved
  decisions (storage schema unchanged) keep working.
- `src/domain/lines.test.ts` - grouping, AFE-200 baseline (materials committed
  14,000.00 / pending 40,000.00; labour 11,000.00 / 20,000.00), approve/pay/reject
  movement, provenance, invalid/mismatched lines.
- `src/trace.tsx` - trace page and invoice source-lines panel.
- `src/store.tsx` - localStorage persistence, revision-checked writes, `storage`
  event multi-tab refresh, explicit error states, confirmed reset.
- `src/pages.tsx`, `src/ui.tsx`, `src/App.tsx` - UI.

## Storage schema
Key `spend-tracker:v1`, value `{ "schema": "spend-tracker/v1", "state": SpendState }`.
SpendState = `{ revision, suppliers, afes, pars, invoices, decisions[] }`; amounts are
integer cents; decisions are `{ seq, invoiceId, action, from, to, role, reason, at }`
appended only by app actions. Missing key -> seeded from fixture. Invalid JSON,
wrong schema or broken references -> visible error, never silently reseeded.
Writes compare revision against storage first; a stale tab refuses and refreshes.

## Seed
Generated locally by `seedState()` from SCENARIO.md: 3 suppliers, AFE-100
(PAR-110, PAR-120), AFE-200 (PAR-210), invoices I1-I8. Baseline: pending 80,000.00,
approved-unpaid 40,000.00, paid 30,000.00, rejected 5,000.00 (excluded), committed
70,000.00, remaining 80,000.00, projected remaining 0. AFE-200: committed remaining
25,000.00, projected overrun 35,000.00 (I6 crosses the budget line).
