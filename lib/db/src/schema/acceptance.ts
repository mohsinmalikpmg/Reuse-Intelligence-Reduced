import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { briefsTable } from "./briefs";

/** Immutable evidence snapshots, never executable uploaded artifacts. */
export const acceptanceRunsTable = pgTable("acceptance_runs", {
  id: text("id").primaryKey(),
  briefId: text("brief_id").notNull().references(() => briefsTable.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
