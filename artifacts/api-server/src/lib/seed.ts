import type { DemoState } from "@workspace/api-zod";
import { DEMO_PROMPT } from "../data/catalog";
import { DEMO_BRIEF_FIELDS, DEMO_REQUIREMENTS, aiAvailable, deriveTodayBetter, toRequirements } from "./brief-parser";
import { clearReuseEvents, insertReuseEvent } from "./reuse-store";
import { reuseCheck } from "./reuse-check";
import { getSolution } from "../data/catalog";
import { matchBrief } from "./matching";
import { nextStatus } from "./analysis";
import { logger } from "./logger";
import { clearGovernance } from "./governance";
import { clearPrototypes } from "./prototypes";
import { eq } from "drizzle-orm";
import { casesTable, decisionsTable, evaluationsTable, runsTable } from "@workspace/db";
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
  // The governance overlay goes first so every solution read below sees the plain catalog again.
  await clearGovernance();
  await clearPrototypes();
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
  // Seeding does not spend provider calls or claim that this fixture was AI assessed.
  const outcome = { valueStatement: "Demo brief. Open matches to request an evidence-grounded AI assessment." };
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
  await createCase({ id: DEMO_CASE_ID, baseSolutionId: "sol-workorder-insight", briefId: DEMO_BRIEF_ID, createdByRole: "seeker" });

  await seedSimilarExperiments();

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

  // The seeded experiments happened over the past weeks, not at the instant of the reset, so durations such as
  // "time to first useful test" read from the same timeline as the seeded reuse checks.
  await backdate(DEMO_CASE_ID, 21, null);
  await backdate(PROCEDURE_CASE_ID, 12, 11);
  await backdate(DEMO_EXPERIMENT_IDS.marcus, 9, 8);
  await backdate(DEMO_EXPERIMENT_IDS.lena, 6, 5.9);

  logger.info("Demo scenario reset");
  return demoState();
}

/** Move a seeded case into the past: opened `openedDaysAgo` days ago; its runs, votes and decisions `testedDaysAgo` days ago. */
async function backdate(caseId: string, openedDaysAgo: number, testedDaysAgo: number | null): Promise<void> {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  await db.update(casesTable).set({ createdAt: daysAgo(openedDaysAgo) }).where(eq(casesTable.id, caseId));
  if (testedDaysAgo === null) return;
  await db.update(runsTable).set({ createdAt: daysAgo(testedDaysAgo) }).where(eq(runsTable.caseId, caseId));
  await db.update(evaluationsTable).set({ createdAt: daysAgo(testedDaysAgo) }).where(eq(evaluationsTable.caseId, caseId));
  await db.update(decisionsTable).set({ createdAt: daysAgo(testedDaysAgo - 0.1) }).where(eq(decisionsTable.caseId, caseId));
}

export const DEMO_EXPERIMENT_IDS = { marcus: "case_demo_safety_marcus", lena: "case_demo_safety_lena" } as const;

/**
 * Two other teams are already testing the same intent on Work Order Triage (safety-risk classification), with
 * two different approaches. Labelled demo; their votes are demo votes. They make the save-time "similar work"
 * prompt and the owner's grouped review visible from the first minute of the demo.
 */
async function seedSimilarExperiments(): Promise<void> {
  const intent = "Safety-risk classification";
  const demoVote = async (c: { id: string }, sampleInputId: string, choice: "A" | "B" | "neither", evaluator: string, reason: string) => {
    const fresh = await getCase(c.id);
    if (!fresh) return;
    const { runA, runB } = await runComparison(fresh, sampleInputId, undefined);
    await insertEvaluation({ caseId: fresh.id, sessionId: null, sampleInputId, inputHash: runA.inputHash, runAId: runA.id, runBId: runB.id, fingerprintA: runA.configFingerprint, fingerprintB: runB.configFingerprint, choice, reason, rating: null, evaluator, role: "seeker", blind: false, demo: true });
  };

  // Approach 1: Safety Signals added, everything else as in production. Proposed to the owner already.
  const marcus = await createCase({
    id: DEMO_EXPERIMENT_IDS.marcus, baseSolutionId: "sol-workorder-insight", createdByRole: "seeker", intent,
    owner: { name: "Marcus Chen", team: "Maintenance Planning, Oil Sands" }, demo: true, moduleIds: ["cap-safety-signals"],
  });
  await demoVote(marcus, "wo-related", "B", "Marcus Chen", "WO-1056 is flagged before the routine vibration finding.");
  await demoVote(marcus, "wo-two-months", "B", "Demo tester", "Safety items come first in the queue.");
  await demoVote(marcus, "wo-two-months", "A", "Demo tester", "Too many flags on the two-month set; the current list is easier to act on.");
  await demoVote(marcus, "wo-single", "neither", "Demo tester", "One note: nothing to flag either way.");
  const marcusTested = await updateCaseRow(marcus.id, { status: "tested", saved: true });
  await insertDecision({ id: newId("dec"), caseId: marcus.id, role: "seeker", actor: "Marcus Chen", action: "propose_pilot", reason: "Planners want safety items at the top of the morning queue." });
  await updateCaseRow(marcus.id, { status: nextStatus(marcusTested, "propose_pilot"), promotionState: "proposed_to_parent" });

  // Approach 2: Safety Signals plus immediate notification, so a flagged note reaches the supervisor at once.
  const lena = await createCase({
    id: DEMO_EXPERIMENT_IDS.lena, baseSolutionId: "sol-workorder-insight", createdByRole: "seeker", intent,
    owner: { name: "Lena Fischer", team: "Reliability Engineering" }, demo: true, moduleIds: ["cap-safety-signals"],
  });
  await updateCaseRow(lena.id, { configValues: { ...lena.configValues, "cap-notify": "Immediate" } });
  await demoVote(lena, "wo-related", "B", "Lena Fischer", "The supervisor hears about the leak the same shift.");
  await demoVote(lena, "wo-two-months", "B", "Demo tester", "Immediate notices on safety flags only; the rest stays in the digest.");
  await demoVote(lena, "wo-two-months", "B", "Demo tester", "Same ranking as the other approach, but the alert matters.");
  await updateCaseRow(lena.id, { status: "tested", saved: true });
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
