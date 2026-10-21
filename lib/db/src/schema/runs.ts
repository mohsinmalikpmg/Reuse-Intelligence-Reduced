import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/** One execution of a workflow version against one input. Output and trace are the real produced objects. */
export const runsTable = pgTable("runs", {
  id: text("id").primaryKey(),
  caseId: text("case_id"),
  solutionId: text("solution_id").notNull(),
  version: text("version").notNull(), // "A" | "B"
  versionLabel: text("version_label").notNull(),
  sampleInputId: text("sample_input_id"),
  inputText: text("input_text").notNull(),
  inputHash: text("input_hash").notNull(),
  enabledCapabilityIds: text("enabled_capability_ids").array().notNull(),
  configValues: jsonb("config_values").$type<Record<string, string>>().notNull(),
  output: jsonb("output").$type<unknown>().notNull(),
  trace: jsonb("trace").$type<unknown>().notNull(),
  stats: jsonb("stats").$type<unknown>().notNull(),
  durationMs: integer("duration_ms").notNull(),
  errors: text("errors").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type RunRow = typeof runsTable.$inferSelect;
