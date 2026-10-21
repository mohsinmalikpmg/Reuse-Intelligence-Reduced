import { pgTable, text, boolean, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Governance overlay over the static catalog. The catalog stays the source of truth for everything else; these
 * tables only add successor versions, capability membership changes with provenance, and product dispositions.
 */

export type FoldedCapabilityRow = {
  capabilityId: string;
  name: string;
  sourceSolutionId: string;
  sourceSolutionName: string;
  /** Who ran the experiment the capability came from */
  experimentOwner: string;
  tests: number;
  preferredPercent: number | null;
  provenance: string;
};

export const solutionVersionsTable = pgTable("solution_versions", {
  id: text("id").primaryKey(),
  solutionId: text("solution_id").notNull(),
  caseId: text("case_id").notNull(),
  version: text("version").notNull(),
  /** draft = owner approved, awaiting IT; current = published governed version; withdrawn = owner rejected after approval */
  state: text("state").notNull().default("draft"),
  summary: text("summary").notNull(),
  foldedCapabilities: jsonb("folded_capabilities").$type<FoldedCapabilityRow[]>().notNull().default([]),
  changedSettings: jsonb("changed_settings").$type<string[]>().notNull().default([]),
  /** The approved production configuration: optional-module states and configurable values of the experiment's Version B */
  moduleStates: jsonb("module_states").$type<Record<string, boolean>>().notNull().default({}),
  configValues: jsonb("config_values").$type<Record<string, string>>().notNull().default({}),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: text("published_by"),
});

export const dispositionsTable = pgTable(
  "dispositions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    solutionId: text("solution_id").notNull(),
    /** retain | fold_into | configure | rebuild | retire */
    kind: text("kind").notNull(),
    /** proposed until IT confirms the consolidation direction */
    state: text("state").notNull().default("proposed"),
    targetSolutionId: text("target_solution_id"),
    targetVersion: text("target_version"),
    reason: text("reason"),
    migrationNote: text("migration_note"),
    preferred: boolean("preferred").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("dispositions_case_solution_idx").on(t.caseId, t.solutionId)],
);

export const insertSolutionVersionSchema = createInsertSchema(solutionVersionsTable).omit({ createdAt: true });
export type InsertSolutionVersion = z.infer<typeof insertSolutionVersionSchema>;
export type SolutionVersionRow = typeof solutionVersionsTable.$inferSelect;
export const insertDispositionSchema = createInsertSchema(dispositionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertDisposition = z.infer<typeof insertDispositionSchema>;
export type DispositionRow = typeof dispositionsTable.$inferSelect;
