import { Router, type IRouter } from "express";
import { ListSolutionsQueryParams, SearchLibraryQueryParams, type SearchResults, type SolutionDetail } from "@workspace/api-zod";
import { allCapabilities, businessProblems, getSolution, personas, solutionCapabilities } from "../data/catalog";
import { searchLibrary, searchSolutions } from "../lib/matching";
import { listCaseRows, summarizeAll } from "../lib/store";
import { experimentsInProgress } from "../lib/experiments";
import { recordSearch } from "../lib/workbench-store";
import { buildFamilies, capabilitiesWithFamily, configurationPreview, familyRoleOf, familyTitleOf } from "../lib/families";
import { WorkbenchError } from "../lib/workbench";
import { getPrototypeRow, listPrototypeRows, toRegisteredPrototype } from "../lib/prototypes";

const router: IRouter = Router();

router.get("/personas", (_req, res) => {
  // Legacy owner identities remain in historical records, not in the persona picker.
  res.json(personas.filter((p) => p.role !== "owner"));
});

router.get("/solutions", (req, res) => {
  const parsed = ListSolutionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(searchSolutions(parsed.data.q, parsed.data.status));
});

router.get("/library/families", (_req, res) => {
  res.json(buildFamilies());
});

router.get("/solutions/:solutionId/configurations/:version/preview", (req, res) => {
  try {
    res.json(configurationPreview(String(req.params["solutionId"]), String(req.params["version"])));
  } catch (err) {
    if (err instanceof WorkbenchError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
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
  // Same hierarchy as the family view: the preferred product of a problem never ranks below its siblings.
  const results = hits.map((h) => ({ ...h, familyRole: familyRoleOf(h.solution), familyTitle: familyTitleOf(h.solution) }));
  for (const r of results) {
    if (r.familyRole !== "preferred") continue;
    const siblings = results.filter((o) => o !== r && o.solution.businessProblemIds.some((bp) => r.solution.businessProblemIds.includes(bp)));
    r.score = Math.min(100, Math.max(r.score, ...siblings.map((o) => o.score)));
  }
  const roleRank = { preferred: 0, alternative: 1, consolidating: 2 } as const;
  results.sort((a, b) => b.score - a.score || roleRank[a.familyRole] - roleRank[b.familyRole]);
  const body: SearchResults = { query: q, results, capabilities: capabilitiesWithFamily(caps), source: "hybrid" };
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
    prototype: solution.origin ? (() => { const row = getPrototypeRow(solution.id); return row ? toRegisteredPrototype(row) : null; })() : null,
    // Owners see what was compared against their product: the examples and the side-by-side live on the prototype's page.
    comparedPrototypes: solution.origin ? [] : listPrototypeRows(solution.id).map(toRegisteredPrototype),
  };
  res.json(detail);
});

router.get("/capabilities", (_req, res) => {
  res.json(allCapabilities());
});

router.get("/business-problems", (_req, res) => {
  res.json(businessProblems);
});

export default router;
