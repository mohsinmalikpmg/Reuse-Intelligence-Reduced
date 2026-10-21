import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const consolidationSourcesTable = pgTable("consolidation_sources", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  sha256: text("sha256").notNull(),
  metadata: jsonb("metadata").notNull(),
  objectPath: text("object_path").notNull(),
  registeredBy: text("registered_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const consolidationCasesTable = pgTable("consolidation_cases", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  revision: integer("revision").notNull().default(1),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
