import { createInsertSchema } from "drizzle-zod";
import { date, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const servicePlansTable = pgTable("service_plans", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  addressId: integer("address_id").notNull(),
  serviceType: text("service_type").notNull(),
  frequency: text("frequency").notNull(),
  intervalWeeks: integer("interval_weeks"),
  nextOccurrence: date("next_occurrence", { mode: "string" }).notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const serviceOccurrencesTable = pgTable("service_occurrences", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => servicePlansTable.id),
  jobId: integer("job_id"),
  occurrenceDate: date("occurrence_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("scheduled"),
  skippedReason: text("skipped_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const proofPhotosTable = pgTable("proof_photos", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  kind: text("kind").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  uploadedBy: integer("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const incidentsTable = pgTable("incidents", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityEventsTable = pgTable("activity_events", {
  id: serial("id").primaryKey(),
  actorClerkUserId: text("actor_clerk_user_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  jobId: integer("job_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id"),
  recipient: text("recipient").notNull(),
  body: text("body").notNull(),
  provider: text("provider").notNull().default("internal"),
  channel: text("channel").notNull().default("sms"),
  audience: text("audience").notNull().default("customer"),
  recipientPhone: text("recipient_phone"),
  recipientName: text("recipient_name"),
  providerMessageId: text("provider_message_id"),
  status: text("status").notNull().default("queued"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  actorClerkUserId: text("actor_clerk_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertServicePlanSchema = createInsertSchema(servicePlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOccurrenceSchema = createInsertSchema(serviceOccurrencesTable).omit({ id: true, createdAt: true });
export const insertPhotoSchema = createInsertSchema(proofPhotosTable).omit({ id: true, createdAt: true });
export const insertIncidentSchema = createInsertSchema(incidentsTable).omit({ id: true, createdAt: true });
export const insertActivityEventSchema = createInsertSchema(activityEventsTable).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type ServicePlan = typeof servicePlansTable.$inferSelect;
export type ServiceOccurrence = typeof serviceOccurrencesTable.$inferSelect;
export type ProofPhoto = typeof proofPhotosTable.$inferSelect;
export type Incident = typeof incidentsTable.$inferSelect;
export type ActivityEvent = typeof activityEventsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type InsertServicePlan = z.infer<typeof insertServicePlanSchema>;