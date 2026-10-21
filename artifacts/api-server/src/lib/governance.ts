/**
 * Governance overlay: persisted successor versions, capability membership changes with provenance, dispositions and
 * preferred-product marks, merged onto every solution read. The static catalog stays the source of truth for
 * everything else. The overlay is small, so it is held in memory and reloaded after every write; the catalog's
 * resolver hook applies it synchronously wherever a solution is read.
 */
import { eq } from "drizzle-orm";
import { db, solutionVersionsTable, dispositionsTable } from "@workspace/db";
import type { SolutionVersionRow, DispositionRow, FoldedCapabilityRow } from "@workspace/db";
import type { Case, Disposition, DispositionKind, Solution, SolutionVersion } from "@workspace/api-zod";
import { catalogSolutions, getSolution, setSolutionResolver } from "../data/catalog";
import { newId } from "./ids";

type Overlay = { versions: SolutionVersionRow[]; dispositions: DispositionRow[] };
let overlay: Overlay = { versions: [], dispositions: [] };

export async function loadGovernance(): Promise<void> {
  const [versions, dispositions] = await Promise.all([db.select().from(solutionVersionsTable), db.select().from(dispositionsTable)]);
  overlay = {
    versions: versions.sort((a, b) => compareVersions(a.version, b.version)),
    dispositions,
  };
  setSolutionResolver(resolve);
}

export async function clearGovernance(): Promise<void> {
  await db.delete(dispositionsTable);
  await db.delete(solutionVersionsTable);
  await loadGovernance();
}

// ---------- Versions ----------

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function toSolutionVersion(row: SolutionVersionRow): SolutionVersion {
  return {
    version: row.version,
    releasedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    summary: row.summary,
    state: row.state as SolutionVersion["state"],
    caseId: row.caseId,
    foldedCapabilities: row.foldedCapabilities,
    changedSettings: row.changedSettings,
  };
}

/** The successor version recorded for an experiment, in any state. */
export function versionForCase(caseId: string): SolutionVersionRow | undefined {
  return overlay.versions.find((v) => v.caseId === caseId && v.state !== "withdrawn");
}

/** Label for the experiment status once published: "Work Order Triage v3.3". */
export function foldedIntoFor(caseId: string): string | null {
  const v = overlay.versions.find((row) => row.caseId === caseId && row.state === "current");
  if (!v) return null;
  const name = catalogSolutions.find((s) => s.id === v.solutionId)?.name ?? v.solutionId;
  return `${name} v${v.version}`;
}

// ---------- Dispositions ----------

const KIND_VERB: Record<DispositionKind, string> = {
  retain: "Retained",
  fold_into: "Folding into",
  configure: "Configure on",
  rebuild: "Rebuild on",
  retire: "Retirement",
};

export function dispositionLabel(row: Pick<DispositionRow, "kind" | "state" | "reason" | "migrationNote" | "preferred" | "targetSolutionId" | "targetVersion">): string {
  const kind = row.kind as DispositionKind;
  const confirmed = row.state === "confirmed";
  const target = row.targetSolutionId ? catalogSolutions.find((s) => s.id === row.targetSolutionId)?.name ?? row.targetSolutionId : null;
  const targetText = target ? ` ${target}${row.targetVersion ? ` v${row.targetVersion}` : ""}` : "";
  if (kind === "retain") {
    if (row.preferred) return confirmed ? "Preferred for this problem" : "Proposed as preferred";
    return `${confirmed ? "Retained" : "Proposed: retained"}${row.reason ? ` — ${row.reason}` : ""}`;
  }
  if (kind === "retire") {
    // Never "retired": a product stays scheduled for retirement until a migration note says its users have moved.
    if (!confirmed) return "Proposed: retire after migration";
    return row.migrationNote ? "Retirement scheduled · migration recorded" : "Retirement scheduled";
  }
  const verb = KIND_VERB[kind];
  return confirmed ? `${verb}${targetText}` : `Proposed: ${verb.toLowerCase()}${targetText}`;
}

export function toDisposition(row: DispositionRow): Disposition {
  return {
    id: row.id,
    caseId: row.caseId,
    solutionId: row.solutionId,
    kind: row.kind as DispositionKind,
    state: row.state as Disposition["state"],
    targetSolutionId: row.targetSolutionId,
    targetSolutionName: row.targetSolutionId ? catalogSolutions.find((s) => s.id === row.targetSolutionId)?.name ?? null : null,
    targetVersion: row.targetVersion,
    reason: row.reason,
    migrationNote: row.migrationNote,
    preferred: row.preferred,
    label: dispositionLabel(row),
  };
}

export function dispositionsForCase(caseId: string): Disposition[] {
  return overlay.dispositions.filter((d) => d.caseId === caseId).map(toDisposition);
}

/** The disposition shown on a product: a confirmed one wins over a proposal; the latest proposal otherwise. */
function dispositionForSolution(solutionId: string): Disposition | null {
  const rows = overlay.dispositions.filter((d) => d.solutionId === solutionId);
  if (rows.length === 0) return null;
  const confirmed = rows.filter((d) => d.state === "confirmed").sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const pick = confirmed[0] ?? rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]!;
  return toDisposition(pick);
}

/** Products a confirmed disposition moves aside (anything but retain) rank below the preferred product. */
export function rankBucket(s: Solution): number {
  const d = s.disposition;
  if (!d || d.state !== "confirmed") return 1;
  if (d.kind === "retain") return d.preferred ? 0 : 1;
  return 2;
}

// ---------- Resolver ----------

function resolve(base: Solution, asOf?: string): Solution {
  const rows = overlay.versions.filter((v) => v.solutionId === base.id && v.state !== "withdrawn" && (asOf === undefined || (v.state === "current" && compareVersions(v.version, asOf) <= 0)));
  if (rows.length === 0 && asOf !== undefined) return { ...base, disposition: dispositionForSolution(base.id) };
  const published = rows.filter((v) => v.state === "current");
  const capabilityIds = [...base.capabilityIds];
  for (const v of published) for (const cap of v.foldedCapabilities) if (!capabilityIds.includes(cap.capabilityId)) capabilityIds.push(cap.capabilityId);
  const latest = published[published.length - 1];
  const extra = [...rows].reverse().map(toSolutionVersion);
  return {
    ...base,
    capabilityIds,
    currentVersion: latest ? latest.version : base.currentVersion,
    versions: [...extra, ...base.versions],
    disposition: dispositionForSolution(base.id),
  };
}

// ---------- Writes ----------

export type FoldedCapabilityInput = FoldedCapabilityRow;

/** Owner approval: record a draft successor version on the parent product for this experiment (idempotent per case). */
export async function ensureDraftVersion(c: Case, input: { summary: string; folded: FoldedCapabilityInput[]; changedSettings: string[]; createdBy: string }): Promise<SolutionVersionRow> {
  const existing = versionForCase(c.id);
  if (existing) {
    if (existing.state === "draft") {
      const [row] = await db.update(solutionVersionsTable).set({ summary: input.summary, foldedCapabilities: input.folded, changedSettings: input.changedSettings }).where(eq(solutionVersionsTable.id, existing.id)).returning();
      await loadGovernance();
      return row!;
    }
    return existing;
  }
  const parent = getSolution(c.baseSolutionId);
  if (!parent) throw new Error(`Unknown solution ${c.baseSolutionId}`);
  // Next number after the highest version on the product, including other drafts, so two approvals never collide.
  const taken = [parent.currentVersion, ...overlay.versions.filter((v) => v.solutionId === parent.id && v.state !== "withdrawn").map((v) => v.version)];
  const top = taken.sort(compareVersions)[taken.length - 1]!;
  const [row] = await db
    .insert(solutionVersionsTable)
    .values({ id: newId("ver"), solutionId: parent.id, caseId: c.id, version: bump(top), state: "draft", summary: input.summary, foldedCapabilities: input.folded, changedSettings: input.changedSettings, createdBy: input.createdBy })
    .returning();
  await loadGovernance();
  return row!;
}

function bump(v: string): string {
  const [major, minor] = v.split(".");
  const n = Number(minor ?? "0");
  return `${major ?? "1"}.${Number.isNaN(n) ? 1 : n + 1}`;
}

export async function setVersionState(caseId: string, state: "draft" | "current" | "withdrawn", publishedBy?: string): Promise<void> {
  const row = overlay.versions.find((v) => v.caseId === caseId && v.state !== "withdrawn");
  if (!row) return;
  await db
    .update(solutionVersionsTable)
    .set(state === "current" ? { state, publishedAt: new Date(), publishedBy: publishedBy ?? null } : { state, publishedAt: null, publishedBy: null })
    .where(eq(solutionVersionsTable.id, row.id));
  await loadGovernance();
}

export type DispositionChoice = { solutionId: string; kind: DispositionKind; reason?: string | null; preferred?: boolean; targetSolutionId?: string | null; targetVersion?: string | null };

/** Create or update proposed dispositions for a case. Confirmed rows are left alone. */
export async function upsertDispositions(caseId: string, choices: DispositionChoice[]): Promise<void> {
  for (const choice of choices) {
    const existing = overlay.dispositions.find((d) => d.caseId === caseId && d.solutionId === choice.solutionId);
    if (existing?.state === "confirmed") continue;
    const values = {
      kind: choice.kind,
      reason: choice.reason?.trim() || null,
      preferred: choice.preferred ?? existing?.preferred ?? false,
      targetSolutionId: choice.kind === "retain" || choice.kind === "retire" ? null : (choice.targetSolutionId ?? existing?.targetSolutionId ?? null),
      targetVersion: choice.kind === "retain" || choice.kind === "retire" ? null : (choice.targetVersion ?? existing?.targetVersion ?? null),
    };
    if (existing) await db.update(dispositionsTable).set(values).where(eq(dispositionsTable.id, existing.id));
    else await db.insert(dispositionsTable).values({ id: newId("disp"), caseId, solutionId: choice.solutionId, state: "proposed", migrationNote: null, ...values });
  }
  await loadGovernance();
}

/** Only rows that do not exist yet are written: IT's earlier choices survive the owner's approval. */
export async function seedDispositions(caseId: string, choices: DispositionChoice[]): Promise<void> {
  const missing = choices.filter((c) => !overlay.dispositions.some((d) => d.caseId === caseId && d.solutionId === c.solutionId));
  if (missing.length) await upsertDispositions(caseId, missing);
}

export async function setDispositionsState(caseId: string, state: "proposed" | "confirmed", targetVersion?: string): Promise<void> {
  const patch = targetVersion ? { state, targetVersion } : { state };
  await db.update(dispositionsTable).set(patch).where(eq(dispositionsTable.caseId, caseId));
  // Only dispositions pointing at a product carry the version; retain/retire never do.
  if (targetVersion) {
    for (const d of overlay.dispositions.filter((x) => x.caseId === caseId && (x.kind === "retain" || x.kind === "retire"))) {
      await db.update(dispositionsTable).set({ targetVersion: null }).where(eq(dispositionsTable.id, d.id));
    }
  }
  await loadGovernance();
}

export class GovernanceError extends Error {}

/** True while the case's dispositions are confirmed (IT approved the direction and has not withdrawn it). */
export function consolidationLocked(caseId: string): boolean {
  return overlay.dispositions.some((d) => d.caseId === caseId && d.state === "confirmed") || overlay.versions.some((v) => v.caseId === caseId && v.state === "current");
}

export async function recordMigrationNote(caseId: string, solutionId: string, note: string): Promise<void> {
  const row = overlay.dispositions.find((d) => d.caseId === caseId && d.solutionId === solutionId);
  if (!row) throw new GovernanceError("No disposition is recorded for that product under this case.");
  if (row.kind !== "retire") throw new GovernanceError("A migration note applies only to a product scheduled for retirement.");
  if (row.state !== "confirmed") throw new GovernanceError("Confirm the consolidation direction before recording a migration.");
  await db.update(dispositionsTable).set({ migrationNote: note.trim() }).where(eq(dispositionsTable.id, row.id));
  await loadGovernance();
}

export async function removeCaseGovernance(caseId: string): Promise<void> {
  await db.delete(dispositionsTable).where(eq(dispositionsTable.caseId, caseId));
  await db.delete(solutionVersionsTable).where(eq(solutionVersionsTable.caseId, caseId));
  await loadGovernance();
}
