import { pgTable, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const briefsTable = pgTable("briefs", {
  id: text("id").primaryKey(),
  rawText: text("raw_text").notNull(),
  fields: jsonb("fields").$type<unknown>().notNull(),
  clarifyingQuestion: text("clarifying_question"),
  clarification: text("clarification"),
  source: text("source").notNull(),
  valueStatement: text("value_statement").notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBriefSchema = createInsertSchema(briefsTable).omit({ createdAt: true });
export type InsertBrief = z.infer<typeof insertBriefSchema>;
export type BriefRow = typeof briefsTable.$inferSelect;
