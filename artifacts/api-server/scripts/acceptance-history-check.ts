/**
 * Database regression for the deletion/recreation used by demo reset.
 * Uses a random test brief in a rolled-back transaction; never resets user data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, briefsTable, acceptanceRunsTable } from "@workspace/db";

const rollback = new Error("rollback test fixtures");
try {
  await db.transaction(async tx => {
    const id = `acceptance-history-check-${randomUUID()}`;
    const brief = { id, rawText: "Test maintenance notes", fields: {}, source: "fallback", valueStatement: "", confirmed: true };
    await tx.insert(briefsTable).values(brief);
    await tx.insert(acceptanceRunsTable).values({
      id: randomUUID(), briefId: id, snapshot: { inputText: "Test-only supplied input" },
    });
    assert.equal((await tx.select().from(acceptanceRunsTable).where(eq(acceptanceRunsTable.briefId, id))).length, 1);
    // resetDemo -> clearAll deletes briefs, then recreates the seeded ID.
    await tx.delete(briefsTable).where(eq(briefsTable.id, id));
    assert.equal((await tx.select().from(acceptanceRunsTable).where(eq(acceptanceRunsTable.briefId, id))).length, 0, "Brief deletion must remove its evidence");
    await tx.insert(briefsTable).values(brief);
    assert.equal((await tx.select().from(acceptanceRunsTable).where(eq(acceptanceRunsTable.briefId, id))).length, 0, "Recreated brief must have empty history");
    await assert.rejects(() => tx.transaction(async savepoint => {
      await savepoint.insert(acceptanceRunsTable).values({ id: randomUUID(), briefId: `${id}-missing`, snapshot: {} });
    }), /foreign key|violates|Failed query/i);
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await pool.end();
}
process.stdout.write("Acceptance history checks passed: deletion clears evidence, recreated brief IDs have no old input, orphan insertion rejected; all test data rolled back.\n");
