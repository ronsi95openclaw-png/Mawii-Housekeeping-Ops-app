import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone").notNull(),
  status: text("status").notNull().default("available"),
  initials: text("initials").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  clientName: text("client_name").notNull(),
  address: text("address").notNull(),
  scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  status: text("status").notNull().default("scheduled"),
  serviceType: text("service_type").notNull(),
  serviceVariant: text("service_variant"),
  addOns: jsonb("add_ons").$type<string[]>().notNull().default([]),
  durationMinutes: integer("duration_minutes"),
  frequency: text("frequency"),
  notes: text("notes"),
  clientPhone: text("client_phone"),
  externalSource: text("external_source"),
  externalId: text("external_id"),
  teamMemberIds: integer("team_member_ids").array().notNull().default([]),
  checklist: jsonb("checklist").$type<{ id: number; label: string; completed: boolean }[]>().notNull().default([]),
  photos: jsonb("photos").$type<{ id: number; url: string; label: string; createdAt: string }[]>().notNull().default([]),
  accessInstructions: text("access_instructions"),
  completedByEmployeeId: integer("completed_by_employee_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("jobs_external_source_id_unique").on(table.externalSource, table.externalId),
]);

export const jobImportEventsTable = pgTable("job_import_events", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  externalId: text("external_id"),
  success: boolean("success").notNull(),
  duplicate: boolean("duplicate").notNull().default(false),
  message: text("message").notNull(),
  jobId: integer("job_id"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({
  id: true,
  createdAt: true,
});
export const insertJobSchema = createInsertSchema(jobsTable).omit({
  id: true,
  createdAt: true,
});
export const insertJobImportEventSchema = createInsertSchema(jobImportEventsTable).omit({
  id: true,
  receivedAt: true,
});
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
export type JobImportEvent = typeof jobImportEventsTable.$inferSelect;