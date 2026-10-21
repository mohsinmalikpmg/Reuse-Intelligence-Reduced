/**
 * Reuse check as a service: scores the need, records the event, returns the result. Shared by the reuse-check
 * endpoint and by every gate that runs the check as a side effect (adding a requirement in the workbench).
 */
import type { Case, ReuseCheckResult, ReuseTrigger, Solution } from "@workspace/api-zod";
import { personas } from "../data/catalog";
import { caseContext } from "./configuration";
import { IMPROVE_AT, inferWorkflowSteps, reuseCheck, scoreCapability } from "./reuse-check";
import { insertReuseEvent } from "./reuse-store";
import { listCaseRows } from "./store";
import { versionACapabilities } from "./workbench";

const ACTIVE_CASE_STATUSES = new Set(["draft", "tested", "pilot_proposed", "approved", "changes_requested"]);

export async function performReuseCheck(input: {
  need: string;
  trigger: ReuseTrigger;
  base: Solution | null;
  caseId?: string | null;
  briefId?: string | null;
  workflowStep?: string | null;
}): Promise<ReuseCheckResult> {
  const need = input.need.trim();
  const experiments = (await listCaseRows()).filter((x) => ACTIVE_CASE_STATUSES.has(x.status) && x.id !== input.caseId);
  const outcome = reuseCheck(need, { base: input.base, experiments, workflowStep: input.workflowStep ?? null });
  const event = await insertReuseEvent({
    trigger: input.trigger,
    need,
    baseSolutionId: input.base?.id ?? null,
    caseId: input.caseId ?? null,
    briefId: input.briefId ?? null,
    bestScore: outcome.best?.score ?? null,
    bestTitle: outcome.best?.title ?? null,
    bestSolutionId: outcome.best?.solutionId ?? null,
    bestCapabilityId: outcome.best?.capability?.id ?? null,
    pathRecommended: outcome.recommendedPath,
    pathTaken: null,
    actor: personas.find((p) => p.role === "seeker")?.name ?? "seeker",
    demo: false,
  });
  return { eventId: event.id, need, options: outcome.options, best: outcome.best, recommendedPath: outcome.recommendedPath, surfaced: outcome.surfaced };
}

/** Does the current product (Version A: the steps that run in production today) already do what the need asks? */
export function coveredByVersionA(need: string, c: Pick<Case, "baseSolutionId" | "candidateSolutionIds">): { covered: boolean; capabilityId: string | null; capabilityName: string | null; score: number | null } {
  const ctx = caseContext(c, [need]);
  const wanted = inferWorkflowSteps(need);
  const best = versionACapabilities(ctx).active
    .map((cap) => scoreCapability(need, cap, ctx, wanted))
    .filter((s) => s.exclusions.length === 0 && s.dimensions.problemFit > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) return { covered: false, capabilityId: null, capabilityName: null, score: null };
  return { covered: best.score >= IMPROVE_AT, capabilityId: best.capability.id, capabilityName: best.capability.name, score: best.score };
}
