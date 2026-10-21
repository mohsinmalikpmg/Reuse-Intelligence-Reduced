import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, runsTable, evaluationsTable, testSessionsTable, searchEventsTable } from "@workspace/db";
import type { RunRow, EvaluationRow, TestSessionRow } from "@workspace/db";
import type { Evaluation, EvaluationSummary, Run, RunOutput, RunStats, StepTrace } from "@workspace/api-zod";
import { newId } from "./ids";

export function hashInput(text: string): string {
  return createHash("sha1").update(text.trim()).digest("hex").slice(0, 16);
}

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    caseId: row.caseId,
    solutionId: row.solutionId,
    version: row.version as Run["version"],
    versionLabel: row.versionLabel,
    sampleInputId: row.sampleInputId,
    inputText: row.inputText,
    inputHash: row.inputHash,
    enabledCapabilityIds: row.enabledCapabilityIds,
    configValues: row.configValues,
    output: row.output as RunOutput,
    trace: row.trace as StepTrace[],
    stats: row.stats as RunStats,
    durationMs: row.durationMs,
    errors: row.errors,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toEvaluation(row: EvaluationRow): Evaluation {
  return {
    id: row.id,
    caseId: row.caseId,
    sessionId: row.sessionId,
    sampleInputId: row.sampleInputId,
    inputHash: row.inputHash,
    runAId: row.runAId,
    runBId: row.runBId,
    choice: row.choice as Evaluation["choice"],
    reason: row.reason,
    rating: row.rating,
    evaluator: row.evaluator,
    role: row.role as Evaluation["role"],
    blind: row.blind,
    demo: row.demo,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertRun(run: Omit<Run, "id" | "createdAt">): Promise<Run> {
  const [row] = await db
    .insert(runsTable)
    .values({ id: newId("run"), ...run })
    .returning();
  return toRun(row!);
}

export async function getRun(id: string): Promise<Run | null> {
  const [row] = await db.select().from(runsTable).where(eq(runsTable.id, id));
  return row ? toRun(row) : null;
}

export async function listRunsForCase(caseId: string): Promise<Run[]> {
  const rows = await db.select().from(runsTable).where(eq(runsTable.caseId, caseId)).orderBy(desc(runsTable.createdAt));
  return rows.map(toRun);
}

export async function listRunsForSolution(solutionId: string): Promise<Run[]> {
  const rows = await db.select().from(runsTable).where(eq(runsTable.solutionId, solutionId)).orderBy(desc(runsTable.createdAt));
  return rows.map(toRun);
}

export async function countRunsSince(solutionId: string, since: Date): Promise<number> {
  const rows = await db.select({ id: runsTable.id }).from(runsTable).where(and(eq(runsTable.solutionId, solutionId), gte(runsTable.createdAt, since)));
  return rows.length;
}

export async function listAllRuns(): Promise<Run[]> {
  const rows = await db.select().from(runsTable).orderBy(desc(runsTable.createdAt));
  return rows.map(toRun);
}

// ---------- Evaluations ----------

export async function insertEvaluation(e: Omit<Evaluation, "id" | "createdAt">): Promise<Evaluation> {
  const [row] = await db
    .insert(evaluationsTable)
    .values({ id: newId("eval"), ...e })
    .returning();
  return toEvaluation(row!);
}

export async function listEvaluations(caseId: string): Promise<Evaluation[]> {
  const rows = await db.select().from(evaluationsTable).where(eq(evaluationsTable.caseId, caseId)).orderBy(desc(evaluationsTable.createdAt));
  return rows.map(toEvaluation);
}

export async function listAllEvaluations(): Promise<Evaluation[]> {
  const rows = await db.select().from(evaluationsTable).orderBy(desc(evaluationsTable.createdAt));
  return rows.map(toEvaluation);
}

export async function listEvaluationsForCases(caseIds: string[]): Promise<Evaluation[]> {
  if (caseIds.length === 0) return [];
  const rows = await db.select().from(evaluationsTable).where(inArray(evaluationsTable.caseId, caseIds));
  return rows.map(toEvaluation);
}

/** Only ever computed from stored votes. */
export function summarizeEvaluations(items: Evaluation[]): EvaluationSummary {
  const rated = items.filter((e) => e.rating !== null);
  return {
    tests: items.length,
    aPreferred: items.filter((e) => e.choice === "A").length,
    bPreferred: items.filter((e) => e.choice === "B").length,
    neither: items.filter((e) => e.choice === "neither").length,
    averageRating: rated.length ? Math.round((rated.reduce((s, e) => s + (e.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
    distinctInputs: new Set(items.map((e) => e.inputHash)).size,
    blindVotes: items.filter((e) => e.blind).length,
    demoVotes: items.filter((e) => e.demo).length,
  };
}

// ---------- Blind test sessions ----------

export interface SessionPair {
  sampleInputId: string;
  runAId: string;
  runBId: string;
  /** Which version is shown on the left */
  left: "A" | "B";
}

export function encodePairs(pairs: SessionPair[]): string[] {
  return pairs.map((p) => [p.sampleInputId, p.runAId, p.runBId, p.left].join(":"));
}

export function decodePairs(row: TestSessionRow): SessionPair[] {
  return row.pairs.map((s) => {
    const [sampleInputId, runAId, runBId, left] = s.split(":");
    return { sampleInputId: sampleInputId!, runAId: runAId!, runBId: runBId!, left: left === "B" ? "B" : "A" };
  });
}

export async function insertTestSession(input: { caseId: string; createdBy: string; title: string; pairs: SessionPair[] }): Promise<TestSessionRow> {
  const [row] = await db
    .insert(testSessionsTable)
    .values({ id: newId("session"), caseId: input.caseId, createdBy: input.createdBy, title: input.title, pairs: encodePairs(input.pairs) })
    .returning();
  return row!;
}

export async function getTestSessionRow(id: string): Promise<TestSessionRow | null> {
  const [row] = await db.select().from(testSessionsTable).where(eq(testSessionsTable.id, id));
  return row ?? null;
}

export async function listTestSessionRows(caseId: string): Promise<TestSessionRow[]> {
  return db.select().from(testSessionsTable).where(eq(testSessionsTable.caseId, caseId)).orderBy(desc(testSessionsTable.createdAt));
}

// ---------- Search events ----------

export async function recordSearch(query: string, resultCount: number, source: string): Promise<void> {
  await db.insert(searchEventsTable).values({ id: newId("search"), query, resultCount, source });
}

export async function countSearches(): Promise<number> {
  const rows = await db.select({ id: searchEventsTable.id }).from(searchEventsTable);
  return rows.length;
}

export async function clearWorkbench(): Promise<void> {
  await db.delete(evaluationsTable);
  await db.delete(testSessionsTable);
  await db.delete(runsTable);
  await db.delete(searchEventsTable);
}
