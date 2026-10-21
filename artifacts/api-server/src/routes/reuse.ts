import { Router, type IRouter } from "express";
import { ReuseCheckBody, UpdateReuseEventBody, type ReuseCheckResult } from "@workspace/api-zod";
import { getSolution, personas } from "../data/catalog";
import { getBrief, getCase, listCaseRows } from "../lib/store";
import { reuseCheck } from "../lib/reuse-check";
import { insertReuseEvent, listReuseEvents, setReusePathTaken } from "../lib/reuse-store";

const router: IRouter = Router();

const ACTIVE_CASE_STATUSES = new Set(["draft", "tested", "pilot_proposed", "approved", "changes_requested"]);

/** Score existing capabilities, configurations and open experiments against a plain-language need. Records an event. */
router.post("/reuse-check", async (req, res) => {
  const parsed = ReuseCheckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Describe the need in a few words." });
    return;
  }
  const { need, trigger, baseSolutionId, caseId, briefId, workflowStep } = parsed.data;
  let base = baseSolutionId ? getSolution(baseSolutionId) : undefined;
  if (baseSolutionId && !base) {
    res.status(400).json({ error: "Unknown base solution" });
    return;
  }
  const c = caseId ? await getCase(caseId) : null;
  if (caseId && !c) {
    res.status(400).json({ error: "Unknown case" });
    return;
  }
  if (!base && c) base = getSolution(c.baseSolutionId);
  if (briefId && !(await getBrief(briefId))) {
    res.status(400).json({ error: "Unknown brief" });
    return;
  }
  const experiments = (await listCaseRows()).filter((x) => ACTIVE_CASE_STATUSES.has(x.status) && x.id !== caseId);
  const outcome = reuseCheck(need.trim(), { base: base ?? null, experiments, workflowStep: workflowStep ?? null });
  const event = await insertReuseEvent({
    trigger,
    need: need.trim(),
    baseSolutionId: base?.id ?? null,
    caseId: c?.id ?? null,
    briefId: briefId ?? null,
    bestScore: outcome.best?.score ?? null,
    bestTitle: outcome.best?.title ?? null,
    bestSolutionId: outcome.best?.solutionId ?? null,
    bestCapabilityId: outcome.best?.capability?.id ?? null,
    pathRecommended: outcome.recommendedPath,
    pathTaken: null,
    actor: personas.find((p) => p.role === "seeker")?.name ?? "seeker",
    demo: false,
  });
  const result: ReuseCheckResult = {
    eventId: event.id,
    need: need.trim(),
    options: outcome.options,
    best: outcome.best,
    recommendedPath: outcome.recommendedPath,
    surfaced: outcome.surfaced,
  };
  res.json(result);
});

router.get("/reuse-events", async (_req, res) => {
  res.json(await listReuseEvents());
});

router.patch("/reuse-events/:eventId", async (req, res) => {
  const parsed = UpdateReuseEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await setReusePathTaken(String(req.params["eventId"]), parsed.data.pathTaken);
  if (!updated) {
    res.status(404).json({ error: "Reuse event not found" });
    return;
  }
  res.json(updated);
});

export default router;
