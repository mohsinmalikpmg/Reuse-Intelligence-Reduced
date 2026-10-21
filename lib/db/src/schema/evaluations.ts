import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/** A recorded human preference between two real outputs. */
export const evaluationsTable = pgTable("evaluations", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  sessionId: text("session_id"),
  sampleInputId: text("sample_input_id"),
  inputHash: text("input_hash").notNull(),
  runAId: text("run_a_id").notNull(),
  runBId: text("run_b_id").notNull(),
  /** Fingerprints of the two runs at vote time, so summaries can be stratified by configuration */
  fingerprintA: text("fingerprint_a").notNull().default(""),
  fingerprintB: text("fingerprint_b").notNull().default(""),
  choice: text("choice").notNull(), // "A" | "B" | "neither"
  reason: text("reason"),
  rating: integer("rating"),
  evaluator: text("evaluator").notNull(),
  role: text("role").notNull(),
  blind: boolean("blind").notNull().default(false),
  demo: boolean("demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type EvaluationRow = typeof evaluationsTable.$inferSelect;

/** A blind test session: colleagues compare outputs without knowing which version produced them. */
export const testSessionsTable = pgTable("test_sessions", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  createdBy: text("created_by").notNull(),
  title: text("title").notNull(),
  /** Per input: which side shows B, decided once so the mapping is stable */
  pairs: text("pairs").array().notNull(), // entries "sampleInputId:runAId:runBId:left" where left = "A"|"B"
  closed: boolean("closed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type TestSessionRow = typeof testSessionsTable.$inferSelect;

export const searchEventsTable = pgTable("search_events", {
  id: text("id").primaryKey(),
  query: text("query").notNull(),
  resultCount: integer("result_count").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SearchEventRow = typeof searchEventsTable.$inferSelect;
