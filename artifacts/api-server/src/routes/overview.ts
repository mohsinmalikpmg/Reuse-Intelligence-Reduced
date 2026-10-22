import { Router, type IRouter } from "express";
import type {
  Case,
  Decision,
  Evaluation,
  OwnedSolution,
  OwnerOverview,
  OwnerSolution,
  Portfolio,
  PortfolioMetric,
  PortfolioMetrics,
  QueueItem,
  RedirectEvent,
  SeekerOverview,
  Solution,
} from "@workspace/api-zod";
import { DEMO_PROMPT, OWNER_PERSONA_NAME, businessProblems, getSolution, personas, solutions, sortByMaturity } from "../data/catalog";
import { consolidationApproved } from "../lib/analysis";
import { versionForCase } from "../lib/governance";
import { listReuseEvents } from "../lib/reuse-store";
import { duplicatesCertified, listPrototypeRows } from "../lib/prototypes";
import { savedBriefMatch } from "../lib/matching";
import { demoState, resetDemo } from "../lib/seed";
import { getExperiment, listAllDecisions, listBriefs, listCaseRows, listExperiments, summarizeAll } from "../lib/store";
import { currentFingerprints } from "../lib/workbench";
import { GroupDecisionError, experimentsInProgress, improvementGroupDetail, improvementGroups, recordGroupDecision } from "../lib/experiments";
import { RecordGroupDecisionBody } from "@workspace/api-zod";
import { listAllEvaluations, listAllRuns } from "../lib/workbench-store";

/** True when a vote was cast on the case's current Version B against the governed baseline. */
function countsForCase(e: Evaluation, cur: { a: string; b: string } | undefined): boolean {
  return !!cur && e.fingerprintA === cur.a && e.fingerprintB === cur.b;
}

const router: IRouter = Router();

router.get("/home/seeker", async (_req, res) => {
  const briefs = await listBriefs();
  const cases = await listCaseRows();
  const recent = briefs.slice(0, 5);
  const recommendedIds = new Set<string>();
  for (const brief of recent) {
    const rec = (await savedBriefMatch(brief))?.matches.find((m) => m.recommended);
    if (rec) recommendedIds.add(rec.solution.id);
  }
  const recommendedSolutions = sortByMaturity(solutions.filter((s) => recommendedIds.has(s.id))).slice(0, 4);
  const overview: SeekerOverview = {
    headline: recommendedIds.size ? personas.find((p) => p.role === "seeker")?.headline ?? "" : "No saved AI recommendations yet. Describe a need to request analysis.",
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
    const pending = solutionCases.filter((c) => ["tested", "pilot_proposed", "deferred"].includes(c.status));
    const latest = solutionCases
      .map((c) => decisions.find((d) => d.caseId === c.id))
      .find((d) => d);
    return {
      solution,
      pendingChanges: pending.length,
      openExperiments: solutionCases.filter((c) => c.experimentId && c.status === "tested").length,
      sharedCapabilityCount: solution.capabilityIds.filter((id) => solutions.some((o) => o.id !== solution.id && o.capabilityIds.includes(id))).length,
      proposedDecision: pending.length === 0 ? null : latest ? `${latest.actor}: ${latest.action.replace(/_/g, " ")}` : "Awaiting your review",
    };
  });

  const proposedChanges = await summarizeAll(open.filter((c) => ["tested", "pilot_proposed", "changes_requested", "deferred"].includes(c.status)));
  const pendingExperiments = experiments.filter((e) => open.find((c) => c.id === e.caseId)?.status === "tested");
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

router.get("/my-solutions", async (_req, res) => {
  const mine = solutions.filter((s) => s.ownerName === OWNER_PERSONA_NAME);
  const cases = (await listCaseRows()).filter((c) => c.status !== "rejected");
  const runs = await listAllRuns();
  const evaluations = await listAllEvaluations();
  const decisions = await listAllDecisions();
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const currentByCase = new Map(cases.map((c) => [c.id, currentFingerprints(c)]));
  const countsForCurrent = (e: Evaluation) => countsForCase(e, currentByCase.get(e.caseId));
  const out: OwnedSolution[] = [];
  for (const solution of mine) {
    const proposals = cases.filter((c) => c.baseSolutionId === solution.id && c.status !== "draft");
    const proposalIds = new Set(proposals.map((c) => c.id));
    const ownerDecided = new Set(decisions.filter((d) => d.role === "owner").map((d) => d.caseId));
    out.push({
      solution,
      proposals: await summarizeAll(proposals),
      groups: await improvementGroups(solution.id, cases),
      experimentsInProgress: experimentsInProgress(solution.id, cases).length,
      openTests: proposals.filter((c) => runs.some((r) => r.caseId === c.id) && !ownerDecided.has(c.id)).length,
      evaluations: evaluations.filter((e) => proposalIds.has(e.caseId) && countsForCurrent(e)).length,
      evaluationsSetAside: evaluations.filter((e) => proposalIds.has(e.caseId) && !countsForCurrent(e)).length,
      recentRuns: runs.filter((r) => r.solutionId === solution.id && new Date(r.createdAt).getTime() >= since).length,
    });
  }
  res.json(out);
});

router.get("/my-solutions/:solutionId/groups/:groupKey", async (req, res) => {
  const detail = await improvementGroupDetail(String(req.params["solutionId"]), String(req.params["groupKey"]));
  if (!detail) {
    res.status(404).json({ error: "This improvement group no longer exists." });
    return;
  }
  res.json(detail);
});

router.post("/my-solutions/:solutionId/groups/:groupKey/decisions", async (req, res) => {
  const parsed = RecordGroupDecisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const detail = await recordGroupDecision(String(req.params["solutionId"]), String(req.params["groupKey"]), parsed.data);
    if (!detail) {
      res.status(404).json({ error: "This improvement group no longer exists." });
      return;
    }
    res.status(201).json(detail);
  } catch (err) {
    if (err instanceof GroupDecisionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** Median of a list of numbers; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function humanDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days} day${days === 1 ? "" : "s"}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Decisions that put an improvement in front of its parent product's owner. */
const PROPOSAL_ACTIONS: Decision["action"][] = ["propose_pilot", "propose_capability", "adopt_approach", "merge_approaches"];

router.get("/portfolio", async (_req, res) => {
  const cases = await listCaseRows();
  const decisions = await listAllDecisions();
  const reuseEvents = await listReuseEvents();
  const runs = await listAllRuns();
  const evaluations = await listAllEvaluations();
  const approvedByIt = (c: Case) => consolidationApproved(decisions.filter((d) => d.caseId === c.id));

  // Every number is computed from persisted or catalog data and carries its definition. A metric with nothing to
  // count says so; it is never shown as 0%.
  const metric = (key: keyof PortfolioMetrics, question: string, label: string, numerator: number | null, denominator: number | null, value: string | null, definition: string, demo: boolean): PortfolioMetric => ({
    key,
    question,
    label,
    value: value ?? "No data yet",
    numerator,
    denominator,
    definition,
    demo,
  });

  // 1. Reuse before build: creation attempts (a step, a requirement, a search, a brief) that ended in an existing
  //    solution or capability. Only recorded choices count: "use"/"improve" are written when a capability is actually
  //    tried or improved in a workbench (or a case is created from the check), "create" when a new approach or
  //    capability request is recorded, "dismissed" when the check is closed. Opening a page ("explored") and
  //    hard-excluded options are never reuse.
  const decided = reuseEvents.filter((e) => e.pathTaken !== null && e.pathTaken !== "explored");
  const redirected = decided.filter((e) => (e.pathTaken === "use" || e.pathTaken === "improve") && e.pathRecommended !== "hard_exclusion");
  const reuseBeforeBuild = metric(
    "reuseBeforeBuild",
    "Are people finding existing solutions before building?",
    "Reuse before build",
    decided.length ? redirected.length : null,
    decided.length ? decided.length : null,
    decided.length ? `${redirected.length} of ${decided.length} attempts` : null,
    "Numerator: reuse checks (a step, a requirement, a search or a brief) where the person actually tried or improved an existing solution or capability in a workbench. Denominator: reuse checks that ended in a recorded choice (tried, improved, created a new approach, or dismissed). Checks still open, or where a page was only opened, are not counted; excluded options never count as reuse.",
    decided.some((e) => e.demo),
  );

  // 2. Existing capability acceptance: when the check surfaced a credible capability (score >= 60), was it tried?
  const suggested = decided.filter((e) => e.bestCapabilityId !== null && (e.bestScore ?? 0) >= 60 && e.pathRecommended !== "hard_exclusion");
  const tried = suggested.filter((e) => e.pathTaken === "use");
  const capabilityAcceptance = metric(
    "capabilityAcceptance",
    "Are repeated needs becoming shared capabilities?",
    "Existing capability acceptance",
    suggested.length ? tried.length : null,
    suggested.length ? suggested.length : null,
    suggested.length ? `${tried.length} of ${suggested.length} suggestions tried` : null,
    "Numerator: suggested capabilities (reuse-fit score 60 or more, not excluded by a rule) the person actually tried in a workbench. Denominator: reuse checks that suggested such a capability and ended in a recorded choice; opening a page is not a choice.",
    suggested.some((e) => e.demo),
  );

  // 3. Improvements folded into parent products: proposals that became a published successor version. A proposal is
  //    a recorded decision, not a status: the seeker proposed it to the parent, or the owner adopted it from a grouped
  //    review. A case rejected or kept local without ever being proposed is not a proposal.
  const proposed = cases.filter((c) => decisions.some((d) => d.caseId === c.id && PROPOSAL_ACTIONS.includes(d.action)));
  const folded = proposed.filter((c) => c.status === "folded" && approvedByIt(c));
  const improvementsFolded = metric(
    "improvementsFolded",
    "Are experiments being folded into their parent products?",
    "Improvements folded into parent products",
    proposed.length ? folded.length : null,
    proposed.length ? proposed.length : null,
    proposed.length ? `${folded.length} of ${proposed.length} proposals` : null,
    "Numerator: proposed improvements IT published as a successor version of the parent product. Denominator: experiments with a recorded proposal to the parent (proposed by the seeker, or adopted by the owner from a grouped review), whatever happened next. Experiments never proposed are not counted, even if rejected.",
    proposed.some((c) => c.demo) || folded.some((c) => c.id.startsWith("case_demo")),
  );

  // 4. Production variants per solution family: products still in production for each business problem.
  //    A product leaves production only when its retirement is confirmed and its users' migration is recorded.
  const inProduction = (s: Solution) => s.status !== "deprecated" && !(s.disposition?.state === "confirmed" && s.disposition.kind === "retire" && s.disposition.migrationNote);
  const families = businessProblems.map((bp) => ({ bp, variants: solutions.filter((s) => bp.activeSolutionIds.includes(s.id) && inProduction(s)) }));
  const variantCount = families.reduce((n, f) => n + f.variants.length, 0);
  const baselineCount = businessProblems.reduce((n, bp) => n + bp.activeSolutionIds.filter((id) => solutions.find((s) => s.id === id)?.status !== "deprecated").length, 0);
  const scheduled = solutions.filter((s) => s.disposition?.state === "confirmed" && s.disposition.kind === "retire" && !s.disposition.migrationNote).length;
  const perFamily = families.length ? Math.round((variantCount / families.length) * 10) / 10 : null;
  const variantsPerFamily = metric(
    "variantsPerFamily",
    "Are supported variants rising or falling?",
    "Production variants per solution family",
    families.length ? variantCount : null,
    families.length ? families.length : null,
    perFamily === null ? null : `${perFamily} per family${variantCount < baselineCount ? ` (down from ${Math.round((baselineCount / families.length) * 10) / 10})` : scheduled ? ` · ${plural(scheduled, "retirement")} scheduled` : ""}`,
    `Numerator: products in production across all business problems (not deprecated; a confirmed retirement counts until its migration is recorded). Denominator: business problems in the catalog. Catalog baseline: ${baselineCount} products. ${scheduled ? `${plural(scheduled, "retirement")} scheduled, migration not yet recorded.` : "No retirements scheduled."}`,
    true,
  );

  // Failure measure 1: duplicate effort found after development — products built for a problem that already had one.
  const duplicates = families.reduce((n, f) => n + Math.max(0, f.variants.length - 1), 0);
  const duplicateAfterBuild = metric(
    "duplicateAfterBuild",
    "Duplicate effort found after development",
    "Duplicate effort found after development",
    variantCount ? duplicates : null,
    variantCount ? variantCount : null,
    variantCount ? `${duplicates} of ${variantCount} products` : null,
    "Numerator: products in production that address a business problem another product already addressed (each family counts all but one of its products). Denominator: products in production. Catalog is seeded demonstration data.",
    true,
  );

  // Failure measure 2: time from opening an experiment to its first recorded human comparison.
  const firstVoteByCase = new Map<string, number>();
  for (const e of evaluations) {
    const t = new Date(e.createdAt).getTime();
    const prev = firstVoteByCase.get(e.caseId);
    if (prev === undefined || t < prev) firstVoteByCase.set(e.caseId, t);
  }
  const durations = cases
    .filter((c) => firstVoteByCase.has(c.id))
    .map((c) => Math.max(0, firstVoteByCase.get(c.id)! - new Date(c.createdAt).getTime()));
  const med = median(durations);
  const timeToFirstTest = metric(
    "timeToFirstTest",
    "Time to first useful test",
    "Time to first useful test",
    med === null ? null : durations.length,
    null,
    med === null ? null : `${humanDuration(med)} (median)`,
    `Median time from opening an experiment to the first recorded comparison of its two outputs by a person, over ${plural(durations.length, "experiment")} with a recorded vote. ${runs.length ? `${plural(runs.length, "run")} recorded in total.` : "No runs recorded yet."}`,
    evaluations.some((e) => e.demo && firstVoteByCase.get(e.caseId) === new Date(e.createdAt).getTime()),
  );

  const metrics: PortfolioMetrics = { reuseBeforeBuild, capabilityAcceptance, improvementsFolded, variantsPerFamily, duplicateAfterBuild, timeToFirstTest };

  // Exception queue: only what needs IT. Routine experiments and seeker activity never appear.
  const queue: QueueItem[] = [];
  const isDemo = (c: Case) => c.demo || c.id.startsWith("case_demo") || c.id === "case_procedure_search";
  for (const c of cases.filter((x) => x.status === "approved" && !approvedByIt(x))) {
    const base = getSolution(c.baseSolutionId);
    const draft = versionForCase(c.id);
    queue.push({
      id: `approval-${c.id}`,
      kind: "consolidation_approval",
      title: `${base?.name ?? c.baseSolutionId}: ${draft ? `publish v${draft.version}` : "consolidation direction"}`,
      detail: `${c.ownerName} proposed "${c.title}"; the owner approved it. ${draft ? `Draft v${draft.version} is recorded${draft.foldedCapabilities.length ? ` with ${draft.foldedCapabilities.map((cap) => cap.name).join(" and ")} folded in` : ""}.` : ""}`.trim(),
      usage: base ? `${plural(base.activeUsers, "user")} on v${base.currentVersion}` : null,
      actionLabel: "Approve direction",
      caseId: c.id,
      solutionId: c.baseSolutionId,
      demo: isDemo(c),
    });
  }
  for (const s of solutions.filter((x) => x.status !== "deprecated" && !x.origin && (x.ownerName === "Unassigned" || /none/i.test(x.supportModel)))) {
    // The case that decides its fate: the one holding its disposition, else the furthest-along case that overlaps it.
    const covering =
      (s.disposition ? cases.find((c) => c.id === s.disposition?.caseId) : undefined) ??
      cases.find((c) => c.status !== "rejected" && c.status !== "draft" && c.candidateSolutionIds.includes(s.id)) ??
      cases.find((c) => c.status !== "rejected" && c.candidateSolutionIds.includes(s.id)) ??
      null;
    queue.push({
      id: `unowned-${s.id}`,
      kind: "unowned_product",
      title: `${s.name}: no ${s.ownerName === "Unassigned" ? "owner" : "support"}`,
      detail: `${s.ownerName === "Unassigned" ? "No named owner" : "No support model"}; ${s.supportModel.toLowerCase()}. ${s.disposition ? s.disposition.label + "." : covering ? `Its fate is decided under "${covering.title}".` : "Nobody has proposed what happens to it."}`,
      usage: `${plural(s.activeUsers, "user")} · ${s.status}`,
      actionLabel: covering ? "Decide its fate" : "Open product",
      caseId: covering?.id ?? null,
      solutionId: s.id,
      demo: true,
    });
  }
  for (const s of solutions) {
    const d = s.disposition;
    if (!d || d.state !== "confirmed" || d.kind !== "retire" || d.migrationNote) continue;
    const c = cases.find((x) => x.id === d.caseId);
    queue.push({
      id: `migration-${s.id}`,
      kind: "migration_pending",
      title: `${s.name}: retirement scheduled, migration not recorded`,
      detail: `Confirmed under "${c?.title ?? d.caseId}". Its ${plural(s.activeUsers, "user")} still need a recorded destination before standalone use ends.`,
      usage: `${plural(s.activeUsers, "user")} · ${s.businessUnits.join(", ")}`,
      actionLabel: "Record migration",
      caseId: d.caseId,
      solutionId: s.id,
      demo: c ? isDemo(c) : false,
    });
  }
  // Registered prototypes reach IT only when a decision is needed: nobody owns it, or it duplicates a certified product.
  for (const p of listPrototypeRows()) {
    const dup = duplicatesCertified(p);
    const noOwner = !p.ownerName;
    if (!dup && !noOwner) continue;
    const dupOf = p.components.filter((c) => c.verdict === "duplicates" && c.matchedSolutionId && getSolution(c.matchedSolutionId)?.status === "certified");
    const certified = [...new Set(dupOf.map((c) => c.matchedSolutionName))].filter(Boolean).join(", ");
    queue.push({
      id: `prototype-${p.id}`,
      kind: "registered_prototype",
      title: `${p.name}: ${dup ? `duplicates ${certified}` : "registered without an owner"}`,
      detail: `Registered from ${p.platformName} by ${p.createdBy || "its builder"}, used by ${p.users}. ${dup ? `${dupOf.map((c) => c.name).join(", ")} ${dupOf.length === 1 ? "is" : "are"} already in ${certified}${noOwner ? "; no owner recorded" : ""}.` : "No owner recorded; nobody is accountable for its users."} ${p.recommendation}`,
      usage: `${p.exampleCount} submitted example${p.exampleCount === 1 ? "" : "s"} · not run by FUSEBOX`,
      actionLabel: "Open prototype",
      caseId: null,
      solutionId: p.id,
      demo: false,
    });
  }
  for (const c of cases.filter((x) => x.promotionState === "new_family_requested" && x.status === "pilot_proposed")) {
    const request = decisions.find((d) => d.caseId === c.id && d.action === "request_new_family");
    queue.push({
      id: `family-${c.id}`,
      kind: "new_family_request",
      title: `New solution family requested: ${c.title}`,
      detail: `${request?.actor ?? c.ownerName} says ${c.lineage.parentSolutionName} cannot absorb it${request?.reason ? `: "${request.reason}"` : "."}`,
      usage: null,
      actionLabel: "Review the request",
      caseId: c.id,
      solutionId: c.baseSolutionId,
      demo: isDemo(c),
    });
  }

  // Redirected before build: prevention, in plain language, newest first.
  const redirects: RedirectEvent[] = redirected.slice(0, 8).map((e) => ({
    id: e.id,
    actor: e.actor,
    need: e.need,
    outcome:
      e.trigger === "prototype"
        ? e.pathTaken === "use"
          ? `connected a prototype to ${e.bestTitle ?? "an existing product"} as a module instead of keeping a copy`
          : `folded a prototype into ${e.bestTitle ?? "an existing product"} instead of keeping a copy`
        : e.pathTaken === "use"
          ? `tried ${e.bestTitle ?? "an existing capability"} instead of building`
          : `started from ${e.bestTitle ?? "an existing solution"} and improved it`,
    at: e.createdAt,
    demo: e.demo,
  }));

  const portfolio: Portfolio = {
    headline: personas.find((p) => p.role === "it")?.headline ?? "",
    valueStatement: `${plural(queue.length, "item")} need${queue.length === 1 ? "s" : ""} an IT decision. ${plural(redirected.length, "build")} redirected to existing work so far; ${plural(folded.length, "improvement")} published into ${folded.length === 1 ? "its" : "their"} parent product.`,
    metrics,
    queue,
    redirects,
  };
  res.json(portfolio);
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

export default router;
