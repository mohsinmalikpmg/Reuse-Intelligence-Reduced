import { Router, type IRouter } from "express";
import {
  AddCapabilityRequestBody,
  AddCaseRequirementBody,
  CreateCaseBody,
  ListCasesQueryParams,
  RecordCaseDecisionBody,
  RecordMigrationNoteBody,
  SetCaseDispositionsBody,
  UpdateCaseBody,
  UpdateCaseConfigurationBody,
  type Case,
  type CaseRequirementResult,
} from "@workspace/api-zod";
import { getCapability, getSolution, personas } from "../data/catalog";
import { coveredByVersionA, performReuseCheck } from "../lib/reuse-service";
import { ConfigurationError, applyConfigurationUpdate, buildConfiguration, caseContext } from "../lib/configuration";
import { allowedActions, buildConsolidation, buildRecommendation, buildReview, nextStatus, promotionStateFor } from "../lib/analysis";
import { similarExperiments } from "../lib/experiments";
import { buildExperimentPlan, runSimulation } from "../lib/simulation";
import { matchBrief } from "../lib/matching";
import { caseEvidence } from "../lib/evidence";
import { setReusePathTaken } from "../lib/reuse-store";
import { applyGovernanceEffects } from "../lib/consolidation";
import { GovernanceError, consolidationLocked, recordMigrationNote, upsertDispositions, versionForCase } from "../lib/governance";
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
    intent: parsed.data.intent,
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
  const patch: { title?: string; intent?: string; saved?: boolean; pilotPercent?: number } = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.intent !== undefined) patch.intent = parsed.data.intent.trim();
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
  if (c.status === "approved" || c.status === "rejected" || c.status === "folded") {
    const why = c.status === "approved" ? "approved" : c.status === "folded" ? `published as ${c.foldedInto ?? "a successor version"}` : "rejected";
    res.status(400).json({ error: `This case is ${why}; start a new case to change the configuration.` });
    return;
  }
  const ctx = caseContext(c);
  try {
    const next = applyConfigurationUpdate(c, ctx, parsed.data);
    // Any configuration change invalidates the previous test: the case must be run again. That includes a revision
    // after "changes requested": the revised experiment goes back to draft so it can be tested and proposed anew.
    const updated = await updateCaseRow(c.id, {
      moduleStates: next.moduleStates,
      configValues: next.configValues,
      status: "draft",
      // An edit withdraws any proposal: the experiment is an experimental branch again until it is proposed anew.
      promotionState: "experiment",
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

// ---------- Requirements added while testing ----------

router.post("/cases/:caseId/requirements", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = AddCaseRequirementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Describe the requirement in a few words." });
    return;
  }
  const text = parsed.data.text.trim();
  const requirement = { id: newId("creq"), text, createdAt: new Date().toISOString() };
  const updated = await updateCaseRow(c.id, { requirements: [...c.requirements, requirement] });
  // The same reuse check as everywhere else, so the event history shows what the person was offered here.
  const check = await performReuseCheck({ need: text, trigger: "add_requirement", base: getSolution(c.baseSolutionId) ?? null, caseId: c.id, briefId: c.briefId });
  const result: CaseRequirementResult = { case: updated, requirement, coverage: coveredByVersionA(text, c), check };
  res.status(201).json(result);
});

router.delete("/cases/:caseId/requirements/:requirementId", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const id = String(req.params["requirementId"]);
  if (!c.requirements.some((r) => r.id === id)) {
    res.status(404).json({ error: "Requirement not found" });
    return;
  }
  res.json(await updateCaseRow(c.id, { requirements: c.requirements.filter((r) => r.id !== id) }));
});

// ---------- Capability requests: recorded, shown as a non-executing row, never run ----------

router.post("/cases/:caseId/capability-requests", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = AddCapabilityRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Say what should happen and what is missing from the existing approach." });
    return;
  }
  const { need, missing, afterStepId, reuseEventId } = parsed.data;
  if (afterStepId && !getCapability(afterStepId)) {
    res.status(400).json({ error: "Unknown step" });
    return;
  }
  const request = { id: newId("capreq"), need: need.trim(), missing: missing.trim(), afterStepId: afterStepId ?? null, reuseEventId: reuseEventId ?? null, createdAt: new Date().toISOString() };
  if (reuseEventId) await setReusePathTaken(reuseEventId, "create");
  res.status(201).json(await updateCaseRow(c.id, { capabilityRequests: [...c.capabilityRequests, request] }));
});

router.delete("/cases/:caseId/capability-requests/:requestId", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const id = String(req.params["requestId"]);
  if (!c.capabilityRequests.some((r) => r.id === id)) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.json(await updateCaseRow(c.id, { capabilityRequests: c.capabilityRequests.filter((r) => r.id !== id) }));
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
  // A simulation moves a draft (or a case sent back for changes) to "tested"; decided, published or rejected cases keep their status.
  const status: Case["status"] = c.status === "draft" || c.status === "changes_requested" ? "tested" : c.status;
  await updateCaseRow(c.id, { experimentId: experiment.id, status });
  res.status(201).json(experiment);
});

router.get("/cases/:caseId/similar", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  res.json(await similarExperiments(c));
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

// IT's disposition choices for the products under a case. Proposals until the direction is approved; the
// proposed-future card and the library badges read from this record.
router.put("/cases/:caseId/dispositions", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = SetCaseDispositionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (c.status === "rejected") {
    res.status(400).json({ error: "This case was rejected; there is nothing to dispose." });
    return;
  }
  if (consolidationLocked(c.id)) {
    res.status(400).json({ error: "The direction is approved. Withdraw the approval to change a disposition." });
    return;
  }
  const ctx = caseContext(c);
  const known = new Set([ctx.base.id, ...ctx.candidates.map((s) => s.id)]);
  const unknown = parsed.data.choices.find((ch) => !known.has(ch.solutionId));
  if (unknown) {
    res.status(400).json({ error: `${unknown.solutionId} is not part of this case.` });
    return;
  }
  const draft = versionForCase(c.id);
  await upsertDispositions(
    c.id,
    parsed.data.choices.map((ch) => ({
      solutionId: ch.solutionId,
      kind: ch.kind,
      reason: ch.reason ?? null,
      preferred: ch.solutionId === ctx.base.id && ch.kind === "retain",
      targetSolutionId: ch.kind === "retain" || ch.kind === "retire" ? null : ctx.base.id,
      targetVersion: ch.kind === "retain" || ch.kind === "retire" ? null : (draft?.version ?? null),
    })),
  );
  const decisions = await listDecisions(c.id);
  res.json(buildConsolidation(c, ctx, decisions, await caseEvidence(c)));
});

router.post("/cases/:caseId/migration-notes", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = RecordMigrationNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.note.trim()) {
    res.status(400).json({ error: "Say where the users went, in a sentence." });
    return;
  }
  try {
    await recordMigrationNote(c.id, parsed.data.solutionId, parsed.data.note);
  } catch (err) {
    if (err instanceof GovernanceError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
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
  if (action === "request_new_family" && !reason?.trim()) {
    res.status(400).json({ error: `Say why ${c.lineage.parentSolutionName} cannot absorb this change. A new solution family is the exception.` });
    return;
  }
  const actor = (role === "seeker" || role === "owner") && c.ownerName && role === c.createdByRole ? c.ownerName : (personas.find((p) => p.role === role)?.name ?? role);
  await insertDecision({ id: newId("dec"), caseId: c.id, role, actor, action, reason: reason?.trim() || null });
  // Governance record first (draft successor, publication, withdrawal), so the returned case already reflects it.
  await applyGovernanceEffects(c, action, actor);
  const status = nextStatus(c, action);
  const updated = await updateCaseRow(c.id, { status, saved: true, promotionState: promotionStateFor(action, c.promotionState) });
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
