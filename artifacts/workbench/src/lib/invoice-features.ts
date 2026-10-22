/** Invoice-only feature deconstruction over the shared @workspace/api-zod catalog.
 * Recommendations are deterministic keyword rules over the saved need/requirements, not AI.
 */
import { INVOICE_FEATURES, resolveInvoiceFeatures as sharedResolve, validateInvoiceExperience as sharedValidate, type InvoiceExperience } from "@workspace/api-zod";
export { INVOICE_FEATURES, type InvoiceExperience, type InvoiceFeature, type InvoiceFeatureId } from "@workspace/api-zod";
export const sharedResolveInvoiceFeatures = sharedResolve;
export const REQUIRED_FEATURES = ["invoice-details"];
export const byId = (id: string) => INVOICE_FEATURES.find((f) => f.id === id);

/** Lenient UI resolver: drops unavailable ids and broken dependents instead of throwing, then
 * confirms the result against the shared validator. Absent featureIds (legacy) = all available. */
export function resolveInvoiceFeatures(capabilityIds: string[], featureIds?: string[]): string[] {
  if (!featureIds) return sharedResolve(capabilityIds);
  const avail = sharedResolve(capabilityIds) as string[];
  const sel = new Set([...featureIds.filter((id) => avail.includes(id)), ...REQUIRED_FEATURES]);
  let changed = true;
  while (changed) { changed = false; for (const id of [...sel]) if (byId(id)?.requires.some((r) => !sel.has(r))) { sel.delete(id); changed = true; } }
  return sharedResolve(capabilityIds, INVOICE_FEATURES.map((f) => f.id).filter((id) => sel.has(id)));
}

export const EXPERIENCES: Record<InvoiceExperience, { name: string; needs: string[]; baseSourceId: string; landing: string }> = {
  "invoice-led": { name: "Invoice-led", needs: [], baseSourceId: "invoice-finder", landing: "Invoices" },
  "review-led": { name: "Review-led", needs: ["review-queue"], baseSourceId: "approval-desk", landing: "Review queue" },
  "budget-led": { name: "Budget-led", needs: ["budget-positions"], baseSourceId: "spend-tracker", landing: "Budgets" },
};

/** Mirrors the combined runtime: Invoices always; Review queue, Budgets, Activity only when their function is selected.
 * Order is fixed; the experience only picks the landing view (falls back to Invoices). Invoice detail is a shared
 * destination and spend tracing is a Budgets lens, neither is a nav item. */
export function proposedNav(featureIds: string[], experience: InvoiceExperience) {
  const has = (id: string) => featureIds.includes(id);
  const nav = ["Invoices", ...(has("review-queue") ? ["Review queue"] : []), ...(has("budget-positions") ? ["Budgets"] : []), ...(has("decision-history") ? ["Activity"] : [])];
  const want = EXPERIENCES[experience].landing;
  return { nav, landing: nav.includes(want) ? want : "Invoices" };
}

export function proposedJourneys(featureIds: string[], experience: InvoiceExperience): string[] {
  const has = (id: string) => featureIds.includes(id);
  const detailBits = [has("duplicate-warnings") && "duplicate warnings", has("decision-history") && "decision history"].filter(Boolean).join(" and ");
  const detail = `open the shared invoice detail${detailBits ? ` to check ${detailBits}` : ""}`;
  const find = has("fuzzy-matching") || has("structured-filters")
    ? `${[has("fuzzy-matching") && "fuzzy search", has("structured-filters") && "structured filters"].filter(Boolean).join(" and ")} on Invoices, then ${detail}`
    : `Browse the Invoices register (no search panel), then ${detail}`;
  const out: string[] = [];
  const review = has("review-queue") ? `Open the Review queue for your stage, preview a bulk approve/reject, confirm` : has("bulk-actions") ? `Select invoices, preview a bulk approve/reject, confirm` : "";
  const budget = has("budget-positions") ? `Open Budgets at portfolio/AFE/PAR, spot an overrun, drill to scoped invoices${has("spend-tracing") ? " or switch to the cost-lines lens to trace source lines" : ""}` : "";
  const { landing } = proposedNav(featureIds, experience);
  if (landing === "Review queue" && review) out.push(review);
  if (landing === "Budgets" && budget) out.push(budget);
  out.push(find.charAt(0).toUpperCase() + find.slice(1));
  if (review && !out.includes(review)) out.push(review);
  if (budget && !out.includes(budget)) out.push(budget);
  if (has("decision-history")) out.push("Use Activity to review recorded decisions and jump to an invoice");
  return out;
}

export function retainedPatterns(featureIds: string[]): string[] {
  const has = (id: string) => featureIds.includes(id);
  return [
    has("fuzzy-matching") && "Invoice Finder's ranked typo-tolerant matching, kept because substring search loses near-miss suppliers.",
    has("structured-filters") && "Invoice Finder's AND-ed structured criteria, kept because stage is not status and ranges must stay explicit.",
    has("bulk-actions") && "Approval Desk's staged bulk preview with skipped reasons and stale refusal, kept so eligibility stays visible before confirm.",
    has("review-queue") && "Approval Desk's per-stage queue, kept because reviewers and controllers work different sets.",
    has("budget-positions") && "Spend Tracker's portfolio > AFE > PAR rollup, kept because overruns are found by drilling scope.",
    has("spend-tracing") && "Spend Tracker's line provenance, kept as a Budgets lens linking back to invoices.",
    has("decision-history") && "Approval Desk's replayed event ledger, the only replay-validated record, shown in Activity and detail.",
    "Invoice detail is a new shared page in the combined app, not any original's side panel or routed screen.",
  ].filter(Boolean) as string[];
}

/** Non-throwing wrapper over the shared validator. */
export function validateInvoiceExperience(exp: string | undefined, featureIds: string[]): boolean {
  if (!exp) return false;
  try { sharedValidate(exp, featureIds); return true; } catch { return false; }
}

type Cfg = Record<string, unknown> | undefined | null;
export const savedFeatureIds = (cfg: Cfg) => (Array.isArray(cfg?.featureIds) ? (cfg!.featureIds as string[]) : undefined);
export const savedExperience = (cfg: Cfg) => (typeof cfg?.experience === "string" ? (cfg!.experience as string) : undefined);

/** Prune choices after a capability change. Legacy configs (no featureIds) are returned untouched. */
export function pruneInvoiceConfig(cfg: Cfg, capabilityIds: string[]): Record<string, unknown> {
  const base = { ...(cfg ?? {}) };
  const fids = savedFeatureIds(cfg);
  if (!fids) return base;
  const next = resolveInvoiceFeatures(capabilityIds, fids);
  const out: Record<string, unknown> = { ...base, schemaVersion: 1, featureIds: next };
  if (!validateInvoiceExperience(savedExperience(cfg), next)) delete out.experience;
  return out;
}

const KW: Record<string, RegExp> = {
  "fuzzy-matching": /\b(find|search|typo|lookup|look up|locate|match)/i,
  "structured-filters": /\b(filter|range|date|supplier|vendor|afe|par|criteria)/i,
  "duplicate-warnings": /\b(duplicate|double|dupe|same invoice)/i,
  "bulk-actions": /\b(bulk|batch|many|approve|reject|backlog)/i,
  "review-queue": /\b(queue|review|stage|controller|approval|approver)/i,
  "budget-positions": /\b(budget|overrun|afe|par|portfolio|commit|remaining)/i,
  "spend-tracing": /\b(line|trace|tracing|material|labou?r|reconcil)/i,
  "decision-history": /\b(audit|history|who|decision|trail|record)/i,
};
export type Rec = { featureIds: string[]; experience: InvoiceExperience; why: Record<string, string>; expWhy: string; baseSourceId: string; baseWhy: string };
export function recommendInvoice(texts: string[], capabilityIds: string[]): Rec {
  const avail = resolveInvoiceFeatures(capabilityIds);
  const why: Record<string, string> = {};
  const picked = new Set(REQUIRED_FEATURES);
  why["invoice-details"] = "Required: every journey lands on an invoice.";
  for (const f of INVOICE_FEATURES) {
    if (f.id in why || !avail.includes(f.id)) continue;
    const hit = texts.find((t) => KW[f.id]?.test(t));
    if (hit) { picked.add(f.id); why[f.id] = `Matches "${(hit.match(KW[f.id]) ?? [""])[0]}" in: "${hit.length > 90 ? hit.slice(0, 90) + "…" : hit}"`; }
  }
  for (const id of [...picked]) for (const r of byId(id)?.requires ?? []) if (!picked.has(r) && avail.includes(r)) { picked.add(r); why[r] = `Required by ${byId(id)?.name}.`; }
  const ids = resolveInvoiceFeatures(capabilityIds, [...picked]);
  const score = (re: RegExp) => texts.filter((t) => re.test(t)).length;
  const r = score(KW["review-queue"]) + score(KW["bulk-actions"]), b = score(KW["budget-positions"]) + score(KW["spend-tracing"]), i = score(KW["fuzzy-matching"]) + score(KW["structured-filters"]);
  let experience: InvoiceExperience = "invoice-led";
  let expWhy = `Invoice-led: search/lookup terms (${i}) lead or tie; also the safe default.`;
  if (r > i && r >= b && validateInvoiceExperience("review-led", ids)) { experience = "review-led"; expWhy = `Review-led: approval/queue terms (${r}) outnumber search (${i}) and budget (${b}).`; }
  else if (b > i && b > r && validateInvoiceExperience("budget-led", ids)) { experience = "budget-led"; expWhy = `Budget-led: budget/spend terms (${b}) outnumber search (${i}) and review (${r}).`; }
  const baseSourceId = EXPERIENCES[experience].baseSourceId;
  const baseWhy = `${EXPERIENCES[experience].name} journeys start in screens originally from ${baseSourceId}, so it is the closest matching base.`;
  return { featureIds: ids, experience, why, expWhy, baseSourceId, baseWhy };
}

/** Overlap inventory row -> granular feature. */
export const ROW_FEATURE: Record<string, string> = {
  search: "fuzzy-matching", fuzzy: "fuzzy-matching", "structured-filters": "structured-filters", duplicates: "duplicate-warnings",
  actions: "bulk-actions", bulk: "bulk-actions", queue: "review-queue", budgets: "budget-positions", summary: "budget-positions", overrun: "budget-positions",
  lines: "spend-tracing", "trace-navigation": "spend-tracing", records: "decision-history", audit: "decision-history",
};
