# Invoice Finder (synthetic single-browser demo)

Helps an invoice analyst pinpoint a suspect bill without losing context: combined search,
invoice detail with duplicate warnings computed against ALL invoices, a simulated
approve/reject/pay flow, and a spend summary. Synthetic data only; not official company
software or branding. No real authentication, enterprise authorization, approvals or payments.

## Run
Requires Node 24 and pnpm 10 (verified with Node 24.13 and pnpm 10.26).

    pnpm install --frozen-lockfile
    pnpm run dev        # PORT defaults to 5173, BASE_PATH defaults to /
    pnpm test           # node --experimental-strip-types --test tests/*.test.ts (domain + fuzzy)
    pnpm run typecheck
    pnpm run build      # output: dist/public

Extract the ZIP into its own directory first. It has no monorepo imports.
Use different PORT values if running the three originals simultaneously.
`pnpm run serve` serves the build. No secrets, database service or migration needed.
`python3 package-source.py` reproduces a content-addressed source ZIP using the
explicit `package-files.json` allowlist. `source-hashes.json` in the ZIP records
every included source file. Build outputs, saved browser data, credentials,
dependencies, and conversations are never packaged. See `DEMONSTRATION.md`.

## Source A standout: fuzzy search
The default screen is a search box. `src/domain/fuzzy.ts` implements typo-tolerant,
explainable matching over supplier names, invoice numbers and invoice IDs:
- case and punctuation ignored (`bp 100`, `B.P/100`, `bp-100` all hit BP-100);
- multi-word queries AND every word (`borel parts` -> Boreal Parts, `praire servces` -> Prairie Services);
- each word tries exact, then prefix/partial; only when no invoice in the ledger matches that
  word exactly does it fall back to Damerau-Levenshtein (1 edit at 4-6 letters, 2 at 7+,
  invoice numbers max 1). Words under 4 letters never match approximately, so nonsense finds nothing;
- results rank exact tier first, then score, then ledger order; each row shows "Exact"/"Close"
  and a sentence per word explaining why it matched;
- an Exact/Fuzzy mode toggle (`mode=exact` in the URL) and labeled try-example buttons.
Close invoice-number matches (e.g. `PS-204`) are search suggestions only. Strict duplicate
warnings remain exact normalized supplier + number and never use fuzzy similarity.
The spend summary is a collapsed secondary reference at the bottom. Decisions are single-record only.

## Design
- Flat invoice records (`src/domain/types.ts`): every searchable field lives on the row.
- Predicate search engine (`src/domain/search.ts`): criteria compile to labelled predicates
  combined with AND (supplier, text, inclusive dates, inclusive min/max cents, statuses, AFE, PAR).
  Each predicate also reports how many invoices it excludes on its own, shown above results.
- Duplicates (`src/domain/duplicates.ts`): supplier + invoice number normalized to uppercase
  alphanumerics, always over the full list. Warnings never block decisions or remove amounts.
- Workflow (variant A/C, `src/domain/workflow.ts`): demo reviewer approves or rejects pending
  (reject needs a nonblank reason); approved may be marked paid. Paid/rejected are terminal.
  Viewer is read-only. The role switch is a demo control, not authentication.
- Spend (`src/domain/spend.ts`): pending, approved-unpaid, paid, rejected, committed
  (approved-unpaid + paid), remaining, projected remaining after pending.

## Storage schema
localStorage key `invoice-finder:v1:state`:

    { schemaVersion: 1, suppliers[], afes[{id,name,budgetCents}],
      pars[{id,afeId,name,allocationCents}],
      invoices[{id,supplierId,invoiceNumber,date,cents,afeId,parId,status}],
      decisions[{seq,invoiceId,action,from,to,role,reason,at}] }

Seed: on first load (key absent) the fixture in `src/domain/fixture.ts` (matching SCENARIO.md)
is written. Corrupt or invalid data (bad JSON, wrong version, missing supplier/PAR/AFE refs)
is shown as an error and never silently reseeded; reset is explicit and confirmed.
Other tabs update via the `storage` event. Search state is kept in the URL query.
Browser storage is not a security boundary or tamper-proof audit record.
