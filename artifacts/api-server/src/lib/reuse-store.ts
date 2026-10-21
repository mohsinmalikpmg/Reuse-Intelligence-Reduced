import { desc, eq } from "drizzle-orm";
import { db, reuseEventsTable } from "@workspace/db";
import type { ReuseEventRow } from "@workspace/db";
import type { ReuseEvent } from "@workspace/api-zod";
import { newId } from "./ids";

export function toReuseEvent(row: ReuseEventRow): ReuseEvent {
  return {
    id: row.id,
    trigger: row.trigger as ReuseEvent["trigger"],
    need: row.need,
    baseSolutionId: row.baseSolutionId,
    caseId: row.caseId,
    briefId: row.briefId,
    bestScore: row.bestScore,
    bestTitle: row.bestTitle,
    bestSolutionId: row.bestSolutionId,
    bestCapabilityId: row.bestCapabilityId,
    pathRecommended: row.pathRecommended as ReuseEvent["pathRecommended"],
    pathTaken: row.pathTaken as ReuseEvent["pathTaken"],
    actor: row.actor,
    demo: row.demo,
    createdAt: row.createdAt.toISOString(),
  };
}

export type NewReuseEvent = Omit<ReuseEvent, "id" | "createdAt"> & { id?: string; createdAt?: Date };

export async function insertReuseEvent(e: NewReuseEvent): Promise<ReuseEvent> {
  const [row] = await db
    .insert(reuseEventsTable)
    .values({ ...e, id: e.id ?? newId("reuse"), createdAt: e.createdAt ?? new Date() })
    .returning();
  return toReuseEvent(row!);
}

export async function listReuseEvents(): Promise<ReuseEvent[]> {
  const rows = await db.select().from(reuseEventsTable).orderBy(desc(reuseEventsTable.createdAt));
  return rows.map(toReuseEvent);
}

export async function getReuseEvent(id: string): Promise<ReuseEvent | null> {
  const [row] = await db.select().from(reuseEventsTable).where(eq(reuseEventsTable.id, id));
  return row ? toReuseEvent(row) : null;
}

export async function setReusePathTaken(id: string, pathTaken: ReuseEvent["pathTaken"]): Promise<ReuseEvent | null> {
  const [row] = await db.update(reuseEventsTable).set({ pathTaken }).where(eq(reuseEventsTable.id, id)).returning();
  return row ? toReuseEvent(row) : null;
}

export async function clearReuseEvents(): Promise<void> {
  await db.delete(reuseEventsTable);
}
