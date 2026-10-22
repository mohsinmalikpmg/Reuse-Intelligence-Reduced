import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { fixedInputContract } from "../lib/workbench-input";
import {
  ConsolidationError, consolidationCaseInput, consolidationCaseUpdate, recipeCatalog,
  registeredConsolidationSources, registerConsolidationSources, consolidationSourceDownload,
  ownedConsolidationCase, listConsolidationCases, saveConsolidationCase, validateConsolidationCase,
  openIntakeCombination,
} from "../lib/consolidation-recipes";
const router: IRouter = Router();
router.get("/consolidation/recipes", async (_req,res) => { res.json(await recipeCatalog()); });
router.use("/consolidation", (req,res,next) => {
  res.setHeader("Cache-Control","private, no-store");
  if (!req.user?.id) { res.status(401).json({error:"Sign in to access consolidation cases and registered sources."}); return; }
  if (!["GET","HEAD","OPTIONS"].includes(req.method)) {
    try {
      const origin = new URL(req.get("origin") ?? req.get("referer") ?? "");
      const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.protocol;
      if (origin.host !== req.get("host") || origin.protocol !== `${protocol}:` || req.get("sec-fetch-site") === "cross-site") throw new Error();
    } catch { res.status(403).json({error:"Same-origin requests are required."}); return; }
  }
  next();
});
router.get("/consolidation/sources", async (_req,res) => { res.json(await registeredConsolidationSources()); });
router.post("/consolidation/briefs/:briefId/workbench", async (req,res) => {
  const parsed = z.object({ recipeId: z.enum(["invoice", "finance"]) }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:"Choose a supported combination."}); return; }
  res.json(await openIntakeCombination(req.user!.id, String(req.params.briefId), parsed.data.recipeId));
});
router.post("/consolidation/sources/register", async (req,res) => {
  const {rows} = await pool.query("SELECT can_manage_solution_packages FROM users WHERE id=$1",[req.user!.id]);
  if (!rows[0]?.can_manage_solution_packages) { res.status(403).json({error:"IT package-management permission is required."}); return; }
  res.json(await registerConsolidationSources(req.user!.id));
});
router.get("/consolidation/sources/:id/download", async (req,res) => {
  const result = await consolidationSourceDownload(String(req.params.id));
  res.setHeader("Content-Type","application/zip");
  res.setHeader("Content-Disposition",`attachment; filename="${result.filename}"`);
  res.setHeader("X-Content-Type-Options","nosniff");
  res.send(result.bytes);
});
router.get("/consolidation/cases", async (req,res) => { res.json(await listConsolidationCases(req.user!.id)); });
router.post("/consolidation/cases", async (req,res) => {
  const parsed = consolidationCaseInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:parsed.error.message}); return; }
  res.status(201).json(await saveConsolidationCase(req.user!.id,parsed.data));
});
router.get("/consolidation/cases/:id", async (req,res) => {
  const c = await ownedConsolidationCase(req.user!.id,String(req.params.id));
  // Runtime applications consume this endpoint directly; do not let that bypass
  // the source/config validation performed by the explicit Run action.
  await validateConsolidationCase(c);
  res.json(c);
});
router.put("/consolidation/cases/:id", async (req,res) => {
  const parsed = consolidationCaseUpdate.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:parsed.error.message}); return; }
  const { expectedRevision, ...input } = parsed.data;
  res.json(await saveConsolidationCase(req.user!.id,input,String(req.params.id),expectedRevision));
});
router.post("/consolidation/cases/:id/run", async (req,res) => {
  const c = await ownedConsolidationCase(req.user!.id,String(req.params.id));
  if(Object.keys(req.body??{}).length||Object.keys(req.query).length||(req.get("content-type")&&!req.is("application/json"))||(req.body!==undefined&&(req.body===null||typeof req.body!=="object"||Array.isArray(req.body)))){
    const contract=fixedInputContract(c.recipeId);
    res.status(422).json({error:contract.reason,issues:[{code:"fixed_demo_only",message:contract.reason}],contracts:[contract]});return;
  }
  await validateConsolidationCase(c);
  res.json({runUrl:c.runUrl,fingerprint:c.fingerprint});
});
router.use((err: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (err instanceof ConsolidationError) { res.status(err.status).json({error:err.message}); return; }
  next(err);
});
export default router;
