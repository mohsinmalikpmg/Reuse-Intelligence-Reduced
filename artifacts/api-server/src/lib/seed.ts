import type { DemoState } from "@workspace/api-zod";
import { DEMO_PROMPT } from "../data/catalog";
import { DEMO_BRIEF_FIELDS, aiAvailable, deriveTodayBetter } from "./brief-parser";
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

export async function resetDemo(): Promise<DemoState> {
  await clearWorkbench();
  await clearAll();

  // Demo brief: the anchor pain point, already interpreted and confirmed.
  const { today, better } = deriveTodayBetter(DEMO_BRIEF_FIELDS);
  const provisional = {
    id: DEMO_BRIEF_ID,
    rawText: DEMO_PROMPT,
    fields: DEMO_BRIEF_FIELDS,
    today,
    better,
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
      clarifyingQuestion: null,
      clarification: null,
      source: "cached",
      valueStatement: outcome.valueStatement,
      confirmed: true,
    })
    .returning();
  logger.info({ brief: toBrief(briefRow!).id }, "Seeded demo brief");

  // Demo case: Work Order Triage as the base. Version B starts equal to Version A (recommended additions switched
  // off) so the seeker gets to add them in the workbench and see the output change.
  await createCase({ id: DEMO_CASE_ID, baseSolutionId: "sol-workorder-insight", briefId: DEMO_BRIEF_ID, title: "Work Order Intelligence", createdByRole: "seeker" });

  // Secondary case already in the owner's queue: Procedure search with conversational answers, run on the sample
  // question, with two demo-labelled votes, and proposed for pilot.
  const procedureCase = await createCase({ id: PROCEDURE_CASE_ID, baseSolutionId: "sol-procedure-finder", title: "Procedure search: add conversational answers", createdByRole: "seeker" });
  const withAnswers = await updateCaseRow(procedureCase.id, { moduleStates: { ...procedureCase.moduleStates, "cap-proc-answers": true } });
  const { runA, runB } = await runComparison(withAnswers, "sop-query", undefined);
  const demoVote = (choice: "A" | "B" | "neither", evaluator: string, reason: string) =>
    insertEvaluation({ caseId: withAnswers.id, sessionId: null, sampleInputId: "sop-query", inputHash: runA.inputHash, runAId: runA.id, runBId: runB.id, choice, reason, rating: null, evaluator, role: "seeker", blind: false, demo: true });
  await demoVote("B", "Alex Romero", "The answer names the isolation steps instead of only listing the document.");
  await demoVote("B", "Demo tester", "Shorter path to the actual sequence.");
  const tested = await updateCaseRow(procedureCase.id, { status: "tested", saved: true });
  await insertDecision({ id: newId("dec"), caseId: tested.id, role: "seeker", actor: "Alex Romero", action: "propose_pilot", reason: null });
  await updateCaseRow(tested.id, { status: nextStatus(tested, "propose_pilot") });

  logger.info("Demo scenario reset");
  return demoState();
}
