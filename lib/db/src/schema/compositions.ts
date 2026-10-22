import { pgTable, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const compositionsTable = pgTable("compositions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  caseId: text("case_id"),
  revision: integer("revision").notNull().default(1),
  snapshot: jsonb("snapshot").notNull(),
  undo: jsonb("undo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("composition_idempotency").on(t.userId, t.idempotencyKey)]);

export const compositionRefinementsTable = pgTable("composition_refinements", {
  id: text("id").primaryKey(),
  compositionId: text("composition_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  status: text("status").notNull().default("preview"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
