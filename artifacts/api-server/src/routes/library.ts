import { Router, type IRouter } from "express";
import { ListSolutionsQueryParams, SearchLibraryQueryParams, type SearchResults, type SolutionDetail } from "@workspace/api-zod";
import { businessProblems, capabilities, getSolution, personas, solutionCapabilities } from "../data/catalog";
import { searchLibrary, searchSolutions } from "../lib/matching";
import { listCaseRows, summarizeAll } from "../lib/store";
import { experimentsInProgress } from "../lib/experiments";
import { recordSearch } from "../lib/workbench-store";

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

router.get("/search", async (req, res) => {
  const parsed = SearchLibraryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { q, status, kind, owner, businessProblemId } = parsed.data;
  const { hits, capabilities: caps } = searchLibrary(q, { status, kind, owner, businessProblemId });
  if (q.trim().length >= 2) await recordSearch(q.trim(), hits.length, "global");
  const body: SearchResults = { query: q, results: hits, capabilities: caps, source: "hybrid" };
  res.json(body);
});

router.get("/solutions/:solutionId", async (req, res) => {
  const solution = getSolution(String(req.params["solutionId"]));
  if (!solution) {
    res.status(404).json({ error: "Solution not found" });
    return;
  }
  const all = await listCaseRows();
  const cases = all.filter((c) => (c.baseSolutionId === solution.id || c.candidateSolutionIds.includes(solution.id)) && c.status !== "rejected");
  const detail: SolutionDetail = {
    solution,
    capabilities: solutionCapabilities(solution),
    businessProblems: businessProblems.filter((bp) => solution.businessProblemIds.includes(bp.id)),
    openCases: await summarizeAll(cases),
    // Experiments are listed on their parent only; the library and search index catalogue products, never cases.
    experimentsInProgress: await summarizeAll(experimentsInProgress(solution.id, all)),
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
