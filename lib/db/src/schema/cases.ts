import { pgTable, text, boolean, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type CaseRequirementRow = { id: string; text: string; createdAt: string };
export type CapabilityRequestRow = { id: string; need: string; missing: string; afterStepId: string | null; reuseEventId: string | null; createdAt: string };

export const casesTable = pgTable("cases", {
  id: text("id").primaryKey(),
  briefId: text("brief_id"),
  title: text("title").notNull(),
  businessProblemId: text("business_problem_id").notNull(),
  baseSolutionId: text("base_solution_id").notNull(),
  candidateSolutionIds: text("candidate_solution_ids").array().notNull(),
  status: text("status").notNull().default("draft"),
  moduleStates: jsonb("module_states").$type<Record<string, boolean>>().notNull(),
  configValues: jsonb("config_values").$type<Record<string, string>>().notNull(),
  experimentId: text("experiment_id"),
  pilotPercent: integer("pilot_percent").notNull().default(10),
  createdByRole: text("created_by_role").notNull().default("seeker"),
  saved: boolean("saved").notNull().default(false),
  requirements: jsonb("requirements").$type<CaseRequirementRow[]>().notNull().default([]),
  capabilityRequests: jsonb("capability_requests").$type<CapabilityRequestRow[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({ createdAt: true, updatedAt: true });
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type CaseRow = typeof casesTable.$inferSelect;
