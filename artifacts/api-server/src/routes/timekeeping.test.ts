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

const token = `timekeeping-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
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

describe("timekeeping route authorization and timing", () => {
  it(
    "enforces active assignment access, chronological timing, and persisted worked minutes",
    async () => {
      const { server, baseUrl } = await startServer();
      let assignedCleanerId: number | undefined;
      let unrelatedCleanerId: number | undefined;
      let jobId: number | undefined;
      let assignmentId: number | undefined;
      const timeEntryIds: number[] = [];

      try {
        expectStatus(await request(baseUrl, "/jobs/1/time/clock-in", {
          method: "POST",
        }), 401);

        const assignedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} assigned cleaner`,
            clerkUserId: assignedCleanerUserId,
            role: "cleaner",
            phone: "+12145550501",
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
            phone: "+12145550502",
          },
        }), 201) as { id: number };
        unrelatedCleanerId = unrelatedCleaner.id;

        const job = expectStatus(await request(baseUrl, "/jobs", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            clientName: `${token} job`,
            address: "500 Fixed Time Street, Dallas, TX 75001",
            scheduledDate: "2030-01-15",
            startTime: "09:00",
            endTime: "11:00",
            serviceType: "Standard cleaning",
            serviceVariant: "Timekeeping regression",
            addOns: [],
            durationMinutes: 120,
            frequency: "One-time",
            notes: "Disposable timekeeping fixture",
            clientPhone: "+12145550503",
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
        assignmentId = assignment!.id;

        expectStatus(await request(baseUrl, `/assignments/${assignment!.id}/accept`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200);

        const clockedIn = expectStatus(await request(baseUrl, `/jobs/${job.id}/time/clock-in`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 201) as { id: number; clockIn: string; clockOut: string | null };
        timeEntryIds.push(clockedIn.id);
        expect(clockedIn.clockOut).toBeNull();

        expectStatus(await request(baseUrl, `/jobs/${job.id}/time/clock-in`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 409);

        expectStatus(await request(baseUrl, `/jobs/${job.id}/time/clock-in`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/time-entries/${clockedIn.id}/break`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
          body: { minutes: 15 },
        }), 403);
        expectStatus(await request(baseUrl, `/time-entries/${clockedIn.id}/clock-out`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);

        await db.update(timeEntriesTable)
          .set({ clockIn: new Date("2020-01-15T09:00:00.000Z") })
          .where(eq(timeEntriesTable.id, clockedIn.id));
        const withBreak = expectStatus(await request(baseUrl, `/time-entries/${clockedIn.id}/break`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { minutes: 15 },
        }), 200) as { breaksMinutes: number };
        expect(withBreak.breaksMinutes).toBe(15);

        const clockedOut = expectStatus(await request(baseUrl, `/time-entries/${clockedIn.id}/clock-out`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as { clockIn: string; clockOut: string | null; breaksMinutes: number };
        expect(clockedOut.clockOut).not.toBeNull();
        expect(new Date(clockedOut.clockOut!).getTime()).toBeGreaterThan(new Date(clockedOut.clockIn).getTime());
        expect(clockedOut.breaksMinutes).toBe(15);

        const fixedValid = (await db.insert(timeEntriesTable).values({
          jobId: job.id,
          employeeId: assignedCleaner.id,
          clockIn: new Date("2020-01-16T09:00:00.000Z"),
          clockOut: new Date("2020-01-16T11:00:00.000Z"),
        }).returning())[0]!;
        timeEntryIds.push(fixedValid.id);
        const persistedBreak = expectStatus(await request(baseUrl, `/time-entries/${fixedValid.id}/break`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { minutes: 15 },
        }), 200) as { breaksMinutes: number };
        expect(persistedBreak.breaksMinutes).toBe(15);
        const [persistedEntry] = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, fixedValid.id));
        expect(persistedEntry?.breaksMinutes).toBe(15);
        expect(calculateWorkedMinutes(persistedEntry!)).toBe(105);

        const fixedOverlong = (await db.insert(timeEntriesTable).values({
          jobId: job.id,
          employeeId: assignedCleaner.id,
          clockIn: new Date("2020-01-16T09:00:00.000Z"),
          clockOut: new Date("2020-01-16T10:00:00.000Z"),
        }).returning())[0]!;
        timeEntryIds.push(fixedOverlong.id);
        expectStatus(await request(baseUrl, `/time-entries/${fixedOverlong.id}/break`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { minutes: 61 },
        }), 409);

        const fixedInvalidTimeline = (await db.insert(timeEntriesTable).values({
          jobId: job.id,
          employeeId: assignedCleaner.id,
          clockIn: new Date("2020-01-16T10:00:00.000Z"),
          clockOut: new Date("2020-01-16T09:00:00.000Z"),
        }).returning())[0]!;
        timeEntryIds.push(fixedInvalidTimeline.id);
        expectStatus(await request(baseUrl, `/time-entries/${fixedInvalidTimeline.id}/break`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { minutes: 5 },
        }), 409);

        const futureEntry = (await db.insert(timeEntriesTable).values({
          jobId: job.id,
          employeeId: assignedCleaner.id,
          clockIn: new Date("2099-01-16T10:00:00.000Z"),
        }).returning())[0]!;
        timeEntryIds.push(futureEntry.id);
        expectStatus(await request(baseUrl, `/time-entries/${futureEntry.id}/clock-out`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 409);
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
        const employeeIds = [assignedCleanerId, unrelatedCleanerId].filter((id): id is number => id !== undefined);
        if (employeeIds.length) {
          await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
        }
        void assignmentId;
      }
    },
    30_000,
  );
});