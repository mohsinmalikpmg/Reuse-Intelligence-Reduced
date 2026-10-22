import { Router, type IRouter } from "express";
import { z } from "zod";
import { compositionInput, compositionPlan, CompositionError } from "../lib/composition-contract";
import { createComposition, readComposition, listCompositions, previewRefinement, applyRefinement, cancelRefinement, undoComposition, editCompositionPlan, acceptCompositionSuggestion } from "../lib/compositions";
import { AnalysisError } from "../lib/ai-analysis";
import { ConsolidationError } from "../lib/consolidation-recipes";
import { ConfigurationError } from "../lib/configuration";
import { pool } from "@workspace/db";
import { caseAccessScope } from "../lib/case-access";

const router: IRouter = Router();
const revision = z.object({ expectedRevision: z.number().int().min(1) }).strict();
router.use(async (req,res,next) => {
  const { rows } = await pool.query("SELECT case_id,user_id FROM compositions WHERE case_id IS NOT NULL");
  const hidden = new Set<string>(rows.filter(row => row.user_id !== req.user?.id).map(row => row.case_id));
  const privateIds = new Set<string>(rows.map(row => row.case_id));
  // Resolve case references in sibling APIs, not only /cases/:id.
  const references = [req.body?.caseId, req.query.caseId].filter((id): id is string => typeof id === "string");
  const direct = req.path.match(/^\/cases\/([^/]+)/);
  if (direct) references.push(decodeURIComponent(direct[1]));
  const alias = req.path.match(/^\/(runs|experiments|test-sessions|reuse-events)\/([^/]+)/);
  if (alias) {
    const table = { runs: "runs", experiments: "experiments", "test-sessions": "test_sessions", "reuse-events": "reuse_events" }[alias[1]];
    if (table) {
      const related = await pool.query(`SELECT case_id FROM ${table} WHERE id=$1`,[decodeURIComponent(alias[2])]);
      if (related.rows[0]?.case_id) references.push(related.rows[0].case_id);
    }
  }
  if (references.some(id => hidden.has(id))) { res.status(404).json({error:"Case not found."}); return; }
  if (req.path === "/demo/reset" && req.method === "POST" && rows.length) {
    res.status(409).json({error:"Demo reset would delete privately composed cases. Remove or archive those drafts before resetting."}); return;
  }
  if (references.some(id => privateIds.has(id)) && !["GET","HEAD","OPTIONS"].includes(req.method)) {
    try {
      const origin = new URL(req.get("origin") ?? req.get("referer") ?? "");
      const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.protocol;
      if (origin.host !== req.get("host") || origin.protocol !== `${protocol}:` || req.get("sec-fetch-site") === "cross-site") throw new Error();
    } catch { res.status(403).json({error:"Same-origin requests are required."}); return; }
  }
  caseAccessScope.run({hidden},next);
});
// Legacy case APIs are public demo APIs. A privately composed real case must not
// inherit that public write access, including its existing manual/test controls.
router.use("/cases/:caseId", async (req,res,next) => {
  const { rows } = await pool.query("SELECT user_id FROM compositions WHERE case_id=$1", [String(req.params.caseId)]);
  if (rows.length && rows[0].user_id !== req.user?.id) { res.status(404).json({ error: "Case not found." }); return; }
  if (rows.length && !["GET","HEAD","OPTIONS"].includes(req.method)) {
    try {
      const origin = new URL(req.get("origin") ?? req.get("referer") ?? "");
      const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.protocol;
      if (origin.host !== req.get("host") || origin.protocol !== `${protocol}:` || req.get("sec-fetch-site") === "cross-site") throw new Error();
    } catch { res.status(403).json({error:"Same-origin requests are required."}); return; }
  }
  next();
});
router.use("/compositions", (req,res,next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.user?.id) { res.status(401).json({ error: "Sign in to build or refine a composition." }); return; }
  if (!["GET","HEAD","OPTIONS"].includes(req.method)) {
    try {
      const origin = new URL(req.get("origin") ?? req.get("referer") ?? "");
      const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.protocol;
      if (origin.host !== req.get("host") || origin.protocol !== `${protocol}:` || req.get("sec-fetch-site") === "cross-site") throw new Error();
    } catch { res.status(403).json({ error: "Same-origin requests are required." }); return; }
  }
  next();
});
router.get("/compositions", async (req,res) => {
  const q = z.object({ caseId: z.string().max(200).optional() }).parse(req.query);
  res.json(await listCompositions(req.user!.id,q.caseId));
});
router.post("/compositions", async (req,res) => {
  res.status(201).json(await createComposition(req.user!.id,compositionInput.parse(req.body)));
});
router.get("/compositions/:id", async (req,res) => { res.json(await readComposition(req.user!.id,String(req.params.id))); });
router.put("/compositions/:id/plan",async(req,res)=>{
  const input=revision.extend({plan:compositionPlan}).parse(req.body);
  res.json(await editCompositionPlan(req.user!.id,String(req.params.id),input.expectedRevision,input.plan));
});
router.post("/compositions/:id/suggestions/:suggestionId/accept",async(req,res)=>{
  const input=revision.extend({idempotencyKey:z.string().min(8).max(200)}).parse(req.body);
  res.json(await acceptCompositionSuggestion(req.user!.id,String(req.params.id),String(req.params.suggestionId),input.expectedRevision,input.idempotencyKey));
});
router.post("/compositions/:id/refinements", async (req,res) => {
  const input = revision.extend({ instruction: z.string().trim().min(1).max(4000) }).parse(req.body);
  res.json(await previewRefinement(req.user!.id,String(req.params.id),input.expectedRevision,input.instruction));
});
router.post("/compositions/:id/refinements/:previewId/apply", async (req,res) => {
  const input = revision.parse(req.body);
  res.json(await applyRefinement(req.user!.id,String(req.params.id),String(req.params.previewId),input.expectedRevision));
});
router.post("/compositions/:id/refinements/:previewId/cancel", async (req,res) => {
  res.json(await cancelRefinement(req.user!.id,String(req.params.id),String(req.params.previewId)));
});
router.post("/compositions/:id/undo", async (req,res) => {
  res.json(await undoComposition(req.user!.id,String(req.params.id),revision.parse(req.body).expectedRevision));
});
router.use((err: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (err instanceof z.ZodError) { res.status(400).json({ error: err.message }); return; }
  if (err instanceof CompositionError || err instanceof AnalysisError || err instanceof ConsolidationError) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof ConfigurationError) { res.status(422).json({ error: err.message }); return; }
  next(err);
});
export default router;
