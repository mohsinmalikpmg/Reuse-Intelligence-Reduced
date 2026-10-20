import type { DemoState } from "@workspace/api-zod";
import { DEMO_PROMPT } from "../data/catalog";
import { DEMO_BRIEF_FIELDS, aiAvailable } from "./brief-parser";
import { matchBrief } from "./matching";
import { caseContext } from "./configuration";
import { runSimulation } from "./simulation";
import { nextStatus } from "./analysis";
import { logger } from "./logger";
import {
  briefsTable,
  clearAll,
  createCase,
  db,
  getCase,
  insertDecision,
  insertExperiment,
  newId,
  toBrief,
  updateCaseRow,
} from "./store";

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
  await clearAll();

  // Demo brief: the anchor pain point, already interpreted and confirmed.
  const provisional = {
    id: DEMO_BRIEF_ID,
    rawText: DEMO_PROMPT,
    fields: DEMO_BRIEF_FIELDS,
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
      clarifyingQuestion: null,
      clarification: null,
      source: "cached",
      valueStatement: outcome.valueStatement,
      confirmed: true,
    })
    .returning();
  logger.info({ brief: toBrief(briefRow!).id }, "Seeded demo brief");

  // Demo case: WorkOrder Insight as the base with the recommended configuration, ready to walk through.
  await createCase({ id: DEMO_CASE_ID, baseSolutionId: "sol-workorder-insight", briefId: DEMO_BRIEF_ID, title: "Work-order issue identification consolidation", createdByRole: "seeker" });

  // Secondary case already in the owner's queue: Procedure search, simulated and proposed for pilot.
  const procedureCase = await createCase({ id: PROCEDURE_CASE_ID, baseSolutionId: "sol-procedure-finder", title: "Procedure search: add conversational answers", createdByRole: "seeker" });
  const ctx = caseContext(procedureCase);
  const withAnswers = await updateCaseRow(procedureCase.id, { moduleStates: { ...procedureCase.moduleStates, "cap-proc-answers": true } });
  const experiment = await insertExperiment(runSimulation(withAnswers, ctx, newId("exp")));
  const simulated = await updateCaseRow(procedureCase.id, { experimentId: experiment.id, status: "simulated", saved: true });
  await insertDecision({ id: newId("dec"), caseId: simulated.id, role: "seeker", actor: "Alex Romero", action: "approve_simulation", reason: null });
  await updateCaseRow(simulated.id, { status: nextStatus(simulated, "approve_simulation") });

  logger.info("Demo scenario reset");
  return demoState();
}
