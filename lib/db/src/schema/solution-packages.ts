import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const solutionPackagesTable = pgTable("solution_packages", {
  id: text("id").primaryKey(),
  solutionId: text("solution_id").notNull(),
  solutionName: text("solution_name").notNull(),
  version: text("version").notNull(),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("awaiting_upload"),
  sha256: text("sha256"),
  stagingPath: text("staging_path").notNull(),
  objectPath: text("object_path"),
  createdBy: text("created_by").notNull(),
  claims: jsonb("claims").$type<string[]>().notNull().default([]),
  files: jsonb("files").$type<{path:string;sha256:string;size:number}[]>().notNull().default([]),
  dependencies: jsonb("dependencies").$type<{name:string;version:string;source:string}[]>().notNull().default([]),
  mappings: jsonb("mappings").$type<{capabilityId:string;capabilityName:string;file:string;decision:"proposed"|"approved"|"rejected";note:string}[]>().notNull().default([]),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  reviewNote: text("review_note").notNull().default(""),
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SolutionPackageRow = typeof solutionPackagesTable.$inferSelect;
