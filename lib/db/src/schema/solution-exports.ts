import { pgTable, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const solutionExportsTable = pgTable("solution_exports", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  solutionId: text("solution_id").notNull(),
  title: text("title").notNull(),
  sourceVersion: text("source_version").notNull(),
  fingerprint: text("fingerprint").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  status: text("status").notNull().default("building"),
  sha256: text("sha256"),
  objectPath: text("object_path"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  checks: jsonb("checks").notNull().default([]),
  gaps: jsonb("gaps").notNull().default([]),
  error: text("error").notNull().default(""),
  workspaceUrl: text("workspace_url").notNull().default(""),
  publishedUrl: text("published_url").notNull().default(""),
  linkRevision: integer("link_revision").notNull().default(0),
});
