import { Router, type IRouter } from "express";
import type { LibraryCodePackage } from "@workspace/api-zod";
import manifest from "../data/solution-code-manifest.json";
import { getBrief } from "../lib/store";
import { assessCode } from "../lib/code-assessment";

const router: IRouter = Router();
router.get("/briefs/:briefId/code-assessment", async (req, res) => {
  const brief = await getBrief(String(req.params.briefId));
  if (!brief) { res.status(404).json({ error: "Brief not found." }); return; }
  if (!brief.confirmed) { res.status(400).json({ error: "Confirm the requirements before assessing code coverage." }); return; }
  const { objectPath: _objectPath, ...pkg } = manifest;
  res.setHeader("Cache-Control", "no-store");
  res.json(assessCode(brief, pkg as LibraryCodePackage));
});
export default router;
