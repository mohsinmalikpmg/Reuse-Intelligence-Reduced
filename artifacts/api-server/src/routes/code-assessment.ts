import { Router, type IRouter } from "express";
import type { LibraryCodePackage } from "@workspace/api-zod";
import manifest from "../data/solution-code-manifest.json";
import { getBrief } from "../lib/store";
import { assessCode } from "../lib/code-assessment";
import { GetAcceptanceChecksResponse, RunAcceptanceCheckBody, RunAcceptanceCheckResponse } from "@workspace/api-zod";
import { db, acceptanceRunsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { acceptancePlan, runAcceptance, verifyAcceptanceEngine, AcceptanceError } from "../lib/acceptance-checks";

const router: IRouter = Router();
router.get("/briefs/:briefId/acceptance-checks", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const brief = await getBrief(String(req.params.briefId));
  if (!brief) { res.status(404).json({ error: "Brief not found." }); return; }
  if (!brief.confirmed) { res.status(400).json({ error: "Confirm requirements first." }); return; }
  const { objectPath: _objectPath, ...pkg } = manifest;
  const plan = acceptancePlan(assessCode(brief, pkg as LibraryCodePackage));
  const rows = await db.select().from(acceptanceRunsTable).where(eq(acceptanceRunsTable.briefId, brief.id)).orderBy(desc(acceptanceRunsTable.createdAt));
  res.json(GetAcceptanceChecksResponse.parse({ ...plan, runs: rows.map(row => row.snapshot) }));
});
router.post("/briefs/:briefId/acceptance-checks", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = RunAcceptanceCheckBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid acceptance-check request." }); return; }
  const brief = await getBrief(String(req.params.briefId));
  if (!brief) { res.status(404).json({ error: "Brief not found." }); return; }
  if (!brief.confirmed) { res.status(400).json({ error: "Confirm requirements first." }); return; }
  try {
    const { objectPath: _objectPath, ...pkg } = manifest;
    const report = assessCode(brief, pkg as LibraryCodePackage);
    const engineFingerprint = await verifyAcceptanceEngine(report);
    const result = RunAcceptanceCheckResponse.parse(runAcceptance(report, parsed.data, engineFingerprint));
    await db.insert(acceptanceRunsTable).values({ id: result.id, briefId: brief.id, snapshot: result });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof AcceptanceError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});
router.get("/briefs/:briefId/code-assessment", async (req, res) => {
  const brief = await getBrief(String(req.params.briefId));
  if (!brief) { res.status(404).json({ error: "Brief not found." }); return; }
  if (!brief.confirmed) { res.status(400).json({ error: "Confirm the requirements before assessing code coverage." }); return; }
  const { objectPath: _objectPath, ...pkg } = manifest;
  res.setHeader("Cache-Control", "no-store");
  res.json(assessCode(brief, pkg as LibraryCodePackage));
});
export default router;
