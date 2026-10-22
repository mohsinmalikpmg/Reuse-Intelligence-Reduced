import type { CombinationRequirement, CombinationRequirementAssessment } from "@workspace/api-zod";

type Selection = {
  recipeId: string;
  capabilityIds: string[];
  selectedSources: { id: string }[];
  wiring: { edgeIds: string[] };
};

// Recipe-specific mapping: never reuse the maintenance engine's capability evidence.
// Broad language is a partial match, not a promise of complete implementation.
const rules = [
  { recipe: "invoice", id: "fuzzy-search", source: "invoice-finder", edge: "invoice-to-search", label: "Invoice search",
    match: /\b(search|find|filter|fuzzy|typos?)\b/i,
    exact: /^(?:search|find|filter) (?:for )?invoices(?: (?:with|despite) typos)?[.!]?$/i },
  { recipe: "invoice", id: "bulk-decisions", source: "approval-desk", edge: "invoice-to-decisions", label: "Invoice approval",
    match: /\b(approv\w*|reject\w*|bulk decisions|sign.off)\b/i,
    exact: /^(?:(?:bulk |batch )?(?:approve|reject) (?:multiple |several |selected )?invoices(?: (?:in bulk|at once))?)[.!]?$/i },
  { recipe: "invoice", id: "spend-tracing", source: "spend-tracker", edge: "invoice-to-spend", label: "Spend tracing",
    match: /\b(spend|spending|trace|tracing|materials|labou?r)\b/i,
    exact: /^(?:track|trace|view|see) (?:project |afe |par )?(?:spend|spending)(?: (?:by project|by afe|by par|to invoice lines))?[.!]?$/i },
  { recipe: "finance", id: "forecast-projection", source: "budget-and-forecast", edge: "forecast-to-report", label: "Q4 forecast projection",
    match: /\b(forecast\w*|project(?:ion|ing)?|budget\w*)\b/i,
    exact: /^(?:create|calculate|project|generate) (?:a |the )?q4 forecast[.!]?$/i },
  { recipe: "finance", id: "management-reporting", source: "management-reporting", edge: "forecast-to-report", label: "Monthly management report",
    match: /\b(report\w*|management reporting)\b/i,
    exact: /^(?:create|generate|produce) (?:a |the )?monthly management report[.!]?$/i },
];
const constraint = /\b(must not|do not|don't|never|no automatic|read.only|without (?:writing|updating|posting|changing))\b/i;

export function assessCombination(requirements: CombinationRequirement[], selection: Selection): CombinationRequirementAssessment[] {
  return requirements.map(r => {
    if (constraint.test(r.text)) return { ...r, status: "constraint", capabilityIds: [], note: "Constraint to check when trying the combination." };
    const clauses = r.text.split(/\s+(?:and|also|plus)\s+|[;\n]+/i).map(s => s.trim()).filter(Boolean);
    const matched = rules.filter(rule => rule.recipe === selection.recipeId && rule.match.test(r.text));
    const active = matched.filter(rule => selection.capabilityIds.includes(rule.id)
      && selection.selectedSources.some(s => s.id === rule.source) && selection.wiring.edgeIds.includes(rule.edge));
    const covered = clauses.length > 0 && clauses.every(clause => active.some(rule => rule.exact.test(clause)));
    const absent = matched.filter(rule => !active.includes(rule));
    const status = covered ? "covered" : active.length ? "partial" : "missing";
    return {
      ...r, status, capabilityIds: active.map(rule => rule.id),
      note: covered ? "Matched to the selected, wired capabilities."
        : absent.length ? `${absent.map(rule => rule.label).join(", ")} is not included.`
        : active.length ? "Related capabilities are included; the full requirement still needs review."
        : "No matching capability in this combination.",
    };
  });
}
