/**
 * Reuse check as a service: scores the need, records the event, returns the result. Shared by the reuse-check
 * endpoint and by every gate that runs the check as a side effect (adding a requirement in the workbench).
 */
import type { Case, ReuseCheckResult, ReuseTrigger, Solution } from "@workspace/api-zod";
import { personas } from "../data/catalog";
import { caseContext } from "./configuration";
import { reuseCheck } from "./reuse-check";
import { insertReuseEvent } from "./reuse-store";
import { listCaseRows } from "./store";
import { versionACapabilities } from "./workbench";
import { z } from "zod";
import { analyze } from "./ai-analysis";
import { groundingInstructions, provenanceLabel } from "./assessment-evidence";

const ACTIVE_CASE_STATUSES = new Set(["draft", "tested", "pilot_proposed", "approved", "changes_requested"]);

export async function performReuseCheck(input: {
  need: string;
  trigger: ReuseTrigger;
  base: Solution | null;
  caseId?: string | null;
  briefId?: string | null;
  workflowStep?: string | null;
  force?: boolean;
}): Promise<ReuseCheckResult> {
  const need = input.need.trim();
  const experiments = (await listCaseRows()).filter((x) => ACTIVE_CASE_STATUSES.has(x.status) && x.id !== input.caseId);
  const outcome = reuseCheck(need, { base: input.base, experiments, workflowStep: input.workflowStep ?? null });
  const result = await analyze({
    purpose: "reuse-assessment", promptVersion: "reuse-evidence-v1", force: input.force,
    instructions: `${groundingInstructions} Assess the supplied deterministically retrieved candidates against the need. Numeric scores/dimensions are lexical retrieval aids, not probabilities, measured fit or AI scores; do not invent numbers. Select a candidate by zero-based option index, or the create option when evidence is insufficient. Never select an excluded candidate. Set each option's path and the recommendedPath to try_existing only for substantial claimed coverage, improve_existing for related incomplete behavior, new_experiment otherwise. The create option always has new_experiment. Existing hard exclusions are preserved by the server. Return JSON {"options":[{"index":0,"path":"improve_existing","reason":"grounded rationale"}],"bestIndex":null,"recommendedPath":"new_experiment"}. Include one rationale and path for every option.`,
    input: { need, base: input.base, workflowStep: input.workflowStep, options: outcome.options },
    schema: z.object({
      options: z.array(z.object({ index: z.number().int().nonnegative(), path: z.enum(["try_existing", "improve_existing", "new_experiment"]), reason: z.string().min(1) }).strict()),
      bestIndex: z.number().int().nonnegative().nullable(),
      recommendedPath: z.enum(["try_existing", "improve_existing", "new_experiment"]),
    }).strict().superRefine((v, ctx) => {
      if (v.options.length !== outcome.options.length || new Set(v.options.map(o => o.index)).size !== v.options.length || v.options.some(o => !outcome.options[o.index])) ctx.addIssue({ code: "custom", message: "Invalid candidate IDs." });
      const best = v.bestIndex === null ? null : outcome.options[v.bestIndex];
      if ((v.bestIndex !== null && !best) || best?.exclusions.length || best?.path === "hard_exclusion"
        || (v.recommendedPath !== "new_experiment" && (!best || best.kind === "create"))) ctx.addIssue({ code: "custom", message: "Invalid or excluded recommendation." });
    }),
  });
  outcome.options = outcome.options.map((option, index) => ({
    ...option, subtitle: option.kind === "create" ? "New-build option: review the assessed alternatives and evidence gaps first." : option.subtitle,
    path: option.exclusions.length || option.path === "hard_exclusion" ? "hard_exclusion" : option.kind === "create" ? "new_experiment"
      : result.data.bestIndex === index ? result.data.recommendedPath : result.data.options.find(o => o.index === index)!.path,
    reasons: [result.data.options.find(o => o.index === index)!.reason,
      "Score and dimensions are deterministic retrieval heuristics, not measured capability or model confidence.", provenanceLabel(result.provenance)],
  }));
  outcome.best = result.data.bestIndex === null ? null : outcome.options[result.data.bestIndex]!;
  outcome.recommendedPath = result.data.recommendedPath;
  outcome.surfaced = outcome.recommendedPath !== "new_experiment";
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
export async function coveredByVersionA(need: string, c: Pick<Case, "baseSolutionId" | "candidateSolutionIds">): Promise<{ covered: boolean; capabilityId: string | null; capabilityName: string | null; score: number | null }> {
  const ctx = caseContext(c, [need]);
  const active = versionACapabilities(ctx).active;
  const result = await analyze({
    purpose: "version-a-coverage", promptVersion: "version-a-evidence-v1",
    instructions: `${groundingInstructions} Determine whether an active capability's documented behavior fully addresses the need. This is claimed/documented coverage, not a test. Do not mark constraints, broad partial matches or unverified production integrations covered. Return JSON {"covered":false,"capabilityId":null,"reason":"..."}; capabilityId must be supplied or null.`,
    input: { need, active },
    schema: z.object({ covered: z.boolean(), capabilityId: z.string().nullable(), reason: z.string().min(1) }).strict().superRefine((v, ctx) => {
      if ((v.capabilityId && !active.some(a => a.id === v.capabilityId)) || (v.covered && !v.capabilityId)) ctx.addIssue({ code: "custom", message: "Unknown active capability." });
    }),
  });
  const cap = active.find(a => a.id === result.data.capabilityId);
  return { covered: result.data.covered, capabilityId: cap?.id ?? null, capabilityName: cap?.name ?? null, score: null };
}
