import type { DemoState } from "@workspace/api-zod";
import { DEMO_PROMPT } from "../data/catalog";
import { DEMO_BRIEF_FIELDS, DEMO_REQUIREMENTS, aiAvailable, deriveTodayBetter, toRequirements } from "./brief-parser";
import { clearReuseEvents, insertReuseEvent } from "./reuse-store";
import { reuseCheck } from "./reuse-check";
import { getSolution } from "../data/catalog";
import { matchBrief } from "./matching";
import { nextStatus } from "./analysis";
import { logger } from "./logger";
import { briefsTable, clearAll, createCase, db, getCase, insertDecision, newId, toBrief, updateCaseRow } from "./store";
import { runComparison } from "./workbench";
import { clearWorkbench, insertEvaluation } from "./workbench-store";

export const DEMO_BRIEF_ID = "brief_demo";
export const DEMO_CASE_ID = "case_demo";
const PROCEDURE_CASE_ID = "case_procedure_search";

export function demoState(): DemoState {
  return { ok: true, demoBriefId: DEMO_BRIEF_ID, demoCaseId: DEMO_CASE_ID, demoPrompt: DEMO_PROMPT, aiAvailable: aiAvailable() };
}

export async function ensureSeeded(): Promise<void> {
  const existing = await getCase(DEMO_CASE_ID);
  if (existing) return;
  await resetDemo();
}

/** The requirement Alex added by hand in the seeded session; it is not in the catalogue product and drives the demo. */
export const DEMO_SAFETY_REQUIREMENT = "Flag maintenance issues that may create a safety risk";

export async function resetDemo(): Promise<DemoState> {
  await clearWorkbench();
  await clearReuseEvents();
  await clearAll();

  // Demo brief: the anchor pain point, already interpreted and confirmed.
  const { today, better } = deriveTodayBetter(DEMO_BRIEF_FIELDS);
  const requirements = [...toRequirements(DEMO_REQUIREMENTS), ...toRequirements([DEMO_SAFETY_REQUIREMENT], "added")];
  const provisional = {
    id: DEMO_BRIEF_ID,
    rawText: DEMO_PROMPT,
    fields: DEMO_BRIEF_FIELDS,
    today,
    better,
    requirements,
    clarifyingQuestion: null,
    clarification: null,
    source: "cached" as const,
    valueStatement: "",
    confirmed: true,
    createdAt: new Date().toISOString(),
  };
  const outcome = matchBrief(provisional);
  const [briefRow] = await db
    .insert(briefsTable)
    .values({
      id: DEMO_BRIEF_ID,
      rawText: DEMO_PROMPT,
      fields: DEMO_BRIEF_FIELDS,
      today,
      better,
      requirements,
      clarifyingQuestion: null,
      clarification: null,
      source: "cached",
      valueStatement: outcome.valueStatement,
      confirmed: true,
    })
    .returning();
  logger.info({ brief: toBrief(briefRow!).id }, "Seeded demo brief");

  await seedReuseEvents();

  // Demo case: Work Order Triage as the base. Version B starts equal to Version A (recommended additions switched
  // off) so the seeker gets to add them in the workbench and see the output change.
  await createCase({ id: DEMO_CASE_ID, baseSolutionId: "sol-workorder-insight", briefId: DEMO_BRIEF_ID, title: "Work Order Intelligence", createdByRole: "seeker" });

  // Secondary case already in the owner's queue: Procedure search with conversational answers, run on the sample
  // question, with two demo-labelled votes, and proposed for pilot.
  const procedureCase = await createCase({ id: PROCEDURE_CASE_ID, baseSolutionId: "sol-procedure-finder", title: "Procedure search: add conversational answers", createdByRole: "seeker" });
  const withAnswers = await updateCaseRow(procedureCase.id, { moduleStates: { ...procedureCase.moduleStates, "cap-proc-answers": true } });
  const { runA, runB } = await runComparison(withAnswers, "sop-query", undefined);
  const demoVote = (choice: "A" | "B" | "neither", evaluator: string, reason: string) =>
    insertEvaluation({ caseId: withAnswers.id, sessionId: null, sampleInputId: "sop-query", inputHash: runA.inputHash, runAId: runA.id, runBId: runB.id, fingerprintA: runA.configFingerprint, fingerprintB: runB.configFingerprint, choice, reason, rating: null, evaluator, role: "seeker", blind: false, demo: true });
  await demoVote("B", "Alex Romero", "The answer names the isolation steps instead of only listing the document.");
  await demoVote("B", "Demo tester", "Shorter path to the actual sequence.");
  const tested = await updateCaseRow(procedureCase.id, { status: "tested", saved: true });
  await insertDecision({ id: newId("dec"), caseId: tested.id, role: "seeker", actor: "Alex Romero", action: "propose_pilot", reason: null });
  await updateCaseRow(tested.id, { status: nextStatus(tested, "propose_pilot") });

  logger.info("Demo scenario reset");
  return demoState();
}

/**
 * Reuse checks the demo personas ran over the past weeks, labelled demo. Scores come from the real scorer so the
 * seeded history can never disagree with what the product would say today.
 */
async function seedReuseEvents(): Promise<void> {
  const wot = getSolution("sol-workorder-insight") ?? null;
  const finder = getSolution("sol-procedure-finder") ?? null;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const seeds: { trigger: "discover_requirement" | "add_step" | "add_requirement" | "search"; need: string; base: typeof wot; actor: string; pathTaken: "use" | "improve" | "create" | "dismissed"; days: number; briefId?: string }[] = [
    { trigger: "discover_requirement", need: "Cluster similar issues across sites", base: wot, actor: "Alex Romero", pathTaken: "use", days: 21, briefId: DEMO_BRIEF_ID },
    { trigger: "add_step", need: "Track approved findings to closure with an owner", base: wot, actor: "Alex Romero", pathTaken: "use", days: 18 },
    { trigger: "add_requirement", need: "Send supervisors an SMS when a finding is approved", base: wot, actor: "Alex Romero", pathTaken: "dismissed", days: 16 },
    { trigger: "search", need: "Answer operator questions about procedures in plain language", base: finder, actor: "Lena Fischer", pathTaken: "improve", days: 12 },
    { trigger: "add_step", need: "Draft a shift handover summary from the logbook", base: wot, actor: "Marcus Chen", pathTaken: "create", days: 9 },
    { trigger: "discover_requirement", need: "Weekly recurring-issue report for site leadership", base: wot, actor: "Alex Romero", pathTaken: "use", days: 5, briefId: DEMO_BRIEF_ID },
  ];
  for (const sd of seeds) {
    const outcome = reuseCheck(sd.need, { base: sd.base, experiments: [] });
    await insertReuseEvent({
      trigger: sd.trigger,
      need: sd.need,
      baseSolutionId: sd.base?.id ?? null,
      caseId: null,
      briefId: sd.briefId ?? null,
      bestScore: outcome.best?.score ?? null,
      bestTitle: outcome.best?.title ?? null,
      bestSolutionId: outcome.best?.solutionId ?? null,
      bestCapabilityId: outcome.best?.capability?.id ?? null,
      pathRecommended: outcome.recommendedPath,
      pathTaken: sd.pathTaken,
      actor: sd.actor,
      demo: true,
      createdAt: daysAgo(sd.days),
    });
  }
}
