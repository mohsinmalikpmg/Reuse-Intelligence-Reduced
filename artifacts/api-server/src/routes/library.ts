import { Router, type IRouter } from "express";
import { ListSolutionsQueryParams, type SolutionDetail } from "@workspace/api-zod";
import { businessProblems, capabilities, getSolution, personas, solutionCapabilities } from "../data/catalog";
import { searchSolutions } from "../lib/matching";
import { listCaseRows, summarizeAll } from "../lib/store";

const router: IRouter = Router();

router.get("/personas", (_req, res) => {
  res.json(personas);
});

router.get("/solutions", (req, res) => {
  const parsed = ListSolutionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(searchSolutions(parsed.data.q, parsed.data.status));
});

router.get("/solutions/:solutionId", async (req, res) => {
  const solution = getSolution(String(req.params["solutionId"]));
  if (!solution) {
    res.status(404).json({ error: "Solution not found" });
    return;
  }
  const cases = (await listCaseRows()).filter(
    (c) => (c.baseSolutionId === solution.id || c.candidateSolutionIds.includes(solution.id)) && c.status !== "rejected",
  );
  const detail: SolutionDetail = {
    solution,
    capabilities: solutionCapabilities(solution),
    businessProblems: businessProblems.filter((bp) => solution.businessProblemIds.includes(bp.id)),
    openCases: await summarizeAll(cases),
  };
  res.json(detail);
});

router.get("/capabilities", (_req, res) => {
  res.json(capabilities);
});

router.get("/business-problems", (_req, res) => {
  res.json(businessProblems);
});

export default router;
