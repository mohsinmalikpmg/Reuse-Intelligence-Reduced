import { desc, eq } from "drizzle-orm";
import { db, briefsTable, casesTable, experimentsTable, decisionsTable } from "@workspace/db";
import type { BriefRow, CaseRow, ExperimentRow, DecisionRow } from "@workspace/db";
import type { Brief, Case, CaseSummary, Decision, Experiment, Role, Solution, SyntheticPersona, ExperimentMetric, SegmentResult } from "@workspace/api-zod";
import { businessProblemById, catalogSolutions, getCapability, getSolution, personas, solutions } from "../data/catalog";
import { type CaseContext, addedExternalModules, candidatesFor, caseContext, defaultConfigValues, defaultModuleStates, moduleBlockedReason } from "./configuration";
import { productionCapabilities } from "./workbench";
import { caseLineage, defaultExperimentTitle } from "./lineage";
import { SIMULATION_LABEL } from "./simulation";
import { consolidationApproved, nextStep } from "./analysis";
import { caseEvidence } from "./evidence";
import { foldedIntoFor } from "./governance";

import { newId } from "./ids";
export { newId };

// ---------- Serializers ----------

export function toBrief(row: BriefRow): Brief {
  return {
    id: row.id,
    rawText: row.rawText,
    fields: row.fields as Brief["fields"],
    today: row.today,
    better: row.better,
    requirements: (Array.isArray(row.requirements) ? row.requirements : []) as Brief["requirements"],
    clarifyingQuestion: row.clarifyingQuestion,
    clarification: row.clarification,
    source: row.source as Brief["source"],
    valueStatement: row.valueStatement,
    confirmed: row.confirmed,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCase(row: CaseRow): Case {
  const c: Case = {
    id: row.id,
    briefId: row.briefId,
    title: row.title,
    businessProblemId: row.businessProblemId,
    baseSolutionId: row.baseSolutionId,
    candidateSolutionIds: row.candidateSolutionIds,
    status: row.status as Case["status"],
    moduleStates: row.moduleStates,
    configValues: row.configValues,
    experimentId: row.experimentId,
    pilotPercent: row.pilotPercent,
    createdByRole: row.createdByRole as Role,
    saved: row.saved,
    requirements: row.requirements ?? [],
    capabilityRequests: row.capabilityRequests ?? [],
    presetInputText: row.presetInputText ?? null,
    parentVersion: row.parentVersion,
    intent: row.intent,
    ownerName: row.ownerName,
    ownerTeam: row.ownerTeam,
    promotionState: row.promotionState as Case["promotionState"],
    demo: row.demo,
    foldedInto: foldedIntoFor(row.id),
    lineage: { parentSolutionId: row.baseSolutionId, parentSolutionName: "", parentVersion: row.parentVersion, fingerprint: "", added: [], removed: [], changedSettings: [], intent: "", intentKey: "", summary: "" },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  // Lineage is derived from the stored configuration every time, so it can never drift from the fingerprint.
  c.lineage = caseLineage(c, caseContext(c));
  return c;
}

export function toExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    caseId: row.caseId,
    label: SIMULATION_LABEL,
    baselineName: row.baselineName,
    challengerName: row.challengerName,
    seed: row.seed,
    cohort: row.cohort as SyntheticPersona[],
    metrics: row.metrics as ExperimentMetric[],
    segments: row.segments as SegmentResult[],
    risks: row.risks,
    confidence: row.confidence,
    recommendation: row.recommendation as Experiment["recommendation"],
    narrative: row.narrative,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    caseId: row.caseId,
    role: row.role as Role,
    actor: row.actor,
    action: row.action as Decision["action"],
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------- Briefs ----------

export async function listBriefs(): Promise<Brief[]> {
  const rows = await db.select().from(briefsTable).orderBy(desc(briefsTable.createdAt));
  return rows.map(toBrief);
}

export async function getBrief(id: string): Promise<Brief | null> {
  const [row] = await db.select().from(briefsTable).where(eq(briefsTable.id, id));
  return row ? toBrief(row) : null;
}

// ---------- Cases ----------

export async function listCaseRows(): Promise<Case[]> {
  const rows = await db.select().from(casesTable).orderBy(desc(casesTable.updatedAt));
  return rows.map(toCase);
}

export async function getCase(id: string): Promise<Case | null> {
  const [row] = await db.select().from(casesTable).where(eq(casesTable.id, id));
  return row ? toCase(row) : null;
}

export async function findCaseForBrief(briefId: string): Promise<Case | null> {
  const [row] = await db.select().from(casesTable).where(eq(casesTable.briefId, briefId)).orderBy(desc(casesTable.updatedAt)).limit(1);
  return row ? toCase(row) : null;
}

/** Candidate solutions = every other solution addressing the same business problem(s) as the base. */
export class CaseInputError extends Error {}

export async function createCase(input: {
  baseSolutionId: string;
  briefId?: string | null;
  title?: string;
  intent?: string | null;
  createdByRole?: Role;
  id?: string;
  moduleIds?: string[];
  /** Load this published configuration into Version B, with Version A as the standard configuration it was approved on top of. */
  approvedVersion?: string;
  owner?: { name: string; team: string };
  demo?: boolean;
  /** Input text the case opens with, e.g. a prototype's worked example. */
  presetInputText?: string | null;
}): Promise<Case> {
  const live = getSolution(input.baseSolutionId);
  if (!live) throw new Error(`Unknown solution ${input.baseSolutionId}`);
  const approved = input.approvedVersion ? live.versions.find((v) => v.state === "current" && v.version === input.approvedVersion) : undefined;
  if (input.approvedVersion && !approved) throw new CaseInputError(`v${input.approvedVersion} is not an approved configuration of ${live.name}.`);
  // "Try both": A is the catalog (standard) configuration, so the branch point is the catalog version, not the live one.
  const parentVersion = approved ? (catalogSolutions.find((s) => s.id === live.id)?.currentVersion ?? live.currentVersion) : live.currentVersion;
  const base = approved ? (getSolution(live.id, parentVersion) ?? live) : live;
  const candidateSolutionIds = candidatesFor(base);
  const ctx = caseContext({ baseSolutionId: base.id, candidateSolutionIds, parentVersion });
  const businessProblemId = base.businessProblemIds[0] ?? "bp-unknown";
  const id = input.id ?? newId("case");
  // Version B starts equal to Version A: base optional modules follow their evidence, additions from other
  // solutions stay off until the user adds them. The tray still marks the recommended ones.
  const moduleStates = defaultModuleStates(ctx);
  for (const cap of ctx.candidateCapabilities) moduleStates[cap.id] = false;
  // Modules chosen through a reuse check or a library "Try in" start switched on in Version B, so the first run already
  // shows them. A module that cannot actually run on this base is refused rather than silently ignored.
  const wanted = input.moduleIds ?? [];
  for (const id of wanted) {
    const cap = ctx.candidateCapabilities.find((c) => c.id === id) ?? getCapability(id);
    if (!cap) throw new CaseInputError(`Unknown capability ${id}.`);
    const blocked = moduleBlockedReason(cap, ctx, wanted);
    if (blocked) throw new CaseInputError(`${cap.name} cannot be tried in ${base.name}: ${blocked}`);
    moduleStates[id] = true;
  }
  const configValues = defaultConfigValues(ctx);
  if (approved) {
    // Version B = the approved configuration exactly as it resolves at that version: every capability it runs (including
    // those folded in by earlier published versions) and its setting values, so a later configuration is reproduced whole.
    const target = getSolution(live.id, approved.version);
    if (!target) throw new CaseInputError(`v${approved.version} of ${live.name} could not be resolved.`);
    const known = new Set([...ctx.baseCapabilities, ...ctx.candidateCapabilities].map((cap) => cap.id));
    const resolved = productionCapabilities(target);
    const activeIds = new Set(resolved.active.map((cap) => cap.id));
    for (const cap of ctx.baseCapabilities) if (cap.controlType === "optional") moduleStates[cap.id] = activeIds.has(cap.id);
    for (const cap of ctx.candidateCapabilities) moduleStates[cap.id] = activeIds.has(cap.id);
    for (const capId of activeIds) if (!known.has(capId)) throw new CaseInputError(`v${approved.version} runs ${capId}, which is not available on the standard configuration.`);
    for (const [capId, value] of Object.entries(resolved.configValues)) if (ctx.baseCapabilities.some((cap) => cap.id === capId && cap.controlType === "configurable")) configValues[capId] = value;
  }
  const role = input.createdByRole ?? "seeker";
  const persona = personas.find((p) => p.role === role);
  const owner = input.owner ?? { name: persona?.name ?? role, team: persona?.team ?? "" };
  const [row] = await db
    .insert(casesTable)
    .values({
      id,
      briefId: input.briefId ?? null,
      // Never a product of its own: the title says which product and version it branches from.
      title: input.title ?? (approved ? `${base.name} v${parentVersion} vs v${approved.version}` : defaultExperimentTitle(base.name, parentVersion)),
      businessProblemId,
      baseSolutionId: base.id,
      candidateSolutionIds,
      status: "draft",
      moduleStates,
      configValues,
      experimentId: null,
      pilotPercent: 10,
      createdByRole: role,
      saved: false,
      parentVersion,
      intent: input.intent?.trim() || null,
      ownerName: owner.name,
      ownerTeam: owner.team,
      promotionState: "experiment",
      demo: input.demo ?? false,
      presetInputText: input.presetInputText?.trim() || null,
    })
    .returning();
  return toCase(row!);
}

export async function updateCaseRow(id: string, patch: Partial<Omit<CaseRow, "id" | "createdAt" | "updatedAt">>): Promise<Case> {
  const [row] = await db.update(casesTable).set(patch).where(eq(casesTable.id, id)).returning();
  if (!row) throw new Error(`Case ${id} not found`);
  return toCase(row);
}

// ---------- Experiments & decisions ----------

export async function listExperiments(): Promise<Experiment[]> {
  const rows = await db.select().from(experimentsTable).orderBy(desc(experimentsTable.createdAt));
  return rows.map(toExperiment);
}

export async function getExperiment(id: string): Promise<Experiment | null> {
  const [row] = await db.select().from(experimentsTable).where(eq(experimentsTable.id, id));
  return row ? toExperiment(row) : null;
}

export async function insertExperiment(exp: Omit<Experiment, "createdAt">): Promise<Experiment> {
  const [row] = await db
    .insert(experimentsTable)
    .values({
      id: exp.id,
      caseId: exp.caseId,
      baselineName: exp.baselineName,
      challengerName: exp.challengerName,
      seed: exp.seed,
      cohort: exp.cohort,
      metrics: exp.metrics,
      segments: exp.segments,
      risks: exp.risks,
      confidence: exp.confidence,
      recommendation: exp.recommendation,
      narrative: exp.narrative,
    })
    .returning();
  return toExperiment(row!);
}

export async function listDecisions(caseId: string): Promise<Decision[]> {
  const rows = await db.select().from(decisionsTable).where(eq(decisionsTable.caseId, caseId)).orderBy(desc(decisionsTable.createdAt));
  return rows.map(toDecision);
}

export async function listAllDecisions(): Promise<Decision[]> {
  const rows = await db.select().from(decisionsTable).orderBy(desc(decisionsTable.createdAt));
  return rows.map(toDecision);
}

export async function insertDecision(d: Omit<Decision, "createdAt">): Promise<Decision> {
  const [row] = await db.insert(decisionsTable).values({ id: d.id, caseId: d.caseId, role: d.role, actor: d.actor, action: d.action, reason: d.reason }).returning();
  return toDecision(row!);
}

// ---------- Summaries ----------

export async function summarize(c: Case, ctx?: CaseContext): Promise<CaseSummary> {
  const context = ctx ?? caseContext(c);
  const experiment = c.experimentId ? await getExperiment(c.experimentId) : null;
  const decisions = await listDecisions(c.id);
  const evidence = await caseEvidence(c);
  const latestDecision = decisions[0] ?? null;
  return {
    case: c,
    baseSolution: context.base,
    businessProblemTitle: businessProblemById.get(c.businessProblemId)?.title ?? c.businessProblemId,
    addedCapabilities: addedExternalModules(c, context).map((cap) => cap.name),
    experimentRecommendation: experiment?.recommendation ?? null,
    latestDecision,
    nextStep: nextStep(c, evidence, latestDecision, consolidationApproved(decisions)),
  };
}

export async function summarizeAll(cases: Case[]): Promise<CaseSummary[]> {
  return Promise.all(cases.map((c) => summarize(c)));
}

export async function clearAll(): Promise<void> {
  await db.delete(decisionsTable);
  await db.delete(experimentsTable);
  await db.delete(casesTable);
  await db.delete(briefsTable);
}

export { briefsTable, casesTable, db };
