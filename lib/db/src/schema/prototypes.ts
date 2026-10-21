import { pgTable, text, boolean, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/** A worked example the builder pasted: the problem instance fed to the prototype and the output it produced. Claims, never evidence. */
export type PrototypeExampleRow = { id: string; input: string; output: string; sampleInputId: string | null };

/** A confirmed component of the prototype, with the library capability it was matched to (if any) and the verdict recorded at registration. */
export type PrototypeComponentRow = {
  id: string;
  name: string;
  description: string;
  sectionTitles: string[];
  matchedCapabilityId: string | null;
  matchedCapabilityName: string | null;
  matchedSolutionId: string | null;
  matchedSolutionName: string | null;
  matchScore: number | null;
  verdict: "duplicates" | "extends" | "new";
  reason: string;
};

/**
 * One row per prototype someone brought into the library. Registered prototypes are catalogue entries of
 * kind "prototype" with execution "preview": FUSEBOX never runs them, so nothing here is evidence.
 */
export const registeredPrototypesTable = pgTable("registered_prototypes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  platformKind: text("platform_kind").notNull(),
  platformName: text("platform_name").notNull(),
  link: text("link"),
  users: text("users").notNull(),
  ownerName: text("owner_name").notNull().default(""),
  ownerTeam: text("owner_team").notNull().default(""),
  description: text("description").notNull(),
  dataInvolved: text("data_involved").array().notNull().default([]),
  riskTier: text("risk_tier").notNull().default("low"),
  noRestrictedData: boolean("no_restricted_data").notNull().default(false),
  examples: jsonb("examples").$type<PrototypeExampleRow[]>().notNull().default([]),
  components: jsonb("components").$type<PrototypeComponentRow[]>().notNull().default([]),
  businessProblemIds: text("business_problem_ids").array().notNull().default([]),
  recommendedPath: text("recommended_path").notNull(),
  recommendation: text("recommendation").notNull(),
  comparedSolutionId: text("compared_solution_id"),
  reuseEventId: text("reuse_event_id"),
  createdByRole: text("created_by_role").notNull().default("seeker"),
  createdBy: text("created_by").notNull().default(""),
  exampleCount: integer("example_count").notNull().default(0),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type RegisteredPrototypeRow = typeof registeredPrototypesTable.$inferSelect;
