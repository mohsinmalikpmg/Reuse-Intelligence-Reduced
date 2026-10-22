# Invoice consolidation: bounded source audit

## Granular Workbench and integrated journeys verification

### Change boundary

The invoice feature/experience work does not modify CodeAssessment, DiscoveryPlan, discovery composition materialization, or the invoice/finance discovery handoff. Those changes predate this invoice work and belong to the separate discovery composition effort. Verification here starts from a saved combined invoice case in the Workbench; it does not certify single-source Discover recommendations or proposal-only composition materialization. Preserve that boundary rather than restoring an older discovery shortcut as part of invoice UX work.

The follow-up desktop pass used a new synthetic case and verified actual Workbench checkbox changes, explicit save/reload, and running the saved revision. An unsaved draft did not affect the run. A reduced feature set with a budget-led start persisted; restoring the full set with a review-led start opened the queue. The deterministic recommendation remained visibly distinct from the manually selected starting view.

Viewer refusal, I1 reviewer approval, I6 reviewer-to-controller progression and controller approval were exercised from the invoice register. Detail/back navigation, Activity timestamps and three recorded events, budget effects after reload, and light/dark layouts were verified. Queue-originated approvals were not separately exercised. Temporary authentication overrides were cleared; no original registrations or source files changed.

Type checks passed for shared libraries, API, Workbench and Invoice Operations. Executed suites cover 13 runtime integration cases, 8 API/configuration cases, 8 overlap/source-evidence cases, 7 recommendation/navigation cases and 4 embedded-recipe checks. No production readiness or full original-screen equivalence claim follows from these checks.

## Executed combined verification

The results in this section and the static review below predate granular function selection, the Activity view and single-record detail decisions unless stated otherwise.

The completed change passed the combined TypeScript check, 9 domain integration tests, 4 embedded-recipe tests, and 7 inventory/source-hash checks. Original registered archive hashes were unchanged.

One isolated desktop browser pass verified inclusive and reversed ranges, combined fuzzy/structured filters, zero results/reset and selection clearing, cross-filter duplicate navigation, missing IDs, budget/drilldown/trace links, reviewer/controller stages and viewer restrictions, reason validation, reload persistence, reset cancellation, light/dark switching and three browser-intercepted disabled-capability recipes. No console/page errors were captured. No real saved case or original application state was modified. Malformed date-string URL parsing, inaccessible storage and multi-tab races were not exercised in that pass. These checks establish the stated combined behaviors, not complete original-screen equivalence or production readiness.

## Scope and evidence

This is a static screen/domain review, **not behavioral equivalence or browser verification**. The original applications remain independent and untouched; no app is retired, no history is migrated, and no development/maintenance saving is measured. No discovery routing, package builder or authorization change is part of this audit.

The registered original ZIP SHA-256 pins remain:

| Original | Reviewed archive SHA-256 |
| --- | --- |
| Invoice Finder | `066d67c19245bc1f541fc8216e2628153d64d4dd8df0afda79081bcf22dd7cc1` |
| Approval Desk | `becd0a3739344838a36cb06917b70767ed2ebdac17d6dd8ea8e8b150f320465f` |
| Spend Tracker | `d2e8642acad23ff6a45f3c6d00abbd33e0fa9599891242cf62643e80c945356f` |

Machine-readable feature groups, original paths and saved-configuration proposals live in `artifacts/workbench/src/lib/invoice-overlap.ts`. Its evidence cells cite files in each original's registered capability manifest; their paths are relative to `artifacts/<original>/`. “Overlap” describes independently implemented functions, not common imports or interchangeable semantics.

## Reviewed original behavior and combined implementation

Combined paths below are relative to `artifacts/invoice-consolidation/`. These implementation statements include inspection of the newly written UI files, not just the original adapter.

| Feature | Original evidence | Combined status / reuse boundary |
| --- | --- | --- |
| Structured search | Finder `src/domain/search.ts`, `src/domain/fuzzy.ts`, `src/ui/FilterPanel.tsx`, `src/ui/ResultsTable.tsx` | `src/domain/engine.ts` imports `compileCriteria`/`rankedSearch`. `src/components/operations-desk.tsx` exposes supplier, inclusive dates/CAD bounds, multi-status, AFE/dependent PAR and exact/fuzzy mode, with explicit range errors. New input parsing/presentation, not imported FilterPanel. |
| Search URL context | Finder `src/ui/criteriaUrl.ts` | `src/components/ops/query-state.ts` independently implements query patches/popstate; preserves recipe/case params and selected invoice, filters, budget scope, stage/queue. Not Finder codec reuse or old-URL compatibility. |
| Detail / duplicates | Finder `src/domain/duplicates.ts`, `src/ui/InvoiceDetail.tsx`; Desk/Tracker `src/pages.tsx` | `src/components/ops/invoice-detail.tsx` imports Finder `duplicateIndex`, Desk `requiredStages`/`stageReason`; shows full-register duplicate peers, invoice fields, seed/current state, timestamped events and single-record approve/reject via Desk `allowedActions` (no pay). Duplicate peers and events follow the `duplicate-warnings`/`decision-history` selections when saved. Register duplicate warnings also use the full register. Immutable scenario ID is navigation identity; invoice number is not unique. |
| Stages / queue | Desk `src/pages.tsx`, `src/domain/ledger.ts`, `src/bulk.tsx` | Bulk-gated register stage and role-queue controls use original `allowedActions`, excluding payment; their URL params are ignored when disabled. Baseline detail shows original threshold reasoning. This is not the original all-open/mine queue's landing defaults or text-search semantics. |
| Bulk decisions | Desk `src/domain/bulk.ts`, `src/domain/ledger.ts` | Engine imports `previewBulk`/`applyBulk`/`replay`. New UI previews eligible/skipped reasons, re-reads storage before apply and retains stage transitions, stale refusal and batch IDs. Approve/reject only. |
| Budget hierarchy / overrun | Tracker `src/domain/model.ts`, `src/pages.tsx`, `src/ui.tsx`; Finder `src/domain/spend.ts`, Desk `src/domain/ledger.ts` | `src/components/ops/budget-view.tsx` directly imports Tracker `rollupPortfolio`, `rollupAfe`, `rollupPar`, `reconcile`, `overrunTrail`. Uses engine `spendState` over Desk replay, not Finder/Desk totals functions. Full scope metrics, portfolio/AFE/PAR tables, all scoped invoice drill rows including rejected, row reconciliation status and linked running trail; independent of Find filters. Committed and projected overruns are distinguished. Not original charts/screens. |
| Lines / tracing | Tracker `src/domain/lines.ts`, `src/trace.tsx` | Engine imports `groupTrace`/`tracedLines`; detail imports `linesOfInvoice`. New category/scope controls, bucket reconciliation, source-line-to-invoice links, invoice-line category return links, budget-to-scope trace links and invoice line totals. Uses original source lines with current replayed status. |
| Records / audit | Desk `src/domain/ledger.ts`, `src/pages.tsx`; Finder workflow/detail and Tracker model/pages | Always imports Desk validated replay, including when bulk UI is disabled. New per-invoice/global lists expose sequence, role, reason, transition and batch identity; original histories are separate. |
| Storage / reset | Finder storage/useStore/ResetDialog; Desk storage/store/App/pages; Tracker model/store/App | Engine read/save codec plus recipe-scoped key is new code, not original stores. UI has matching-key storage-event refresh, retry/errors, undo-last-batch and confirmation dialog for reset, including corrupt-storage recovery. Reset removes only this snapshot key. |

## Runtime architecture and granular functions

Saved cases may carry `config.featureIds` and `config.experience` (shared `@workspace/api-zod` catalog; absent `featureIds` = all functions of enabled capabilities). The runtime resolves them in `recipeFromCase`/`src/domain/recipe.ts`. Navigation is fixed: Invoices always, then Review queue, Budgets and Activity only when `review-queue`, `budget-positions` and `decision-history` are selected. Experience changes only the landing view (falling back to Invoices), not order or screen variants. Invoice detail is a shared destination, not a nav item; spend tracing is a Budgets lens. Workbench's function chooser (`artifacts/workbench/src/components/invoice-features.tsx`) mirrors this and the overlap inventory marks deselected functions "keep separate".

Verification scope for this layer: Workbench typecheck and `src/lib/invoice-features.test.ts` (recommendation, selection, pruning, proposed nav/journeys) were run. No browser pass was run for granular selections; the browser pass described above predates it.

## Disabled capabilities and source dependencies

- `fuzzy-search` gates the whole search panel, including exact and structured criteria—not just typo matching.
- `spend-tracing` gates budgets, rollups, tracing and invoice source lines.
- `bulk-decisions` gates selection, stage/queue filters, approve/reject preview/apply and undo.
- Invoice detail, stage display/reasoning and confirmed snapshot reset are baseline. Duplicate warnings and history/Activity are baseline in legacy configs (no `featureIds`) but can be excluded by saved granular selections; within enabled capabilities, fuzzy matching, structured filters, bulk actions, review queue, budget positions and spend tracing are each selectable.
- Runtime imports are not pruned by source selection: Finder fixtures/duplicate checks and Desk replay still exist even in a recipe omitting those sources. In particular, the inventory **withholds replay-dependent proposals when the reviewed Approval Desk source is not selected and pinned**. A two-source runtime result is not evidence that the omitted replay dependency disappeared.

## Remaining gaps and verification boundary

1. **Payment:** no combined mark-paid command. Desk permits controller-only payment; Finder/Tracker allow reviewer payment. Seeded paid totals and replay accepting pay events do not close this gap. No real payments or production authorization exist.
2. Finder predicate-exclusion counts and human-readable match reasons are not shown; tier/score alone is partial explainability.
3. Activity now shows global ledger timestamps; Approval Desk's global history search is still not reproduced. Undo/reset remove demo events: transition replay validation is not durable immutable audit retention.
4. Single-record approve/reject now exists in the shared invoice detail (gated by role/stage `allowedActions`; no pay). No original route, screen, budget-bar, per-bucket reconciliation-table or browser-history parity claim.

Final source recheck confirmed reset storage failures are caught and surfaced, and the trail label distinguishes an already-committed overrun from a pending crossing.

`artifacts/api-server/tests/invoice-overlap.test.ts` checks reviewed archive/evidence membership, counts, capability/source/wiring gates, baseline coverage, explicit gaps and missing-replay warnings. Overlap tests (now including a granular-exclusion test) were re-run from the repository root with tsx (`node node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs --test artifacts/api-server/tests/invoice-overlap.test.ts`) after this wording refresh: **8 of 8 passed**. The earlier esbuild/CJS procedure below also remains valid, including unchanged original archive hashes and registered/manifest-backed evidence paths. Executed from repository root with API Server esbuild, CJS output to `/tmp/invoice-overlap-audit.test.cjs`, `import.meta.url` defined to that file URL, and `NODE_PATH` pointing to API Server dependencies for `node --test`. Combined domain tests are in `src/domain/integration.test.ts`; originals retain their own domain/fuzzy/bulk/line tests. Browser verification and its exclusions are summarized above.
