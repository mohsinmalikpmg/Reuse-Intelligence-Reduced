import { Router, type IRouter } from "express";
import { ReuseCheckBody, UpdateReuseEventBody } from "@workspace/api-zod";
import { getSolution } from "../data/catalog";
import { getBrief, getCase } from "../lib/store";
import { performReuseCheck } from "../lib/reuse-service";
import { listReuseEvents, setReusePathTaken } from "../lib/reuse-store";

const router: IRouter = Router();

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
  res.json(await performReuseCheck({ need, trigger, base: base ?? null, caseId: c?.id ?? null, briefId: briefId ?? null, workflowStep: workflowStep ?? null }));
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
