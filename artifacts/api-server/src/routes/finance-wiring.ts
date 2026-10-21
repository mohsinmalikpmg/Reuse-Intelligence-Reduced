import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { SaveFinanceWiringVersionBody, RestoreFinanceWiringVersionBody } from "@workspace/api-zod";
import {
  FinanceWiringError, financeCatalog, financeConfigSchema, validateFinanceConfig, runFinanceConfig,
  financeState, saveFinanceVersion, restoreFinanceVersion, exportFinanceVersion,
} from "../lib/finance-wiring";

const router: IRouter = Router();
const inputSchema = z.object({ config: financeConfigSchema }).strict();
const snapshotSchema = SaveFinanceWiringVersionBody.extend({ config: financeConfigSchema }).strict();
const activationSchema = RestoreFinanceWiringVersionBody.strict();

router.use("/finance-wiring/versions", requireIdentity);
router.use("/finance-wiring/restore", requireIdentity);
router.use("/finance-wiring", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  // Same-origin checks also protect the public POSTs from cross-origin abuse.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    try {
      const origin = req.headers.origin ?? req.get("referer");
      const parsed = origin ? new URL(origin) : null;
      const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.protocol;
      if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.host !== req.get("host") ||
          parsed.protocol !== `${protocol}:` ||
          req.get("sec-fetch-site") === "cross-site") throw new Error("origin");
    } catch {
      res.status(403).json({ error: "Cross-origin requests are not allowed." }); return;
    }
  }
  next();
});

function requireIdentity(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  if (!req.user?.id) {
    res.status(401).json({ error: "Sign in to save, restore, or export your finance wiring." }); return;
  }
  next();
}

router.get("/finance-wiring/catalog", async (_req, res) => { res.json(await financeCatalog()); });
router.post("/finance-wiring/validate", async (req, res) => {
  // Keep the worker's documented valid:false response for malformed configs.
  if (!req.body || typeof req.body !== "object" || !("config" in req.body) || Object.keys(req.body).some(key => key !== "config")) {
    res.status(400).json({ error: "Provide a finance configuration." }); return;
  }
  res.json(await validateFinanceConfig(req.body.config));
});
router.post("/finance-wiring/run", async (req, res) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid finance configuration. Validate the wiring and correct its fields." }); return; }
  res.json(await runFinanceConfig(parsed.data.config));
});
router.get("/finance-wiring/versions", requireIdentity, async (req, res) => {
  res.json(await financeState(req.user!.id));
});
router.post("/finance-wiring/versions", requireIdentity, async (req, res) => {
  const parsed = snapshotSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid finance configuration and expectedRevision are required." }); return; }
  res.status(201).json(await saveFinanceVersion(req.user!.id, parsed.data.config, parsed.data.expectedRevision));
});
router.post("/finance-wiring/restore", requireIdentity, async (req, res) => {
  const parsed = activationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A saved versionId and expectedRevision are required." }); return; }
  res.json(await restoreFinanceVersion(req.user!.id, parsed.data.versionId, parsed.data.expectedRevision));
});
router.get("/finance-wiring/versions/:id/export", requireIdentity, async (req, res) => {
  if (String(req.params.id).length > 100) { res.status(404).json({ error: "Saved finance version not found." }); return; }
  const { archive, number } = await exportFinanceVersion(req.user!.id, String(req.params.id));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="finance-wiring-v${number}.zip"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(archive);
});
router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof FinanceWiringError) { res.status(error.status).json({ error: error.message }); return; }
  req.log?.error({ errorType: error instanceof Error ? error.name : "Unknown" }, "Finance wiring request failed");
  res.status(500).json({ error: "Finance wiring could not be processed. Your saved versions are unchanged." });
});
export default router;
