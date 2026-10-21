import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const intakeRecordsTable = pgTable("intake_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  model: jsonb("model").notNull(),
  revision: integer("revision").notNull().default(1),
  status: text("status").notNull().default("draft"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const intakeAttachmentsTable = pgTable("intake_attachments", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull().references(() => intakeRecordsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  sourceId: text("source_id").notNull(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull(),
  mime: text("mime").notNull(),
  status: text("status").notNull(),
  textContent: text("text_content").notNull().default(""),
  error: text("error"),
});
