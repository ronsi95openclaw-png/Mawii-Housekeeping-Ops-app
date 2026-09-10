import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import { calculateWorkedMinutes } from "../lib/time-entries";
import {
  activityEventsTable,
  db,
  employeesTable,
  jobAssignmentsTable,
  jobsTable,
  timeEntriesTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `time-corrections-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerUserId = `${token}-manager`;
const assignedCleanerUserId = `${token}-assigned`;
const unrelatedCleanerUserId = `${token}-unrelated`;

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose an address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api` };
}

async function request(
  baseUrl: string,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: Json } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: Json = null;
  if (text) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body };
}

function expectStatus(result: { status: number; body: Json }, status: number) {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  return result.body;
}

describe("time correction route authorization and review", () => {
  it(
    "preserves originals, validates corrections, and enforces review state transitions",
    async () => {
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      let assignedCleanerId: number | undefined;
      let unrelatedCleanerId: number | undefined;
      let jobId: number | undefined;
      const timeEntryIds: number[] = [];

      try {
        expectStatus(await request(baseUrl, "/time-entries/1/correction", {
          method: "POST",
          body: { minutes: 30, reason: "Unauthenticated correction" },
        }), 401);

        const manager = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} manager`,
            clerkUserId: managerUserId,
            role: "manager",
            phone: "+12145550601",
          },
        }), 201) as { id: number };
        managerId = manager.id;

        const assignedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} assigned cleaner`,
            clerkUserId: assignedCleanerUserId,
            role: "cleaner",
            phone: "+12145550602",
          },
        }), 201) as { id: number };
        assignedCleanerId = assignedCleaner.id;

        const unrelatedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} unrelated cleaner`,
            clerkUserId: unrelatedCleanerUserId,
            role: "cleaner",
            phone: "+12145550603",
          },
        }), 201) as { id: number };
        unrelatedCleanerId = unrelatedCleaner.id;

        const job = expectStatus(await request(baseUrl, "/jobs", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            clientName: `${token} job`,
            address: "600 Fixed Correction Street, Dallas, TX 75001",
            scheduledDate: "2030-01-15",
            startTime: "09:00",
            endTime: "11:00",
            serviceType: "Standard cleaning",
            serviceVariant: "Correction regression",
            addOns: [],
            durationMinutes: 120,
            frequency: "One-time",
            notes: "Disposable correction fixture",
            clientPhone: "+12145550604",
            teamMemberIds: [],
            employeeIds: [assignedCleaner.id],
          },
        }), 201) as { id: number };
        jobId = job.id;

        const [assignment] = await db.select().from(jobAssignmentsTable).where(and(
          eq(jobAssignmentsTable.jobId, job.id),
          eq(jobAssignmentsTable.employeeId, assignedCleaner.id),
        ));
        expect(assignment).toBeDefined();
        expectStatus(await request(baseUrl, `/assignments/${assignment!.id}/accept`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200);

        const [approvedEntry] = await db.insert(timeEntriesTable).values({
          jobId: job.id,
          employeeId: assignedCleaner.id,
          clockIn: new Date("2020-01-15T09:00:00.000Z"),
          clockOut: new Date("2020-01-15T11:00:00.000Z"),
          breaksMinutes: 15,
        }).returning();
        const [rejectedEntry] = await db.insert(timeEntriesTable).values({
          jobId: job.id,
          employeeId: assignedCleaner.id,
          clockIn: new Date("2020-01-16T09:00:00.000Z"),
          clockOut: new Date("2020-01-16T11:00:00.000Z"),
          breaksMinutes: 15,
        }).returning();
        const [invalidEntry] = await db.insert(timeEntriesTable).values({
          jobId: job.id,
          employeeId: assignedCleaner.id,
          clockIn: new Date("2020-01-17T09:00:00.000Z"),
          clockOut: new Date("2020-01-17T11:00:00.000Z"),
          breaksMinutes: 15,
        }).returning();
        timeEntryIds.push(approvedEntry!.id, rejectedEntry!.id, invalidEntry!.id);

        const original = {
          clockIn: approvedEntry!.clockIn.toISOString(),
          clockOut: approvedEntry!.clockOut!.toISOString(),
          breaksMinutes: approvedEntry!.breaksMinutes,
        };
        const pending = expectStatus(await request(baseUrl, `/time-entries/${approvedEntry!.id}/correction`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { minutes: 30, reason: "Approved time correction" },
        }), 200) as { clockIn: string; clockOut: string; breaksMinutes: number; correctionMinutes: number; correctionStatus: string };
        expect(pending.correctionStatus).toBe("pending");
        expect(pending.correctionMinutes).toBe(30);
        expect(pending.clockIn).toBe(original.clockIn);
        expect(pending.clockOut).toBe(original.clockOut);
        expect(pending.breaksMinutes).toBe(original.breaksMinutes);

        expectStatus(await request(baseUrl, `/time-entries/${approvedEntry!.id}/correction`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
          body: { minutes: 30, reason: "Unauthorized correction" },
        }), 403);
        expectStatus(await request(baseUrl, `/time-entries/${approvedEntry!.id}/approve`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/time-entries/${approvedEntry!.id}/reject`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { reason: "Unauthorized rejection" },
        }), 403);

        const approved = expectStatus(await request(baseUrl, `/time-entries/${approvedEntry!.id}/approve`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
        }), 200) as { correctionStatus: string; correctionMinutes: number };
        expect(approved.correctionStatus).toBe("approved");
        expect(approved.correctionMinutes).toBe(30);
        const [approvedAfterReview] = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, approvedEntry!.id));
        expect(approvedAfterReview?.clockIn.toISOString()).toBe(original.clockIn);
        expect(approvedAfterReview?.clockOut?.toISOString()).toBe(original.clockOut);
        expect(approvedAfterReview?.breaksMinutes).toBe(15);
        expect(calculateWorkedMinutes(approvedAfterReview!)).toBe(135);
        expectStatus(await request(baseUrl, `/time-entries/${approvedEntry!.id}/reject`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { reason: "Inconsistent second resolution" },
        }), 404);
        expectStatus(await request(baseUrl, `/time-entries/${approvedEntry!.id}/approve`, {
          method: "POST",
          headers: ownerHeaders,
        }), 404);

        expectStatus(await request(baseUrl, `/time-entries/${rejectedEntry!.id}/correction`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { minutes: 10, reason: "Rejected time correction" },
        }), 200);
        expectStatus(await request(baseUrl, `/time-entries/${rejectedEntry!.id}/reject`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { reason: " " },
        }), 400);
        const rejected = expectStatus(await request(baseUrl, `/time-entries/${rejectedEntry!.id}/reject`, {
          method: "POST",
          headers: ownerHeaders,
          body: { reason: "Insufficient supporting detail" },
        }), 200) as { correctionStatus: string; correctionReason: string };
        expect(rejected.correctionStatus).toBe("rejected");
        expect(rejected.correctionReason).toBe("Insufficient supporting detail");
        expectStatus(await request(baseUrl, `/time-entries/${rejectedEntry!.id}/approve`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
        }), 404);
        expectStatus(await request(baseUrl, `/time-entries/${rejectedEntry!.id}/reject`, {
          method: "POST",
          headers: ownerHeaders,
          body: { reason: "Second rejection" },
        }), 404);

        expectStatus(await request(baseUrl, `/time-entries/${invalidEntry!.id}/correction`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { minutes: -106, reason: "Impossible backward correction" },
        }), 409);
        const [invalidAfter] = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, invalidEntry!.id));
        expect(invalidAfter?.correctionStatus).toBe("none");
        expect(invalidAfter?.correctionMinutes).toBe(0);
        expect(invalidAfter?.clockIn.toISOString()).toBe("2020-01-17T09:00:00.000Z");
        expect(invalidAfter?.clockOut?.toISOString()).toBe("2020-01-17T11:00:00.000Z");
        expect(invalidAfter?.breaksMinutes).toBe(15);
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (timeEntryIds.length) {
          await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, timeEntryIds));
        } else if (jobId) {
          await db.delete(timeEntriesTable).where(eq(timeEntriesTable.jobId, jobId));
        }
        if (jobId) {
          await db.delete(activityEventsTable).where(eq(activityEventsTable.jobId, jobId));
          await db.delete(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, jobId));
          await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
        }
        const employeeIds = [managerId, assignedCleanerId, unrelatedCleanerId].filter((id): id is number => id !== undefined);
        if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
      }
    },
    30_000,
  );
});