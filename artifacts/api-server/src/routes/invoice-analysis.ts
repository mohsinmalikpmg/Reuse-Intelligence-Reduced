import { Router, type IRouter } from "express";
import { AnalysisError } from "../lib/ai-analysis";
import { ConsolidationError } from "../lib/consolidation-recipes";
import { invoiceAnalysis } from "../lib/invoice-analysis";

const router: IRouter = Router();
const path = "/consolidation/cases/:id/invoice-analysis";
router.use(path, (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.user?.id) { res.status(401).json({ error: "Sign in to access invoice analysis." }); return; }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    try {
      const origin = new URL(req.get("origin") ?? req.get("referer") ?? "");
      const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.protocol;
      if (origin.host !== req.get("host") || origin.protocol !== `${protocol}:` || req.get("sec-fetch-site") === "cross-site") throw new Error();
    } catch { res.status(403).json({ error: "Same-origin requests are required." }); return; }
  }
  next();
});
router.get(path, async (req, res) => { res.json(await invoiceAnalysis(req.user!.id, String(req.params.id))); });
router.post(path, async (req, res) => { res.json(await invoiceAnalysis(req.user!.id, String(req.params.id), true)); });
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof AnalysisError || error instanceof ConsolidationError) { res.status(error.status).json({ error: error.message }); return; }
  next(error);
});
export default router;
