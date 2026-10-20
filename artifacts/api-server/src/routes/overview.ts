import { Router, type IRouter } from "express";
import type {
  Capability,
  ConsolidationSummary,
  EvidenceEvent,
  OwnerOverview,
  OwnerSolution,
  Portfolio,
  PortfolioRow,
  SeekerOverview,
} from "@workspace/api-zod";
import { DEMO_PROMPT, OWNER_PERSONA_NAME, businessProblems, capabilities, personas, solutions, sortByMaturity } from "../data/catalog";
import { addedExternalModules, caseContext, isUnsupported } from "../lib/configuration";
import { matchBrief } from "../lib/matching";
import { demoState, resetDemo } from "../lib/seed";
import { getExperiment, listAllDecisions, listBriefs, listCaseRows, listExperiments, summarizeAll } from "../lib/store";

const router: IRouter = Router();

router.get("/home/seeker", async (_req, res) => {
  const briefs = await listBriefs();
  const cases = await listCaseRows();
  const recent = briefs.slice(0, 5);
  const recommendedIds = new Set<string>();
  for (const brief of recent) {
    const rec = matchBrief(brief).matches.find((m) => m.recommended);
    if (rec) recommendedIds.add(rec.solution.id);
  }
  const recommendedSolutions = sortByMaturity(solutions.filter((s) => recommendedIds.has(s.id) || (recommendedIds.size === 0 && s.status === "certified"))).slice(0, 4);
  const overview: SeekerOverview = {
    headline: personas.find((p) => p.role === "seeker")?.headline ?? "",
    recentBriefs: recent,
    recommendedSolutions,
    savedCases: await summarizeAll(cases.filter((c) => c.saved || c.status !== "draft" || c.briefId !== null)),
    demoPrompt: DEMO_PROMPT,
  };
  res.json(overview);
});

router.get("/home/owner", async (_req, res) => {
  const owner = personas.find((p) => p.role === "owner");
  const mine = solutions.filter((s) => s.ownerName === OWNER_PERSONA_NAME);
  const mineIds = new Set(mine.map((s) => s.id));
  const cases = (await listCaseRows()).filter((c) => mineIds.has(c.baseSolutionId));
  const open = cases.filter((c) => c.status !== "rejected");
  const experiments = (await listExperiments()).filter((e) => open.some((c) => c.id === e.caseId && c.experimentId === e.id));
  const decisions = await listAllDecisions();

  const mySolutions: OwnerSolution[] = mine.map((solution) => {
    const solutionCases = open.filter((c) => c.baseSolutionId === solution.id);
    const pending = solutionCases.filter((c) => ["simulated", "pilot_proposed", "deferred"].includes(c.status));
    const latest = solutionCases
      .map((c) => decisions.find((d) => d.caseId === c.id))
      .find((d) => d);
    return {
      solution,
      pendingChanges: pending.length,
      openExperiments: solutionCases.filter((c) => c.experimentId && c.status === "simulated").length,
      sharedCapabilityCount: solution.capabilityIds.filter((id) => solutions.some((o) => o.id !== solution.id && o.capabilityIds.includes(id))).length,
      proposedDecision: pending.length === 0 ? null : latest ? `${latest.actor}: ${latest.action.replace(/_/g, " ")}` : "Awaiting your review",
    };
  });

  const proposedChanges = await summarizeAll(open.filter((c) => ["simulated", "pilot_proposed", "changes_requested", "deferred"].includes(c.status)));
  const pendingExperiments = experiments.filter((e) => open.find((c) => c.id === e.caseId)?.status === "simulated");
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const overview: OwnerOverview = {
    headline: `You own ${plural(mine.length, "product")}. ${plural(proposedChanges.length, "proposed change")} and ${plural(pendingExperiments.length, "simulation")} are waiting for your decision.`,
    ownerName: OWNER_PERSONA_NAME,
    mySolutions,
    proposedChanges,
    pendingExperiments,
    versionsRequiringReview: await summarizeAll(open.filter((c) => c.status === "pilot_proposed")),
  };
  res.json(overview);
});

async function consolidationSummaries(): Promise<ConsolidationSummary[]> {
  const cases = (await listCaseRows()).filter((c) => c.status !== "rejected");
  const decisions = await listAllDecisions();
  const briefs = await listBriefs();
  const out: ConsolidationSummary[] = [];
  for (const c of cases) {
    const ctx = caseContext(c);
    if (ctx.candidates.length === 0 && c.status === "draft") continue;
    const experiment = c.experimentId ? await getExperiment(c.experimentId) : null;
    const reusable = addedExternalModules(c, ctx);
    const retirement = ctx.candidates.find((s) => s.retirementCandidate) ?? null;
    const brief = c.briefId ? briefs.find((b) => b.id === c.briefId) : undefined;
    const trail: EvidenceEvent[] = [
      { at: c.createdAt, actor: c.createdByRole === "seeker" ? "Alex Romero" : c.createdByRole === "owner" ? OWNER_PERSONA_NAME : "Jordan Okafor", event: brief ? "Pain point interpreted and matched to existing solutions" : "Consolidation case opened from the library" },
      ...(experiment ? [{ at: experiment.createdAt, actor: "Simulation engine", event: `Simulated test run (seed ${experiment.seed}): ${experiment.recommendation.replace(/_/g, " ")}` }] : []),
      ...decisions
        .filter((d) => d.caseId === c.id)
        .reverse()
        .map((d) => ({ at: d.createdAt, actor: d.actor, event: `${d.action.replace(/_/g, " ")}${d.reason ? `: ${d.reason}` : ""}` })),
    ];
    out.push({
      case: c,
      baseSolution: ctx.base,
      overlappingSolutions: ctx.candidates,
      reusableCapabilities: reusable,
      retirementCandidate: retirement,
      ownerName: ctx.base.ownerName,
      architectureStatus: ctx.base.architectureStatus,
      controlStatus: ctx.base.controlStatus,
      // Share of overlapping products that stop being maintained separately once folded into the base.
      duplicationReductionPct: Math.round((ctx.candidates.length / (ctx.candidates.length + 1)) * 100),
      migrationEffort: reusable.some((cap) => isUnsupported(cap)) ? "Medium: ownership transfer plus integration" : reusable.length > 0 ? "Low to medium: module integration only" : "Low: configuration only",
      evidenceTrail: trail,
      valueStatement: `${ctx.candidates.length + 1} overlapping products become one ${ctx.base.status} base; ${reusable.length} capabilit${reusable.length === 1 ? "y" : "ies"} reused, ${retirement ? "1 product retired" : "no retirements"}.`,
      experimentRecommendation: experiment?.recommendation ?? null,
    });
  }
  return out;
}

router.get("/portfolio", async (_req, res) => {
  const cases = await listCaseRows();
  const decisions = await listAllDecisions();
  const summaries = await consolidationSummaries();

  const rows: PortfolioRow[] = businessProblems.map((bp) => {
    const sols = sortByMaturity(solutions.filter((s) => bp.activeSolutionIds.includes(s.id)));
    const theCase = cases.find((c) => c.businessProblemId === bp.id && c.status !== "rejected") ?? null;
    return {
      businessProblem: bp,
      solutions: sols,
      activeSolutions: sols.length,
      recommendedAction: bp.recommendedAction.charAt(0).toUpperCase() + bp.recommendedAction.slice(1),
      status: theCase ? caseStatusLabel(theCase.status) : bp.status,
      caseId: theCase?.id ?? null,
    };
  });

  const unsupported = solutions.filter((s) => s.ownerName === "Unassigned" || /none/i.test(s.supportModel));
  const pendingReviews = cases.filter(
    (c) => (c.status === "pilot_proposed" || c.status === "approved") && !decisions.some((d) => d.caseId === c.id && d.action === "approve_consolidation"),
  ).length;

  const byCategory = new Map<string, Capability[]>();
  for (const cap of capabilities) {
    const list = byCategory.get(cap.category) ?? [];
    list.push(cap);
    byCategory.set(cap.category, list);
  }
  const duplicateCapabilities = [...byCategory.entries()]
    .filter(([, caps]) => new Set(caps.map((c) => c.sourceSolutionId)).size > 1)
    .map(([category, caps]) => ({
      category,
      // One entry per product that built this category of capability.
      capabilities: caps.filter((cap, index) => caps.findIndex((o) => o.sourceSolutionId === cap.sourceSolutionId) === index),
    }));

  const sharedCapabilityReuse = capabilities.filter((cap) => solutions.filter((s) => s.capabilityIds.includes(cap.id)).length > 1).length;
  const overlapping = businessProblems.filter((bp) => bp.activeSolutionIds.length > 1).length;

  const portfolio: Portfolio = {
    headline: personas.find((p) => p.role === "it")?.headline ?? "",
    valueStatement: `${solutions.length} active solutions across ${businessProblems.length} business problems. ${overlapping} problems have overlapping solutions; ${summaries.filter((s) => s.case.status !== "rejected").length} consolidation case${summaries.length === 1 ? "" : "s"} in progress.`,
    metrics: {
      activeSolutions: solutions.length,
      overlappingGroups: overlapping,
      certified: solutions.filter((s) => s.status === "certified").length,
      experimental: solutions.filter((s) => s.status === "experimental").length,
      withoutOwner: solutions.filter((s) => s.ownerName === "Unassigned").length,
      consolidationOpportunities: businessProblems.filter((bp) => bp.recommendedAction === "consolidate" || bp.recommendedAction === "standardize").length,
      retirementCandidates: solutions.filter((s) => s.retirementCandidate).length,
      sharedCapabilityReuse,
      pendingReviews,
    },
    rows,
    consolidationCases: summaries,
    unsupportedSolutions: unsupported,
    duplicateCapabilities,
  };
  res.json(portfolio);
});

router.get("/portfolio/decision-queue", async (_req, res) => {
  const cases = await listCaseRows();
  const decisions = await listAllDecisions();
  const queue = cases.filter(
    (c) => (c.status === "pilot_proposed" || c.status === "approved" || c.status === "deferred") && !decisions.some((d) => d.caseId === c.id && d.action === "approve_consolidation"),
  );
  res.json(await summarizeAll(queue));
});

router.get("/experiments", async (_req, res) => {
  res.json(await listExperiments());
});

router.get("/experiments/:experimentId", async (req, res) => {
  const experiment = await getExperiment(String(req.params["experimentId"]));
  if (!experiment) {
    res.status(404).json({ error: "Experiment not found" });
    return;
  }
  res.json(experiment);
});

router.post("/demo/reset", async (_req, res) => {
  res.json(await resetDemo());
});

router.get("/demo/state", (_req, res) => {
  res.json(demoState());
});

function caseStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Case open";
    case "simulated":
      return "Simulated";
    case "pilot_proposed":
      return "Decision pending";
    case "approved":
      return "Pilot approved";
    case "changes_requested":
      return "Changes requested";
    case "deferred":
      return "Deferred";
    default:
      return status;
  }
}

export default router;
