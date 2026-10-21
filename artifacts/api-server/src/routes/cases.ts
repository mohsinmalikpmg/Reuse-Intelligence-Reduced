import { Router, type IRouter } from "express";
import {
  CreateCaseBody,
  ListCasesQueryParams,
  RecordCaseDecisionBody,
  UpdateCaseBody,
  UpdateCaseConfigurationBody,
  type Case,
} from "@workspace/api-zod";
import { getSolution, personas } from "../data/catalog";
import { ConfigurationError, applyConfigurationUpdate, buildConfiguration, caseContext } from "../lib/configuration";
import { allowedActions, buildConsolidation, buildRecommendation, buildReview, nextStatus } from "../lib/analysis";
import { buildExperimentPlan, runSimulation } from "../lib/simulation";
import { matchBrief } from "../lib/matching";
import { caseEvidence } from "../lib/evidence";
import { setReusePathTaken } from "../lib/reuse-store";
import {
  createCase,
  getBrief,
  getCase,
  getExperiment,
  insertDecision,
  insertExperiment,
  listCaseRows,
  listDecisions,
  newId,
  summarizeAll,
  updateCaseRow,
} from "../lib/store";

const router: IRouter = Router();

async function loadCase(id: string, res: import("express").Response): Promise<Case | null> {
  const c = await getCase(id);
  if (!c) res.status(404).json({ error: "Case not found" });
  return c;
}

router.get("/cases", async (req, res) => {
  const parsed = ListCasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let cases = await listCaseRows();
  if (parsed.data.status) cases = cases.filter((c) => c.status === parsed.data.status);
  res.json(await summarizeAll(cases));
});

router.post("/cases", async (req, res) => {
  const parsed = CreateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const base = getSolution(parsed.data.baseSolutionId);
  if (!base) {
    res.status(400).json({ error: "Unknown base solution" });
    return;
  }
  if (parsed.data.briefId && !(await getBrief(parsed.data.briefId))) {
    res.status(400).json({ error: "Unknown brief" });
    return;
  }
  const created = await createCase({
    baseSolutionId: base.id,
    briefId: parsed.data.briefId ?? null,
    title: parsed.data.title,
    createdByRole: parsed.data.createdByRole,
    moduleIds: parsed.data.moduleIds,
  });
  if (parsed.data.reuseEventId) await setReusePathTaken(parsed.data.reuseEventId, "use");
  res.status(201).json(created);
});

router.get("/cases/:caseId", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (c) res.json(c);
});

router.patch("/cases/:caseId", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = UpdateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const patch: { title?: string; saved?: boolean; pilotPercent?: number } = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.saved !== undefined) patch.saved = parsed.data.saved;
  if (parsed.data.pilotPercent !== undefined) patch.pilotPercent = parsed.data.pilotPercent;
  res.json(await updateCaseRow(c.id, patch));
});

router.get("/cases/:caseId/recommendation", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const ctx = caseContext(c);
  let fit: number | null = null;
  if (c.briefId) {
    const brief = await getBrief(c.briefId);
    if (brief) fit = matchBrief(brief).matches.find((m) => m.solution.id === c.baseSolutionId)?.fitScore ?? null;
  }
  res.json(buildRecommendation(c, ctx, fit));
});

router.get("/cases/:caseId/configuration", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  // The brief's requirements decide whether portable modules (e.g. Safety Signals) are recommended here.
  const brief = c.briefId ? await getBrief(c.briefId) : null;
  res.json(buildConfiguration(c, caseContext(c, brief?.requirements.map((r) => r.text) ?? [])));
});

router.put("/cases/:caseId/configuration", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = UpdateCaseConfigurationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (c.status === "approved" || c.status === "rejected") {
    res.status(400).json({ error: `This case is ${c.status === "approved" ? "approved" : "rejected"}; start a new case to change the configuration.` });
    return;
  }
  const ctx = caseContext(c);
  try {
    const next = applyConfigurationUpdate(c, ctx, parsed.data);
    // Any configuration change invalidates the previous test: the case must be run again.
    const status: Case["status"] = c.status === "draft" || c.status === "changes_requested" ? c.status : "draft";
    const updated = await updateCaseRow(c.id, {
      moduleStates: next.moduleStates,
      configValues: next.configValues,
      status: c.status === "changes_requested" ? "changes_requested" : status,
      experimentId: null,
    });
    res.json(buildConfiguration(updated, ctx));
  } catch (err) {
    if (err instanceof ConfigurationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/cases/:caseId/experiment-plan", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  res.json(buildExperimentPlan(c, caseContext(c)));
});

router.post("/cases/:caseId/experiments", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const ctx = caseContext(c);
  const experiment = await insertExperiment(runSimulation(c, ctx, newId("exp")));
  const status: Case["status"] = c.status === "rejected" ? "rejected" : "tested";
  await updateCaseRow(c.id, { experimentId: experiment.id, status });
  res.status(201).json(experiment);
});

router.get("/cases/:caseId/review", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const ctx = caseContext(c);
  const experiment = c.experimentId ? await getExperiment(c.experimentId) : null;
  const decisions = await listDecisions(c.id);
  res.json(buildReview(c, ctx, experiment, decisions, await caseEvidence(c)));
});

router.get("/cases/:caseId/consolidation", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const ctx = caseContext(c);
  const decisions = await listDecisions(c.id);
  res.json(buildConsolidation(c, ctx, decisions, await caseEvidence(c)));
});

router.post("/cases/:caseId/decisions", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = RecordCaseDecisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { role, action, reason } = parsed.data;
  const decisions = await listDecisions(c.id);
  const allowed = allowedActions(c, decisions).find((a) => a.role === role)?.actions ?? [];
  if (!allowed.includes(action)) {
    res.status(400).json({ error: `A ${roleLabel(role)} cannot ${actionLabel(action)} while the case is ${statusLabel(c.status)}.` });
    return;
  }
  if (action === "reject" && !reason?.trim()) {
    res.status(400).json({ error: "A reason is required to reject." });
    return;
  }
  const actor = personas.find((p) => p.role === role)?.name ?? role;
  await insertDecision({ id: newId("dec"), caseId: c.id, role, actor, action, reason: reason?.trim() || null });
  const status = nextStatus(c, action);
  const updated = await updateCaseRow(c.id, { status, saved: true });
  res.status(201).json(updated);
});

function roleLabel(role: string): string {
  return role === "it" ? "IT leader" : role === "owner" ? "solution owner" : "solution seeker";
}
function actionLabel(action: string): string {
  return action.replace(/_/g, " ");
}
function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export default router;
