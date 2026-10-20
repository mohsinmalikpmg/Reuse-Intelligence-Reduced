import { pgTable, text, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const experimentsTable = pgTable("experiments", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  baselineName: text("baseline_name").notNull(),
  challengerName: text("challenger_name").notNull(),
  seed: integer("seed").notNull(),
  cohort: jsonb("cohort").$type<unknown[]>().notNull(),
  metrics: jsonb("metrics").$type<unknown[]>().notNull(),
  segments: jsonb("segments").$type<unknown[]>().notNull(),
  risks: text("risks").array().notNull(),
  confidence: real("confidence").notNull(),
  recommendation: text("recommendation").notNull(),
  narrative: text("narrative").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExperimentSchema = createInsertSchema(experimentsTable).omit({ createdAt: true });
export type InsertExperiment = z.infer<typeof insertExperimentSchema>;
export type ExperimentRow = typeof experimentsTable.$inferSelect;
