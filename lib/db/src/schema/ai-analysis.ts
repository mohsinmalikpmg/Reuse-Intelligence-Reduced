import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const aiAnalysisRecordsTable = pgTable("ai_analysis_records", {
  id: text("id").primaryKey(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("ai_analysis_lookup").on(table.purpose, table.inputFingerprint, table.createdAt)]);
