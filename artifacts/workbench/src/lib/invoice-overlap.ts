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
};
const cell = (summary: string, ...paths: string[]): Cell => ({ summary, paths: ["capability-manifest.json", ...paths] });
export const invoiceInventory: InventoryRow[] = [
  { id: "search", name: "Invoice search", classification: "partial overlap", capabilityId: "fuzzy-search", cells: {
    "invoice-finder": cell("Combined predicates, exclusions and ranked typo-tolerant search", "src/domain/search.ts", "src/domain/fuzzy.ts", "tests/fuzzy.test.ts"),
    "approval-desk": cell("Queue text and stage filters", "src/pages.tsx"),
    "spend-tracker": cell("Text/normalized number and status search", "src/domain/model.ts", "src/domain/domain.test.ts"),
  }, differences: "Finder adds fuzzy ranking and predicate explanations. Approval Desk's stage filter is not equivalent to status filtering. No proof that Finder replaces every queue or reporting search interaction." },
  { id: "duplicates", name: "Duplicate warnings", classification: "overlap", cells: {
    "invoice-finder": cell("Supplier plus normalized number; checks all invoices", "src/domain/duplicates.ts", "tests/domain.test.ts"),
    "approval-desk": cell("Supplier plus normalized number over seed invoices", "src/domain/seed.ts", "src/pages.tsx"),
    "spend-tracker": cell("Supplier plus normalized number groups", "src/domain/model.ts", "src/domain/domain.test.ts"),
  }, differences: "Same functional key, independently implemented. Warning placement and data lifecycle differ. The combined operations UI does not expose duplicate warnings; do not count these as replaced." },
  { id: "actions", name: "Approval and payment actions", classification: "partial overlap", capabilityId: "bulk-decisions", cells: {
    "invoice-finder": cell("Single record; reviewer approves, rejects or marks paid", "src/domain/workflow.ts", "tests/domain.test.ts"),
    "approval-desk": cell("Reviewer/controller stages; controller-only payment", "src/domain/ledger.ts", "src/domain/domain.test.ts"),
    "spend-tracker": cell("Single record; reviewer approves, rejects or marks paid", "src/domain/model.ts", "src/domain/domain.test.ts"),
  }, differences: "Approval Desk requires reasons for approval and rejection and two stages above $10,000. Finder/Tracker require only rejection reasons. The combined bulk UI supports approve/reject, not payment. Role selectors simulate roles, not authorization." },
  { id: "records", name: "Decision records", classification: "partial overlap", cells: {
    "invoice-finder": cell("Append-only decision list alongside mutable status", "src/domain/workflow.ts", "src/domain/storage.ts", "tests/domain.test.ts"),
    "approval-desk": cell("Validated event replay, stages and batch IDs", "src/domain/ledger.ts", "src/domain/storage.ts", "src/domain/bulk.test.ts"),
    "spend-tracker": cell("Append-only decisions with state validation", "src/domain/model.ts", "src/domain/domain.test.ts"),
  }, differences: "The combined adapter always uses Approval Desk's replay model, even when bulk actions are disabled. Existing original histories are not migrated. Combined snapshot reset/undo is not a production immutable audit service." },
  { id: "summary", name: "Spend summaries", classification: "partial overlap", capabilityId: "spend-tracing", cells: {
    "invoice-finder": cell("Secondary AFE and overall status buckets", "src/domain/spend.ts", "tests/domain.test.ts"),
    "approval-desk": cell("AFE/overall totals from replayed current states", "src/domain/ledger.ts", "src/domain/domain.test.ts"),
    "spend-tracker": cell("PAR/AFE/portfolio totals, overruns and reconciliation", "src/domain/model.ts", "src/domain/domain.test.ts"),
  }, differences: "All use integer cents and approved-unpaid plus paid for committed spend. Tracker has richer scope and drilldowns. The combined view combines staged state with line groups; not every original overrun explanation or report is reproduced." },
  { id: "fuzzy", name: "Explainable fuzzy matching", classification: "unique", capabilityId: "fuzzy-search", cells: {
    "invoice-finder": cell("Ranked typo-tolerant matches and explanations", "src/domain/fuzzy.ts", "src/domain/search.ts", "tests/fuzzy.test.ts"),
  }, differences: "Distinctive Finder behavior; preserve it rather than replacing it with basic substring search. Unique within these reviewed source manifests, not an enterprise-wide uniqueness claim." },
  { id: "bulk", name: "Staged bulk decisions", classification: "unique", capabilityId: "bulk-decisions", cells: {
    "approval-desk": cell("Multi-select, eligibility preview, skipped reasons, stale refusal and batch records", "src/domain/bulk.ts", "src/domain/ledger.ts", "src/bulk.tsx", "src/domain/bulk.test.ts"),
  }, differences: "Must retain role/stage eligibility and atomic stale-preview refusal. Multi-select alone is not equivalent. Only the reviewed Approval Desk implementation supplies these controls." },
  { id: "lines", name: "Line-item spend tracing", classification: "unique", capabilityId: "spend-tracing", cells: {
    "spend-tracker": cell("Materials/labour groups to original invoice lines, with reconciliation", "src/domain/lines.ts", "src/trace.tsx", "src/domain/lines.test.ts"),
  }, differences: "Line provenance and group-to-invoice reconciliation are distinct from a total-spend tile. Combined tracing uses Tracker's source lines against adapted current invoice states." },
  { id: "storage", name: "Persistence and freshness", classification: "partial overlap", cells: {
    "invoice-finder": cell("Independent browser storage, errors and multi-tab refresh", "src/domain/storage.ts", "src/ui/useStore.ts"),
    "approval-desk": cell("Independent ledger storage, errors and multi-tab refresh", "src/domain/storage.ts", "src/store.ts"),
    "spend-tracker": cell("Independent state codec, errors and multi-tab refresh", "src/domain/model.ts", "src/store.tsx"),
  }, differences: "Separate schemas and storage keys remain independent. Combined storage is a new recipe-scoped ledger adapter, not a migration or removal of these implementations." },
  { id: "reset", name: "Confirmed reset", classification: "overlap", cells: {
    "invoice-finder": cell("Confirmed reset of own demo state", "src/ui/ResetDialog.tsx", "src/App.tsx"),
    "approval-desk": cell("Confirmed reset of own demo ledger", "src/App.tsx", "src/pages.tsx"),
    "spend-tracker": cell("Confirmed reset of own demo state", "src/App.tsx", "src/store.tsx"),
  }, differences: "Original resets remain separate. Combined reset affects only its recipe snapshot, never the original applications." },
  { id: "production-auth", name: "Production authorization", classification: "unknown", cells: {},
    differences: "Manifests explicitly describe demo roles, not real authentication. Production authorization coverage and equivalence are unknown; no grants or permissions are changed by consolidation." },
];

type SavedConfiguration = {
  selectedSources: { id: string; sha256: string }[];
  capabilityIds: string[]; wiring: { edgeIds: string[] };
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
    const requiresReplaySource = row.id === "records" || row.id === "summary";
    const enabled = reviewed && (!requiresReplaySource || replaySourceSelected)
      && (row.capabilityId ? active(row.capabilityId) : row.id === "records");
    if (enabled && row.capabilityId) {
      const [source] = wiring[row.capabilityId];
      action = row.classification === "unique" ? "retain" : row.id === "summary" ? "combine" : "replace";
      implementation = `${invoiceApps.find(a => a.id === source)!.name} via the combined invoice adapter`;
      rationale = action === "retain" ? "Retain the distinctive source behavior in the saved configuration."
        : action === "combine" ? "Combine Tracker line groups with Approval Desk replayed invoice state."
        : "Use the selected implementation for the combined flow; replacement of all original behavior remains proposed.";
    }
    if (reviewed && replaySourceSelected && row.id === "records") {
      action = "combine";
      implementation = "Approval Desk replay + recipe-scoped combined storage";
      rationale = "The shared ledger always reuses Approval Desk replay, independently of which capabilities are visible. Original histories remain separate.";
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
