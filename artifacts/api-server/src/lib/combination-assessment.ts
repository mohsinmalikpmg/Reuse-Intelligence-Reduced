import type { CombinationRequirement, CombinationRequirementAssessment } from "@workspace/api-zod";
import { analyze, AnalysisError } from "./ai-analysis";
import { assessmentSource, groundingInstructions, mappingShape, provenanceLabel, requirementMappingSchema } from "./assessment-evidence";

type Selection = {
  recipeId: string; capabilityIds: string[]; selectedSources: { id: string; version?: string; sha256?: string }[];
  wiring: { edgeIds: string[] }; config?: Record<string, unknown>; userId?: string; id?: string;
};

// These contracts bound the analysis; source/version hashes and actual implementation are fingerprinted too.
export const combinationEvidence = [
  { recipe: "invoice", id: "fuzzy-search", source: "invoice-finder", edge: "invoice-to-search", behavior: "Local invoice filtering and typo-tolerant fuzzy search. No external ERP query or performance SLA." },
  { recipe: "invoice", id: "bulk-decisions", source: "approval-desk", edge: "invoice-to-decisions", behavior: "Simulated approve/reject decisions over selected invoice IDs, respecting deterministic permissions. Not supplier payment, ERP posting, SSO or production approval transactions." },
  { recipe: "invoice", id: "spend-tracing", source: "spend-tracker", edge: "invoice-to-spend", behavior: "Integer-cent invoice totals traced through project/AFE/PAR to original invoice lines. Not a bank or external accounting integration." },
  { recipe: "finance", id: "forecast-projection", source: "budget-and-forecast", edge: "forecast-to-report", behavior: "Q4 forecast from explicit actuals and configured method; forecast is never actual spend. Not arbitrary annual budgeting or predictive ML." },
  { recipe: "finance", id: "management-reporting", source: "management-reporting", edge: "forecast-to-report", behavior: "Monthly management report with explicitly mapped accounts/cost centres and cents bridge. Not arbitrary custom reporting or live ERP integration." },
];

export async function assessCombination(requirements: CombinationRequirement[], selection: Selection, options: { force?: boolean; analyzer?: typeof analyze } = {}): Promise<CombinationRequirementAssessment[]> {
  if (selection.recipeId !== "invoice" && selection.recipeId !== "finance") throw new AnalysisError("Unknown combination recipe. No assessment was applied.", 400);
  if (!requirements.length) return [];
  const evidence = combinationEvidence.filter(e => e.recipe === selection.recipeId);
  const files = selection.recipeId === "finance"
    ? ["artifacts/finance-consolidation-demo/wiring-worker.py", "artifacts/finance-consolidation-demo/vendor/forecast/calculations.py", "artifacts/finance-consolidation-demo/vendor/reporting/reporting.py"]
    : ["artifacts/invoice-consolidation/src/domain/engine.ts", "artifacts/invoice-finder/src/domain/search.ts",
      "artifacts/approval-desk/src/domain/bulk.ts", "artifacts/approval-desk/src/domain/ledger.ts",
      "artifacts/spend-tracker/src/domain/lines.ts"];
  const source = await Promise.all(files.map(async file => ({ file, text: await assessmentSource(file) })));
  const active = evidence.filter(e => selection.capabilityIds.includes(e.id) && selection.selectedSources.some(s => s.id === e.source) && selection.wiring.edgeIds.includes(e.edge));
  const result = await (options.analyzer ?? analyze)({
    purpose: "combination-assessment", promptVersion: "combination-evidence-v1", force: options.force,
    instructions: `${groundingInstructions} Map requirements only to active supplied capabilities backed by the source/contract. complete means documented source alignment only, never a passed requirement test. A compound requirement with unsupported clauses is partial. Read-only and negative requests are constraints. No measured performance or external integrations inferred from local demos. Return JSON exactly: ${mappingShape}`,
    input: { requirements, scope: { userId: selection.userId, caseId: selection.id },
      selection: { recipeId: selection.recipeId, capabilityIds: selection.capabilityIds, selectedSources: selection.selectedSources,
        wiring: selection.wiring, config: selection.config }, contracts: evidence, active, source },
    schema: requirementMappingSchema(requirements.map(r => r.id), active.map(c => c.id)),
  });
  return requirements.map(r => {
    const m = result.data.requirements.find(m => m.id === r.id)!;
    return { ...r, status: m.constraint ? "constraint" : !m.capabilityIds.length ? "missing" : m.complete ? "covered" : "partial",
      capabilityIds: m.constraint ? [] : m.capabilityIds,
      note: `${m.reason}${m.limitations.length ? ` Limitations: ${m.limitations.join(" ")}` : ""} ${provenanceLabel(result.provenance)}` };
  });
}
