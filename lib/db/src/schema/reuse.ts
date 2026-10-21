import { pgTable, text, boolean, real, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per reuse check: where it was triggered, what was needed, what the scorer recommended and what
 * the user did about it. Raw material for "reuse before build" metrics. Demo rows are labelled.
 */
export const reuseEventsTable = pgTable("reuse_events", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(),
  need: text("need").notNull(),
  baseSolutionId: text("base_solution_id"),
  caseId: text("case_id"),
  briefId: text("brief_id"),
  bestScore: real("best_score"),
  bestTitle: text("best_title"),
  bestSolutionId: text("best_solution_id"),
  bestCapabilityId: text("best_capability_id"),
  pathRecommended: text("path_recommended").notNull(),
  pathTaken: text("path_taken"),
  actor: text("actor").notNull(),
  demo: boolean("demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ReuseEventRow = typeof reuseEventsTable.$inferSelect;
