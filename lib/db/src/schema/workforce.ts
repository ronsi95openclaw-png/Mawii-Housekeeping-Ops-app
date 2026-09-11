import { createInsertSchema } from "drizzle-zod";
import { date, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("cleaner"),
  phone: text("phone"),
  active: text("active").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeeBindingTokensTable = pgTable("employee_binding_tokens", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeeJobNotesTable = pgTable("employee_job_notes", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobAssignmentsTable = pgTable("job_assignments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  status: text("status").notNull().default("assigned"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timeEntriesTable = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  clockIn: timestamp("clock_in", { withTimezone: true }).notNull(),
  clockOut: timestamp("clock_out", { withTimezone: true }),
  breaksMinutes: integer("breaks_minutes").notNull().default(0),
  correctionMinutes: integer("correction_minutes").notNull().default(0),
  correctionReason: text("correction_reason"),
  correctionStatus: text("correction_status").notNull().default("none"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workerRatesTable = pgTable("worker_rates", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }).notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true });
export const insertEmployeeBindingTokenSchema = createInsertSchema(employeeBindingTokensTable).omit({ id: true, createdAt: true });
export const insertAssignmentSchema = createInsertSchema(jobAssignmentsTable).omit({ id: true, createdAt: true });
export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit({ id: true, createdAt: true });
export const insertWorkerRateSchema = createInsertSchema(workerRatesTable).omit({ id: true, createdAt: true });
export type Employee = typeof employeesTable.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type EmployeeBindingToken = typeof employeeBindingTokensTable.$inferSelect;
export type JobAssignment = typeof jobAssignmentsTable.$inferSelect;
export type TimeEntry = typeof timeEntriesTable.$inferSelect;
export type WorkerRate = typeof workerRatesTable.$inferSelect;