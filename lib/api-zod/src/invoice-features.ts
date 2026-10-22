/** Reviewed invoice features. Baseline features do not require an optional capability. */
export type InvoiceFeatureId = "fuzzy-matching" | "structured-filters" | "duplicate-warnings" | "invoice-details" |
  "bulk-actions" | "review-queue" | "budget-positions" | "spend-tracing" | "decision-history";
export interface InvoiceFeature {
  id: InvoiceFeatureId;
  name: string;
  description: string;
  capabilityId?: string;
  requires: string[];
  sourceId: string;
  sourcePaths: string[];
}
export const INVOICE_FEATURES: InvoiceFeature[] = [
  { id: "fuzzy-matching", name: "Fuzzy matching", description: "Find invoices with typo-tolerant supplier and invoice text.", capabilityId: "fuzzy-search", requires: [], sourceId: "invoice-finder", sourcePaths: ["artifacts/invoice-finder/src/domain/fuzzy.ts", "artifacts/invoice-finder/src/domain/search.ts"] },
  { id: "structured-filters", name: "Structured filters", description: "Combine supplier, date, amount, status, AFE and PAR criteria.", capabilityId: "fuzzy-search", requires: [], sourceId: "invoice-finder", sourcePaths: ["artifacts/invoice-finder/src/domain/search.ts"] },
  { id: "duplicate-warnings", name: "Duplicate warnings", description: "Identify duplicate invoices without merging their identities.", requires: [], sourceId: "invoice-finder", sourcePaths: ["artifacts/invoice-finder/src/domain/duplicates.ts"] },
  { id: "invoice-details", name: "Invoice details", description: "Inspect the shared invoice records and stable invoice identities.", requires: [], sourceId: "invoice-finder", sourcePaths: ["artifacts/invoice-finder/src/domain/types.ts"] },
  { id: "bulk-actions", name: "Bulk actions", description: "Preview and apply role-checked decisions to selected invoices.", capabilityId: "bulk-decisions", requires: [], sourceId: "approval-desk", sourcePaths: ["artifacts/approval-desk/src/domain/bulk.ts"] },
  { id: "review-queue", name: "Review queue", description: "Work through pending invoices using staged approval decisions.", capabilityId: "bulk-decisions", requires: ["bulk-actions"], sourceId: "approval-desk", sourcePaths: ["artifacts/approval-desk/src/domain/ledger.ts", "artifacts/approval-desk/src/domain/bulk.ts"] },
  { id: "budget-positions", name: "Budget positions", description: "Reconcile budget, committed, pending and remaining amounts.", capabilityId: "spend-tracing", requires: [], sourceId: "spend-tracker", sourcePaths: ["artifacts/spend-tracker/src/domain/model.ts"] },
  { id: "spend-tracing", name: "Spend tracing", description: "Trace budget buckets back to original invoice source lines.", capabilityId: "spend-tracing", requires: ["budget-positions"], sourceId: "spend-tracker", sourcePaths: ["artifacts/spend-tracker/src/domain/lines.ts"] },
  { id: "decision-history", name: "Decision history", description: "Inspect recorded decisions and replayed invoice state; demo undo/reset can remove events.", requires: [], sourceId: "approval-desk", sourcePaths: ["artifacts/approval-desk/src/domain/ledger.ts"] },
];

export type InvoiceExperience = "invoice-led" | "review-led" | "budget-led";

/** Absent selection preserves the legacy broad-capability behavior. Explicit choices never auto-add dependencies. */
export function resolveInvoiceFeatures(capabilityIds: string[], featureIds?: string[]): InvoiceFeatureId[] {
  const available = INVOICE_FEATURES.filter(f => !f.capabilityId || capabilityIds.includes(f.capabilityId));
  if (featureIds === undefined) return available.map(f => f.id);
  if (!Array.isArray(featureIds) || featureIds.some(id => typeof id !== "string"))
    throw new Error("Invoice featureIds must be an array of strings.");
  if (new Set(featureIds).size !== featureIds.length) throw new Error("Duplicate invoice feature selection.");
  for (const id of featureIds) {
    const feature = INVOICE_FEATURES.find(f => f.id === id);
    if (!feature) throw new Error(`Unknown invoice feature: ${id}.`);
    if (!available.some(f => f.id === id)) throw new Error(`Invoice feature ${id} requires capability ${feature.capabilityId}.`);
    for (const dependency of feature.requires)
      if (!featureIds.includes(dependency)) throw new Error(`Invoice feature ${id} requires ${dependency}.`);
  }
  if (!featureIds.includes("invoice-details")) throw new Error("Invoice feature invoice-details is required.");
  return INVOICE_FEATURES.filter(f => featureIds.includes(f.id)).map(f => f.id);
}

/** Validate without inserting a default into persisted legacy configuration. */
export function validateInvoiceExperience(experience: unknown, features: readonly string[]): InvoiceExperience {
  if (experience === undefined) return "invoice-led";
  if (experience !== "invoice-led" && experience !== "review-led" && experience !== "budget-led")
    throw new Error("Unknown invoice experience.");
  const required = experience === "review-led" ? "review-queue" : experience === "budget-led" ? "budget-positions" : undefined;
  if (required && !features.includes(required)) throw new Error(`Invoice experience ${experience} requires ${required}.`);
  return experience;
}
