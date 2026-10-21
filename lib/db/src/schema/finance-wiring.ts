import { pgTable, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Identity is the authenticated user, never the selected Workbench persona.
export const financeWiringStatesTable = pgTable("finance_wiring_states", {
  userId: text("user_id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  activeVersionId: text("active_version_id"),
});

// Snapshots are insert-only. Restoring only changes the owning state pointer.
export const financeWiringVersionsTable = pgTable("finance_wiring_versions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => financeWiringStatesTable.userId, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  config: jsonb("config").notNull(),
  fingerprint: text("fingerprint").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("finance_wiring_versions_owner_number").on(table.userId, table.number)]);

export const insertFinanceWiringStateSchema = createInsertSchema(financeWiringStatesTable);
export const insertFinanceWiringVersionSchema = createInsertSchema(financeWiringVersionsTable).omit({ createdAt: true });
export type FinanceWiringStateRow = typeof financeWiringStatesTable.$inferSelect;
export type FinanceWiringVersionRow = typeof financeWiringVersionsTable.$inferSelect;
export type InsertFinanceWiringState = typeof financeWiringStatesTable.$inferInsert;
export type InsertFinanceWiringVersion = typeof financeWiringVersionsTable.$inferInsert;
