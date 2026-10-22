import { Router, type IRouter } from "express";
import type {
  AppRecord,
  CapabilityExplorerEntry,
  CombinationRecord,
  ConsolidatedApp,
  Decision,
  PortfolioAnalytics,
  Solution,
} from "@workspace/api-zod";
import { allCapabilities, businessProblems, getSolution, isRegisteredPrototype, solutions } from "../data/catalog";
import { listAllDecisions, listCaseRows } from "../lib/store";
import { pool } from "@workspace/db";
import { consolidationRecipes } from "../lib/consolidation-recipes";

type SourceMeta = { id: string; name: string; recipeId?: string; provenance?: string; registeredAt?: string; registeredBy?: string; kind?: string };
async function consolidationSources(): Promise<SourceMeta[]> {
  const { rows } = await pool.query("SELECT id, metadata, registered_by, created_at FROM consolidation_sources ORDER BY created_at");
  return rows.map((r: { id: string; metadata: SourceMeta; registered_by: string; created_at: Date }) => ({
    ...r.metadata, id: r.id, name: r.metadata?.name ?? r.id,
    registeredAt: r.metadata?.registeredAt ?? r.created_at.toISOString(), registeredBy: r.metadata?.registeredBy ?? r.registered_by,
  }));
}
type SavedCombined = { id: string; title: string; recipeId: string; baseSolutionId: string; createdAt: string };
async function savedCombinedCases(userId?: string): Promise<SavedCombined[]> {
  if (!userId) return [];
  const { rows } = await pool.query("SELECT id, snapshot, created_at FROM consolidation_cases WHERE user_id=$1 ORDER BY created_at DESC", [userId]);
  return rows.map((r: { id: string; snapshot: Record<string, unknown>; created_at: Date }) => ({
    id: r.id, title: String(r.snapshot?.["title"] ?? "Untitled combination"), recipeId: String(r.snapshot?.["recipeId"] ?? ""),
    baseSolutionId: String(r.snapshot?.["baseSolutionId"] ?? ""), createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Read-only IT analytics. Every count is derived from records returned alongside it; nothing here records a decision.
 * Catalog products are seeded demonstration data and carry no registration timestamp, so "new" only ever counts
 * apps registered through the prototype entrance, whose registration time is persisted.
 */
const router: IRouter = Router();
const NEW_WINDOW_DAYS = 30;
const PROPOSAL_ACTIONS: Decision["action"][] = ["propose_pilot", "propose_capability", "adopt_approach", "merge_approaches"];

const isDemoCase = (c: { id: string; demo?: boolean }) => !!c.demo || c.id.startsWith("case_demo") || c.id === "case_procedure_search";

router.get("/portfolio/analytics", async (_req, res) => {
  const now = Date.now();
  const all = solutions;

  // 1. Apps
  const sources = await consolidationSources();
  const sourceRecords: AppRecord[] = sources.map((s) => ({
    id: s.id, name: s.name, kind: null, status: null, source: "consolidation_source", ownerName: null,
    registeredAt: s.registeredAt ?? null, registeredBy: s.registeredBy ?? null, platform: null, provenance: s.provenance ?? null, demo: false,
  }));
  const sourceIds = new Set(sourceRecords.map((r) => r.id));
  const records: AppRecord[] = [...sourceRecords, ...all.filter((s) => !sourceIds.has(s.id)).map((s): AppRecord => {
    const registered = !!s.origin || isRegisteredPrototype(s.id);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      status: s.status,
      source: registered ? "prototype" : "catalog",
      ownerName: s.ownerName || null,
      registeredAt: s.origin?.registeredAt ?? null,
      registeredBy: null,
      platform: s.origin?.platformName ?? null,
      provenance: registered ? "Registered through the prototype entrance" : "Seeded demonstration catalog; not registered",
      demo: !registered,
    };
  })];
  const registered = records.filter((r) => r.source !== "catalog");
  const newRegistered = registered.filter((r) => r.registeredAt && now - new Date(r.registeredAt).getTime() <= NEW_WINDOW_DAYS * 86_400_000).length;

  // 2. Capabilities: unique ids and the distinct apps that declare them.
  const caps = allCapabilities();
  const recipeCaps = recipeCapabilities(sources);
  const usage = new Map<string, number>();
  for (const s of all) for (const id of s.capabilityIds) usage.set(id, (usage.get(id) ?? 0) + 1);
  const sourceApps = new Set([...caps.map((c) => c.sourceSolutionId).filter((id) => !!getSolution(id)), ...recipeCaps.map((c) => c.sourceId)]);
  const capRecords = [...recipeCaps.map((c) => ({ id: c.id, name: c.name, sourceSolutionId: c.sourceId, sourceSolutionName: c.sourceName, usedBy: 1, demo: false })), ...caps.map((c) => ({
    id: c.id,
    name: c.name,
    sourceSolutionId: c.sourceSolutionId,
    sourceSolutionName: c.sourceSolutionName,
    usedBy: usage.get(c.id) ?? 0,
    demo: !isRegisteredPrototype(c.sourceSolutionId),
  }))];

  // 3. Combinations: a proposal is a recorded decision; approval is IT's latest approve/withdraw; published = folded.
  const cases = await listCaseRows();
  const decisions = await listAllDecisions();
  const combos: CombinationRecord[] = [];
  for (const c of cases) {
    const ds = decisions.filter((d) => d.caseId === c.id);
    const proposal = ds.filter((d) => PROPOSAL_ACTIONS.includes(d.action)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const gov = ds.filter((d) => d.action === "approve_consolidation" || d.action === "withdraw_consolidation").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!proposal && !gov) continue;
    const approved = gov?.action === "approve_consolidation";
    const stage: CombinationRecord["stage"] = gov?.action === "withdraw_consolidation" ? "withdrawn" : approved && c.status === "folded" ? "published" : approved ? "approved" : "proposed";
    combos.push({
      caseId: c.id,
      title: c.title,
      baseSolutionId: c.baseSolutionId,
      baseSolutionName: getSolution(c.baseSolutionId)?.name ?? c.baseSolutionId,
      status: c.status,
      stage,
      proposedAt: proposal?.createdAt ?? null,
      demo: isDemoCase(c),
    });
  }
  const saved = await savedCombinedCases(_req.user?.id);
  const recipeName = new Map(consolidationRecipes.map((r) => [r.id, r.name]));
  for (const c of saved) combos.push({
    caseId: c.id, title: c.title, baseSolutionId: c.baseSolutionId,
    baseSolutionName: sources.find((s) => s.id === c.baseSolutionId)?.name ?? recipeName.get(c.recipeId) ?? (c.baseSolutionId || "Not recorded"),
    status: "saved", stage: "saved", proposedAt: null, demo: false,
  });
  const approvedCount = combos.filter((c) => c.stage === "approved" || c.stage === "published").length;
  const published = combos.filter((c) => c.stage === "published");

  // 4. Adoption: FUSEBOX does not record usage of consolidated apps. The list says which apps adoption would apply to.
  const consolidatedApps: ConsolidatedApp[] = published.map((c) => ({
    solutionId: c.baseSolutionId,
    name: c.baseSolutionName,
    caseId: c.caseId,
    version: getSolution(c.baseSolutionId)?.versions.find((v) => v.caseId === c.caseId)?.version ?? null,
    demo: c.demo,
  }));

  const body: PortfolioAnalytics = {
    generatedAt: new Date(now).toISOString(),
    apps: {
      total: records.length,
      catalog: records.length - registered.length,
      registered: registered.length,
      consolidationSources: sourceRecords.length,
      prototypes: registered.length - sourceRecords.length,
      newRegistered,
      newWindowDays: NEW_WINDOW_DAYS,
      definition: `Registered: consolidation sources and prototypes with a persisted registration record, deduplicated by id. Demo catalog products are seeded demonstration data, not registrations, and have no registration date. "New" counts registrations recorded in the last ${NEW_WINDOW_DAYS} days.`,
      records,
    },
    capabilities: {
      unique: capRecords.length,
      sourceApps: sourceApps.size,
      shared: capRecords.filter((c) => c.usedBy > 1).length,
      definition: "Distinct capabilities in the demo catalog, components declared by registered prototypes, and capabilities named by the registered consolidation recipes. Source apps: distinct apps a capability was first built in. Shared: declared by more than one app.",
      records: capRecords,
    },
    combinations: {
      saved: saved.length,
      proposed: combos.filter((c) => c.stage !== "saved").length,
      approved: approvedCount,
      published: published.length,
      definition: "Saved: combined cases saved in the consolidation workbench; saving or running one is not a proposal. Proposed: experiments with a recorded proposal to the parent product. Approved: IT's latest decision is approve. Published: approved and folded into a successor version. Opening or running a combination is neither approval nor adoption.",
      records: combos,
    },
    adoption: {
      tracked: false,
      note: "FUSEBOX does not record who uses a consolidated app after it is published. Active users, teams and usage over time are not tracked yet.",
      consolidatedApps,
    },
  };
  res.json(body);
});

const governance = (s: Solution | undefined) => (s?.architectureStatus?.trim() ? s.architectureStatus : null);
const val = (v: string | null | undefined) => (v && v.trim() ? v : null);

/** Capabilities the registered consolidation recipes name, from sources actually registered. Only facts in the recipe. */
function recipeCapabilities(sources: SourceMeta[]) {
  const catalogIds = new Set(allCapabilities().map((c) => c.id));
  return consolidationRecipes.flatMap((r) => r.capabilities
    .filter((c) => sources.some((s) => s.id === c.sourceId) && !catalogIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, recipe: r.name, sourceId: c.sourceId, sourceName: sources.find((s) => s.id === c.sourceId)!.name, contract: r.edges.find((e) => e.id === c.edgeId)?.contract ?? null })));
}

router.get("/portfolio/capabilities", async (_req, res) => {
  const recipe: CapabilityExplorerEntry[] = recipeCapabilities(await consolidationSources()).map((c) => ({
    id: c.id, name: c.name, purpose: null, category: null, workflowStep: null, ownerName: null,
    provenance: `Named by the registered ${c.recipe} consolidation recipe`,
    businessProblems: [],
    sourceApps: [{ id: c.sourceId, name: c.sourceName, status: "registered source", link: "", origin: true }],
    reuse: "not_assessed",
    implementation: { platform: null, architecture: null, governanceStatus: null, execution: null, controlType: null, version: null, testCoverage: null, supportStatus: null, evidenceLevel: null, dependsOn: c.contract ? [`Wiring contract: ${c.contract}`] : [] },
    demo: false,
  }));
  const out: CapabilityExplorerEntry[] = [...recipe, ...allCapabilities().map((c): CapabilityExplorerEntry => {
    const users = solutions.filter((s) => s.capabilityIds.includes(c.id));
    const origin = getSolution(c.sourceSolutionId);
    const apps = [...(origin && !users.some((u) => u.id === origin.id) ? [origin] : []), ...users];
    const problemIds = new Set(apps.flatMap((s) => s.businessProblemIds));
    return {
      id: c.id,
      name: c.name,
      purpose: c.description,
      category: c.category,
      workflowStep: c.workflowStep,
      ownerName: val(c.ownerName),
      provenance: isRegisteredPrototype(c.sourceSolutionId) ? "Declared by a registered prototype" : "Seeded demonstration catalog",
      businessProblems: businessProblems.filter((b) => problemIds.has(b.id)).map((b) => ({ id: b.id, name: b.title })),
      sourceApps: apps.map((s) => ({ id: s.id, name: s.name, status: s.status, link: `/solutions/${s.id}`, origin: s.id === c.sourceSolutionId })),
      reuse: users.length > 1 ? "shared" : users.length === 1 ? "single_app" : "not_assessed",
      implementation: {
        platform: origin?.origin?.platformName ?? null,
        architecture: null,
        governanceStatus: governance(origin),
        execution: origin?.execution ?? null,
        controlType: val(c.controlType),
        version: val(c.version),
        testCoverage: val(c.testCoverage),
        supportStatus: val(c.supportStatus),
        evidenceLevel: val(c.evidenceLevel),
        dependsOn: c.dependsOn,
      },
      demo: !isRegisteredPrototype(c.sourceSolutionId),
    };
  })];
  res.json(out);
});

export default router;
