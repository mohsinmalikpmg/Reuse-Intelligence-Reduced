import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const decisionsTable = pgTable("decisions", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  role: text("role").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDecisionSchema = createInsertSchema(decisionsTable).omit({ createdAt: true });
export type InsertDecision = z.infer<typeof insertDecisionSchema>;
export type DecisionRow = typeof decisionsTable.$inferSelect;
