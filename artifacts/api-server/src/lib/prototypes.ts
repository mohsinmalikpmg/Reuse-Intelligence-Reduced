/**
 * Registered prototypes: the records behind the "I have a prototype" entrance. Each one becomes a catalogue entry of
 * kind "prototype" with execution "preview" (FUSEBOX never runs it) and its confirmed components become declared
 * capabilities with the prototype as source. Persisted; removed ones are kept (soft delete) so Undo can restore them.
 */
import { desc, eq } from "drizzle-orm";
import { db, registeredPrototypesTable } from "@workspace/db";
import type { PrototypeComponentRow, RegisteredPrototypeRow } from "@workspace/db";
import type { Capability, Metrics, PrototypeAnalysis, PrototypeIntake, RegisteredPrototype, Role, Solution } from "@workspace/api-zod";
import { getSolution, personas, setRegisteredPrototypes } from "../data/catalog";
import { inferWorkflowSteps } from "./reuse-check";
import { newId } from "./ids";

const ZERO: Metrics = { taskMinutes: 0, successRate: 0, effortScore: 0, errorRate: 0, adoption: 0, costPerTask: 0 };

export const NOT_RUN = "Not run by FUSEBOX";

function componentCapabilityId(prototypeId: string, componentId: string): string {
  return `cap-${prototypeId}-${componentId}`;
}

function toCapabilities(row: RegisteredPrototypeRow): Capability[] {
  return row.components.map((c) => ({
    id: componentCapabilityId(row.id, c.id),
    name: c.name,
    description: c.description,
    category: "Declared component",
    sourceSolutionId: row.id,
    sourceSolutionName: row.name,
    ownerName: row.ownerName || "Unassigned",
    controlType: "optional",
    workflowStep: inferWorkflowSteps(`${c.name}. ${c.description}`)[0] ?? "Analyze",
    riskClass: row.riskTier as Capability["riskClass"],
    evidenceLevel: "none",
    lockedReason: null,
    options: null,
    defaultOption: null,
    effects: ZERO,
    incompatibleWith: [],
    dependsOn: [],
    testCoverage: "None recorded",
    supportStatus: `Declared by its builder · ${NOT_RUN}`,
    version: "0.1",
    evidence: `Submitted example only · ${NOT_RUN}`,
  }));
}

function toSolution(row: RegisteredPrototypeRow): Solution {
  const compared = row.comparedSolutionId ? getSolution(row.comparedSolutionId) : undefined;
  const caps = toCapabilities(row);
  const steps = [...new Set(caps.map((c) => c.workflowStep))];
  const n = row.examples.length;
  return {
    id: row.id,
    name: row.name,
    businessFunction: compared?.businessFunction ?? "Operations",
    primaryUsers: [row.users],
    workflowType: "Prototype, outside FUSEBOX",
    outputType: row.components[0]?.name ?? "Pasted output",
    riskTier: row.riskTier as Solution["riskTier"],
    dataInvolved: row.dataInvolved,
    controls: [],
    execution: "preview",
    outputPreview: null,
    disposition: null,
    production: null,
    origin: { platformKind: row.platformKind as NonNullable<Solution["origin"]>["platformKind"], platformName: row.platformName, link: row.link, registeredAt: row.createdAt.toISOString() },
    outcome: row.description,
    description: `${row.description} Built on ${row.platformName} and used by ${row.users}. Registered by ${row.createdBy || "its builder"} with ${n} worked example${n === 1 ? "" : "s"}; FUSEBOX has not run it.`,
    status: "experimental",
    kind: "prototype",
    ownerName: row.ownerName || "Unassigned",
    ownerTeam: row.ownerTeam,
    businessUnits: [],
    activeUsers: 0,
    evidenceLevel: "none",
    timeToAdopt: "Not measured",
    adoptionEffort: "high",
    workflowSteps: steps,
    currentVersion: "0.1",
    versions: [{ version: "0.1", releasedAt: row.createdAt.toISOString().slice(0, 10), summary: `Registered from ${row.platformName} with ${n} worked example${n === 1 ? "" : "s"}.`, state: "released", caseId: null, foldedCapabilities: [], changedSettings: [] }],
    knownGaps: [`${NOT_RUN}: no evidence, no A/B comparison, no blind tests.`, `Runs on ${row.platformName}, outside the approved platform; adopting it means rebuilding on one or connecting an adapter.`],
    dependencies: [row.platformName],
    capabilityIds: caps.map((c) => c.id),
    businessProblemIds: row.businessProblemIds,
    baselineMetrics: ZERO,
    retirementCandidate: false,
    architectureStatus: `Runs on ${row.platformName}, outside FUSEBOX`,
    controlStatus: "Not assessed",
    supportModel: row.ownerName ? `${row.ownerTeam || row.ownerName}, best effort` : "No owner recorded",
    lastReviewedAt: row.createdAt.toISOString().slice(0, 10),
  };
}

export function toRegisteredPrototype(row: RegisteredPrototypeRow): RegisteredPrototype {
  const compared = row.comparedSolutionId ? getSolution(row.comparedSolutionId) : undefined;
  return {
    id: row.id,
    name: row.name,
    platformKind: row.platformKind as RegisteredPrototype["platformKind"],
    platformName: row.platformName,
    link: row.link,
    users: row.users,
    ownerName: row.ownerName,
    ownerTeam: row.ownerTeam,
    description: row.description,
    dataInvolved: row.dataInvolved,
    riskTier: row.riskTier as RegisteredPrototype["riskTier"],
    examples: row.examples,
    components: row.components,
    recommendedPath: row.recommendedPath as RegisteredPrototype["recommendedPath"],
    recommendation: row.recommendation,
    comparedSolutionId: row.comparedSolutionId,
    comparedSolutionName: compared?.name ?? null,
    reuseEventId: row.reuseEventId,
    createdBy: row.createdBy,
    createdByRole: row.createdByRole as Role,
    createdAt: row.createdAt.toISOString(),
    removed: row.removedAt !== null,
  };
}

// ---------- persistence ----------

let rows: RegisteredPrototypeRow[] = [];

function publish(): void {
  const live = rows.filter((r) => r.removedAt === null);
  setRegisteredPrototypes({ solutions: live.map(toSolution), capabilities: live.flatMap(toCapabilities) });
}

/** Load every registered prototype (including removed ones, so restore works after a restart) and merge the live ones into the catalogue. */
export async function loadPrototypes(): Promise<void> {
  rows = await db.select().from(registeredPrototypesTable).orderBy(desc(registeredPrototypesTable.createdAt));
  publish();
}

export function listPrototypeRows(comparedTo?: string): RegisteredPrototypeRow[] {
  return rows.filter((r) => r.removedAt === null && (!comparedTo || r.comparedSolutionId === comparedTo));
}

export function getPrototypeRow(id: string): RegisteredPrototypeRow | undefined {
  return rows.find((r) => r.id === id);
}

export async function registerPrototype(intake: PrototypeIntake, analysis: PrototypeAnalysis, role: Role, reuseEventId: string | null): Promise<RegisteredPrototypeRow> {
  const id = newId("proto");
  const actor = personas.find((p) => p.role === role)?.name ?? role;
  const components: PrototypeComponentRow[] = analysis.components.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    sectionTitles: c.sectionTitles,
    matchedCapabilityId: c.matchedCapabilityId,
    matchedCapabilityName: c.matchedCapabilityName,
    matchedSolutionId: c.matchedSolutionId,
    matchedSolutionName: c.matchedSolutionName,
    matchScore: c.matchScore,
    verdict: c.verdict,
    reason: c.reason,
  }));
  // The product this prototype is filed against: the one it should fold into or extend, else the one that ran its example.
  const comparedSolutionId = analysis.targetSolutionId ?? analysis.comparison?.solutionId ?? components.find((c) => c.matchedSolutionId)?.matchedSolutionId ?? null;
  const compared = comparedSolutionId ? getSolution(comparedSolutionId) : undefined;
  const [row] = await db
    .insert(registeredPrototypesTable)
    .values({
      id,
      name: intake.name.trim(),
      platformKind: intake.platformKind,
      platformName: intake.platformName.trim(),
      link: intake.link?.trim() || null,
      users: intake.users.trim(),
      ownerName: intake.ownerName?.trim() ?? "",
      ownerTeam: intake.ownerTeam?.trim() ?? "",
      description: intake.description.trim(),
      dataInvolved: intake.dataInvolved ?? [],
      riskTier: intake.riskTier ?? "low",
      noRestrictedData: intake.noRestrictedData ?? false,
      examples: intake.examples.map((e, i) => ({ id: `ex${i + 1}`, input: e.input, output: e.output, sampleInputId: e.sampleInputId ?? null })),
      components,
      businessProblemIds: compared?.businessProblemIds ?? [],
      recommendedPath: analysis.recommendedPath,
      recommendation: analysis.recommendation,
      comparedSolutionId,
      reuseEventId,
      createdByRole: role,
      createdBy: actor,
      exampleCount: intake.examples.length,
    })
    .returning();
  rows = [row!, ...rows];
  publish();
  return row!;
}

async function setRemoved(id: string, removedAt: Date | null): Promise<RegisteredPrototypeRow | null> {
  const [row] = await db.update(registeredPrototypesTable).set({ removedAt }).where(eq(registeredPrototypesTable.id, id)).returning();
  if (!row) return null;
  rows = rows.map((r) => (r.id === id ? row : r));
  publish();
  return row;
}

export const removePrototype = (id: string) => setRemoved(id, new Date());
export const restorePrototype = (id: string) => setRemoved(id, null);

export async function clearPrototypes(): Promise<void> {
  await db.delete(registeredPrototypesTable);
  rows = [];
  publish();
}

/** Registered prototypes with at least one component that duplicates a certified product's capability. */
export function duplicatesCertified(row: RegisteredPrototypeRow): boolean {
  return row.components.some((c) => c.verdict === "duplicates" && c.matchedSolutionId && getSolution(c.matchedSolutionId)?.status === "certified");
}
