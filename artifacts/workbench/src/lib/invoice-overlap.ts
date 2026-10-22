import { ROW_FEATURE } from "./invoice-features";
/** Static source review, not a behavioral-equivalence certificate.
 * Cells cite only reviewed originals; decisions are derived from the saved recipe.
 */
export const invoiceApps = [
  { id: "invoice-finder", name: "Invoice Finder" },
  { id: "approval-desk", name: "Approval Desk" },
  { id: "spend-tracker", name: "Spend Tracker" },
] as const;
/** Deterministic registered ZIP hashes reviewed for this inventory. */
export const reviewedInvoiceHashes: Record<string, string> = {
  "invoice-finder": "066d67c19245bc1f541fc8216e2628153d64d4dd8df0afda79081bcf22dd7cc1",
  "approval-desk": "becd0a3739344838a36cb06917b70767ed2ebdac17d6dd8ea8e8b150f320465f",
  "spend-tracker": "d2e8642acad23ff6a45f3c6d00abbd33e0fa9599891242cf62643e80c945356f",
};
type Classification = "overlap" | "partial overlap" | "unique" | "unknown";
type Cell = { summary: string; paths: string[] };
type InventoryRow = {
  id: string; name: string; classification: Classification; cells: Record<string, Cell>;
  differences: string; capabilityId?: string;
  /** Source-reviewed combined baseline; not a selectable capability or verification claim. */
  baseline?: boolean;
  requiresReplay?: boolean;
};
const cell = (summary: string, ...paths: string[]): Cell => ({ summary, paths: ["capability-manifest.json", ...paths] });
export const invoiceInventory: InventoryRow[] = [
  { id: "search", name: "Invoice search", classification: "partial overlap", capabilityId: "fuzzy-search", cells: {
     "invoice-finder": cell("AND predicates, exclusions and ranked typo-tolerant search", "src/domain/search.ts", "src/domain/fuzzy.ts", "src/ui/ResultsTable.tsx", "tests/fuzzy.test.ts"),
    "approval-desk": cell("Queue text and stage filters", "src/pages.tsx"),
    "spend-tracker": cell("Text/normalized number and status search", "src/domain/model.ts", "src/domain/domain.test.ts"),
  }, differences: "Finder adds fuzzy ranking and predicate explanations. Approval Desk's stage filter is not equivalent to status filtering. No proof that Finder replaces every queue or reporting search interaction." },
   { id: "structured-filters", name: "Structured ranges and linked filters", classification: "unique", capabilityId: "fuzzy-search", cells: {
     "invoice-finder": cell("Supplier, inclusive date/CAD bounds, multiple statuses, AFE and dependent PAR; contradictory-range errors", "src/domain/search.ts", "src/ui/FilterPanel.tsx", "tests/domain.test.ts"),
   }, differences: "Only Finder exposes the full structured criteria model. Combined search must keep every bound AND-ed with text. The panel needs the fuzzy-search capability; within it, structured filters are a separately selectable function (structured-filters) and fuzzy ranking another (fuzzy-matching). A stage is not a status." },
   { id: "search-explanations", name: "Predicate and match explanations (gap)", classification: "unique", cells: {
     "invoice-finder": cell("Per-predicate exclusion counts and per-result match tier, score and explanation", "src/domain/search.ts", "src/domain/fuzzy.ts", "src/ui/ResultsTable.tsx", "tests/fuzzy.test.ts"),
   }, differences: "Remaining gap: combined results show tier/score, not Finder's per-predicate exclusion counts or explainReason text. Importing rankedSearch does not expose those separate explanation functions or replace ResultsTable. Search itself requires the fuzzy-search capability and the fuzzy-matching function." },
   { id: "search-url", name: "Shareable search context", classification: "unique", baseline: true, requiresReplay: true, cells: {
     "invoice-finder": cell("URL roundtrip of criteria and selected invoice", "src/ui/criteriaUrl.ts", "src/App.tsx"),
   }, differences: "Combined query-state.ts independently implements URL persistence for criteria, selected invoice, budget scope, stage and queue, preserving recipe/case parameters. It does not import Finder criteriaUrl.ts; parameter names and CAD encoding differ, so old Finder URL compatibility and full history-navigation parity are not claimed. Search fields are ignored when the search capability or functions are not selected." },
   { id: "duplicates", name: "Duplicate warnings", classification: "overlap", baseline: true, requiresReplay: true, cells: {
    "invoice-finder": cell("Supplier plus normalized number; checks all invoices", "src/domain/duplicates.ts", "tests/domain.test.ts"),
    "approval-desk": cell("Supplier plus normalized number over seed invoices", "src/domain/seed.ts", "src/pages.tsx"),
    "spend-tracker": cell("Supplier plus normalized number groups", "src/domain/model.ts", "src/domain/domain.test.ts"),
   }, differences: "Same supplier plus uppercase-alphanumeric number key, independently implemented in the originals; not shared code. Combined uses Finder's duplicate checks over the full adapted register, including filtered-out peers. Legacy configs (no featureIds) always show warnings; saved granular selections can exclude duplicate-warnings. Warnings neither block decisions nor deduplicate spend." },
   { id: "detail", name: "Invoice detail and navigation", classification: "partial overlap", baseline: true, requiresReplay: true, cells: {
     "invoice-finder": cell("Selected row detail, full-register duplicate peer links, decision history and context", "src/ui/InvoiceDetail.tsx", "src/ui/ResultsTable.tsx", "src/ui/criteriaUrl.ts"),
     "approval-desk": cell("Invoice routes, initial status, path reason and event history", "src/pages.tsx", "src/domain/ledger.ts"),
     "spend-tracker": cell("Invoice routes, AFE/PAR breadcrumbs, duplicates, history and source lines", "src/pages.tsx", "src/trace.tsx"),
   }, differences: "Combined invoice detail is a new shared page and the required invoice-details function, available without search, bulk or spend capabilities; duplicate peers depend on duplicate-warnings when granular selections are saved. Source lines remain spend-tracing-gated. Detail now offers single-record approve/reject gated by Approval Desk allowedActions (no pay). New URL-backed navigation is not reuse of the original routed screens; old route and browser-navigation parity is not established." },
  { id: "actions", name: "Approval and payment actions", classification: "partial overlap", capabilityId: "bulk-decisions", cells: {
    "invoice-finder": cell("Single record; reviewer approves, rejects or marks paid", "src/domain/workflow.ts", "tests/domain.test.ts"),
    "approval-desk": cell("Reviewer/controller stages; controller-only payment", "src/domain/ledger.ts", "src/domain/domain.test.ts"),
    "spend-tracker": cell("Single record; reviewer approves, rejects or marks paid", "src/domain/model.ts", "src/domain/domain.test.ts"),
  }, differences: "Approval Desk requires reasons for approval and rejection and two stages above $10,000. Finder/Tracker require only rejection reasons. The combined bulk UI and the shared detail's single-record controls support approve/reject, not payment. Role selectors simulate roles, not authorization." },
   { id: "payment", name: "Record payment (remaining gap)", classification: "partial overlap", cells: {
     "invoice-finder": cell("Reviewer marks a single approved invoice paid", "src/domain/workflow.ts", "src/ui/InvoiceDetail.tsx", "tests/domain.test.ts"),
     "approval-desk": cell("Only controller marks approved invoice paid; validated event replay", "src/domain/ledger.ts", "src/pages.tsx", "src/domain/domain.test.ts"),
     "spend-tracker": cell("Reviewer marks approved invoice paid; committed unchanged", "src/domain/model.ts", "src/pages.tsx", "src/domain/domain.test.ts"),
   }, differences: "Explicit remaining gap: the combined UI has no mark-paid command. Imported replay understanding pay events and showing seeded paid totals do not implement payment recording. Do not replace Approval Desk's controller-only rule with Finder/Tracker reviewer semantics." },
   { id: "queue", name: "Approval stages and actionable queue", classification: "unique", capabilityId: "bulk-decisions", requiresReplay: true, cells: {
     "approval-desk": cell("Reviewer/controller/mine/all-open views; approved invoices actionable only for controller payment; path explanation", "src/pages.tsx", "src/ui.tsx", "src/domain/ledger.ts", "src/domain/domain.test.ts"),
   }, differences: "Combined stage/queue controls use Approval Desk allowedActions, explicitly excluding pay; controls and their URL parameters are disabled without bulk-decisions. This is partial queue coverage only: controller payment, original queue landing/defaults and its AFE/PAR-name text search are not replaced. Stage display and detail requiredStages/stageReason remain baseline." },
   { id: "records", name: "Decision records", classification: "partial overlap", baseline: true, requiresReplay: true, cells: {
    "invoice-finder": cell("Append-only decision list alongside mutable status", "src/domain/workflow.ts", "src/domain/storage.ts", "tests/domain.test.ts"),
    "approval-desk": cell("Validated event replay, stages and batch IDs", "src/domain/ledger.ts", "src/domain/storage.ts", "src/domain/bulk.test.ts"),
    "spend-tracker": cell("Append-only decisions with state validation", "src/domain/model.ts", "src/domain/domain.test.ts"),
  }, differences: "The combined adapter always uses Approval Desk's replay model, even when bulk actions are disabled. Existing original histories are not migrated. Combined snapshot reset/undo is not a production immutable audit service." },
   { id: "audit", name: "Audit history presentation", classification: "partial overlap", baseline: true, requiresReplay: true, cells: {
     "invoice-finder": cell("Per-invoice decision list, sequence, role, time and rejection reason", "src/ui/InvoiceDetail.tsx", "src/domain/workflow.ts"),
     "approval-desk": cell("Searchable global ledger and invoice events, timestamps, stages and batch IDs", "src/pages.tsx", "src/domain/ledger.ts"),
     "spend-tracker": cell("Per-invoice decision history", "src/pages.tsx", "src/domain/model.ts"),
   }, differences: "Combined per-invoice detail and the Activity view read Approval Desk events; these are newly written UI, not imported screens, and are shown only when decision-history is selected (or in legacy configs). Both show timestamps; Approval Desk's global history search remains a presentation gap. Undo/reset can remove combined demo events, so append-only transition validation is not durable audit retention." },
   { id: "summary", name: "Spend summaries", classification: "partial overlap", capabilityId: "spend-tracing", requiresReplay: true, cells: {
    "invoice-finder": cell("Secondary AFE and overall status buckets", "src/domain/spend.ts", "tests/domain.test.ts"),
    "approval-desk": cell("AFE/overall totals from replayed current states", "src/domain/ledger.ts", "src/domain/domain.test.ts"),
    "spend-tracker": cell("PAR/AFE/portfolio totals, overruns and reconciliation", "src/domain/model.ts", "src/domain/domain.test.ts"),
   }, differences: "All use integer cents and approved-unpaid plus paid for committed spend, without double-counting paid; rejected is excluded and pending is projection only. Independent original totals implementations are not shared code. Combined budgets and lines are both gated by spend-tracing and operate on Approval Desk replayed state, not original browser stores." },
   { id: "budgets", name: "Portfolio, AFE and PAR budgets", classification: "partial overlap", capabilityId: "spend-tracing", requiresReplay: true, cells: {
     "invoice-finder": cell("Collapsed AFE/overall budgets, remaining and projected remaining, unaffected by search", "src/ui/SpendSummary.tsx", "src/domain/spend.ts"),
     "approval-desk": cell("AFE/overall budget and current-status buckets", "src/pages.tsx", "src/domain/ledger.ts"),
     "spend-tracker": cell("Portfolio/AFE/PAR rollups, allocation budgets, invoice counts and hierarchy drilldown", "src/pages.tsx", "src/domain/model.ts", "src/ui.tsx", "src/domain/domain.test.ts"),
   }, differences: "Tracker has the richer budget hierarchy. Combined coverage uses Tracker rollupPortfolio/rollupAfe/rollupPar against adapted replayed invoices, not Finder/Desk totals functions or their original budget screens. Full selected-scope metrics include paid, approved unpaid, remaining, committed/projected overruns and invoice count; AFE/PAR drilldowns list all scoped invoice rows, including rejected. Budget results remain independent of Find filters." },
   { id: "overrun", name: "Overrun trail and row reconciliation", classification: "unique", capabilityId: "spend-tracing", requiresReplay: true, cells: {
     "spend-tracker": cell("Committed vs projected overruns, ordered running trail/crossing invoice, independent row-to-rollup reconciliation", "src/domain/model.ts", "src/pages.tsx", "src/ui.tsx", "src/domain/domain.test.ts"),
   }, differences: "Distinct from group-to-invoice line reconciliation. Reuse Tracker overrunTrail/reconcile rather than infer overruns from a line-total tile. Combined presentation is a new implementation, not proof of original chart, route, sorting or explanation parity." },
  { id: "fuzzy", name: "Explainable fuzzy matching", classification: "unique", capabilityId: "fuzzy-search", cells: {
    "invoice-finder": cell("Ranked typo-tolerant matches and explanations", "src/domain/fuzzy.ts", "src/domain/search.ts", "tests/fuzzy.test.ts"),
  }, differences: "Distinctive Finder behavior; preserve it rather than replacing it with basic substring search. Unique within these reviewed source manifests, not an enterprise-wide uniqueness claim." },
  { id: "bulk", name: "Staged bulk decisions", classification: "unique", capabilityId: "bulk-decisions", cells: {
    "approval-desk": cell("Multi-select, eligibility preview, skipped reasons, stale refusal and batch records", "src/domain/bulk.ts", "src/domain/ledger.ts", "src/bulk.tsx", "src/domain/bulk.test.ts"),
  }, differences: "Must retain role/stage eligibility and atomic stale-preview refusal. Multi-select alone is not equivalent. Only the reviewed Approval Desk implementation supplies these controls." },
   { id: "lines", name: "Line-item spend tracing", classification: "unique", capabilityId: "spend-tracing", requiresReplay: true, cells: {
    "spend-tracker": cell("Materials/labour groups to original invoice lines, with reconciliation", "src/domain/lines.ts", "src/trace.tsx", "src/domain/lines.test.ts"),
  }, differences: "Line provenance and group-to-invoice reconciliation are distinct from a total-spend tile. Combined tracing uses Tracker's source lines against adapted current invoice states." },
   { id: "trace-navigation", name: "Group, source line and invoice navigation", classification: "unique", capabilityId: "spend-tracing", requiresReplay: true, cells: {
     "spend-tracker": cell("Portfolio/AFE/PAR and category scopes, group-to-source invoice links and invoice-to-group return links", "src/trace.tsx", "src/domain/lines.ts", "src/pages.tsx", "src/domain/lines.test.ts"),
   }, differences: "Combined trace source-line-to-invoice, invoice-line category return and budget-to-scope trace links are rebuilt URL-state controls using Tracker provenance, not imported trace routes. Original route and history parity are unverified. Source lines in detail are disabled with spend-tracing; baseline invoice/duplicate navigation remains available." },
   { id: "storage", name: "Persistence and freshness", classification: "partial overlap", baseline: true, requiresReplay: true, cells: {
    "invoice-finder": cell("Independent browser storage, errors and multi-tab refresh", "src/domain/storage.ts", "src/ui/useStore.ts"),
    "approval-desk": cell("Independent ledger storage, errors and multi-tab refresh", "src/domain/storage.ts", "src/store.ts"),
    "spend-tracker": cell("Independent state codec, errors and multi-tab refresh", "src/domain/model.ts", "src/store.tsx"),
  }, differences: "Separate schemas and storage keys remain independent. Combined storage is a new recipe-scoped ledger adapter, not a migration or removal of these implementations." },
   { id: "reset", name: "Confirmed reset", classification: "overlap", baseline: true, requiresReplay: true, cells: {
    "invoice-finder": cell("Confirmed reset of own demo state", "src/ui/ResetDialog.tsx", "src/App.tsx"),
    "approval-desk": cell("Confirmed reset of own demo ledger", "src/App.tsx", "src/pages.tsx"),
    "spend-tracker": cell("Confirmed reset of own demo state", "src/App.tsx", "src/store.tsx"),
  }, differences: "Original resets remain separate. Combined reset affects only its recipe snapshot, never the original applications." },
  { id: "production-auth", name: "Production authorization", classification: "unknown", cells: {},
    differences: "Manifests explicitly describe demo roles, not real authentication. Production authorization coverage and equivalence are unknown; no grants or permissions are changed by consolidation." },
];

type SavedConfiguration = {
  selectedSources: { id: string; sha256: string }[];
  capabilityIds: string[]; wiring: { edgeIds: string[] }; config?: unknown;
};
const wiring: Record<string, [string, string]> = {
  "fuzzy-search": ["invoice-finder", "invoice-to-search"],
  "bulk-decisions": ["approval-desk", "invoice-to-decisions"],
  "spend-tracing": ["spend-tracker", "invoice-to-spend"],
};
export function deriveInvoiceOverlap(c: SavedConfiguration) {
  const reviewed = c.selectedSources.every(s => reviewedInvoiceHashes[s.id] === s.sha256);
  const replaySourceSelected = c.selectedSources.some(s => s.id === "approval-desk" && s.sha256 === reviewedInvoiceHashes["approval-desk"]);
  const active = (cap: string) => {
    const [source, edge] = wiring[cap];
    return c.capabilityIds.includes(cap) && c.selectedSources.some(s => s.id === source) && c.wiring.edgeIds.includes(edge);
  };
  const rows = invoiceInventory.map(row => {
    let action: "retain" | "replace" | "combine" | "keep separate" = "keep separate";
    let implementation = "Original apps only; no combined replacement selected";
    let rationale = "Keep the original behavior available; the recipe does not replace this function.";
     const requiresReplaySource = !!row.requiresReplay;
    const enabled = reviewed && (!requiresReplaySource || replaySourceSelected)
       && (row.capabilityId ? active(row.capabilityId) : !!row.baseline);
    if (enabled && row.capabilityId) {
      const [source] = wiring[row.capabilityId];
       action = row.classification === "unique" ? "retain" : ["summary", "budgets"].includes(row.id) ? "combine" : "replace";
      implementation = `${invoiceApps.find(a => a.id === source)!.name} via the combined invoice adapter`;
      rationale = action === "retain" ? "Retain the distinctive source behavior in the saved configuration."
         : action === "combine" ? "Combine Tracker spend models with Approval Desk replayed invoice state; original stores and screens remain independent."
        : "Use the selected implementation for the combined flow; replacement of all original behavior remains proposed.";
    }
     if (enabled && row.baseline) {
      action = "combine";
       implementation = row.id === "duplicates" ? "Finder duplicate checks + full replayed register; combined baseline UI"
         : row.id === "records" ? "Approval Desk replay + recipe-scoped combined storage"
         : row.id === "search-url" ? "Independent combined URL-state adapter; no Finder URL-codec import"
         : row.id === "storage" || row.id === "reset" ? "New recipe-scoped browser adapter and controls; Approval Desk replay validation"
         : "New combined presentation over Approval Desk replayed invoice state";
       rationale = "Baseline coverage is independent of selectable search/spend capabilities, not proof of screen equivalence. The shared ledger always reuses Approval Desk replay; original stores and histories remain separate.";
    }
    const fids = (c.config as { featureIds?: unknown } | undefined)?.featureIds;
    const feat = ROW_FEATURE[row.id];
    if (enabled && feat && Array.isArray(fids) && !fids.includes(feat)) {
      action = "keep separate"; implementation = "Excluded in the saved function selection; original app only";
      rationale = "Capability is enabled, but this granular function was deselected, so the original behavior stays separate.";
      return { ...row, classification: reviewed ? row.classification : "unknown" as Classification, action, implementation, rationale, enabled: false };
    }
    if (requiresReplaySource && !replaySourceSelected) {
      implementation = "Proposal withheld: Approval Desk replay source is not selected and pinned";
      rationale = "The runtime adapter still imports Approval Desk replay, but that is an unresolved dependency outside this saved source selection, not evidence-backed consolidation. Select the reviewed Approval Desk source before proposing combined records or replay-based spend summaries.";
    }
    if (!reviewed) {
      implementation = "Unknown: selected source hash differs from this inventory's reviewed version";
      rationale = "Re-review the source evidence before proposing a consolidation decision.";
    }
    return { ...row, classification: reviewed ? row.classification : "unknown" as Classification, action, implementation, rationale, enabled };
  });
  return { rows, counts: {
    groups: rows.length,
    overlapGroups: rows.filter(r => r.classification === "overlap" || r.classification === "partial overlap").length,
    uniqueGroups: rows.filter(r => r.classification === "unique").length,
    unknownGroups: rows.filter(r => r.classification === "unknown").length,
    proposedGroups: rows.filter(r => r.action !== "keep separate").length,
    verifiedReplacements: 0, retiredApps: 0,
  } };
}
