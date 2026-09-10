import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { inArray } from "drizzle-orm";
import app from "../app";
import {
  activityEventsTable,
  db,
  employeesTable,
  jobAssignmentsTable,
  jobsTable,
  messagesTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `message-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const cleanerUserId = `${token}-cleaner`;
const unrelatedCleanerUserId = `${token}-unrelated`;
const managerUserId = `${token}-manager`;

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

describe("job message-history authorization", () => {
  it(
    "allows owner/manager and assigned cleaner access, while denying unauthenticated, unrelated, and mismatched identifiers",
    async () => {
      const { server, baseUrl } = await startServer();
      let cleanerId: number | undefined;
      let unrelatedCleanerId: number | undefined;
      let managerId: number | undefined;
      let assignedJobId: number | undefined;
      let unrelatedJobId: number | undefined;
      let assignedAssignmentId: number | undefined;
      let unrelatedAssignmentId: number | undefined;

      try {
        expectStatus(await request(baseUrl, "/jobs/1/messages"), 401);

        const cleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: "Message History Assigned Cleaner",
            clerkUserId: cleanerUserId,
            role: "cleaner",
            phone: "+12145550101",
          },
        }), 201) as { id: number };
        cleanerId = cleaner.id;

        const unrelatedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: "Message History Unrelated Cleaner",
            clerkUserId: unrelatedCleanerUserId,
            role: "cleaner",
            phone: "+12145550102",
          },
        }), 201) as { id: number };
        unrelatedCleanerId = unrelatedCleaner.id;

        const manager = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: "Message History Manager",
            clerkUserId: managerUserId,
            role: "manager",
            phone: "+12145550103",
          },
        }), 201) as { id: number };
        managerId = manager.id;

        const createJob = async (clientName: string, employeeIds: number[]) =>
          expectStatus(await request(baseUrl, "/jobs", {
            method: "POST",
            headers: ownerHeaders,
            body: {
              clientName,
              address: "100 Regression Lane, Dallas, TX 75001",
              scheduledDate: "2026-09-12",
              startTime: "09:00",
              endTime: "12:00",
              serviceType: "Standard cleaning",
              serviceVariant: "Message history regression",
              addOns: [],
              durationMinutes: 180,
              frequency: "One-time",
              notes: "Route authorization regression",
              clientPhone: "+12145550104",
              teamMemberIds: [],
              employeeIds,
            },
          }), 201) as { id: number; assignedEmployees?: Array<{ id: number }> };

        const assignedJob = await createJob(`MAWII message history assigned ${token}`, [cleaner.id]);
        assignedJobId = assignedJob.id;
        const unrelatedJob = await createJob(`MAWII message history unrelated ${token}`, [unrelatedCleaner.id]);
        unrelatedJobId = unrelatedJob.id;

        const assignments = await db
          .select()
          .from(jobAssignmentsTable)
          .where(inArray(jobAssignmentsTable.jobId, [assignedJob.id, unrelatedJob.id]));
        assignedAssignmentId = assignments.find((assignment) => assignment.jobId === assignedJob.id)?.id;
        unrelatedAssignmentId = assignments.find((assignment) => assignment.jobId === unrelatedJob.id)?.id;
        expect(assignedAssignmentId).toBeDefined();
        expect(unrelatedAssignmentId).toBeDefined();

        expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}/messages`, {
          method: "POST",
          headers: ownerHeaders,
          body: { recipient: "client", body: "Assigned job message", channel: "sms", audience: "customer" },
        }), 201);

        const ownerHistory = expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}/messages`, {
          headers: ownerHeaders,
        }), 200) as Array<{ body: string }>;
        expect(ownerHistory).toHaveLength(1);
        expect(ownerHistory[0]?.body).toBe("Assigned job message");

        const managerHistory = expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}/messages`, {
          headers: { "x-dev-user-id": managerUserId },
        }), 200) as Array<{ body: string }>;
        expect(managerHistory).toHaveLength(1);

        const assignedCleanerHistory = expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}/messages`, {
          headers: { "x-dev-user-id": cleanerUserId },
        }), 200) as Array<{ body: string }>;
        expect(assignedCleanerHistory).toHaveLength(1);

        expectStatus(await request(baseUrl, `/jobs/${unrelatedJob.id}/messages`, {
          headers: { "x-dev-user-id": cleanerUserId },
        }), 403);

        expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}/messages`, {
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);

        expectStatus(await request(baseUrl, `/jobs/${unrelatedAssignmentId}/messages`, {
          headers: { "x-dev-user-id": cleanerUserId },
        }), 403);

        expectStatus(await request(baseUrl, `/jobs/${assignedAssignmentId}/messages`, {
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        const jobIds = [assignedJobId, unrelatedJobId].filter((value): value is number => value !== undefined);
        const employeeIds = [cleanerId, unrelatedCleanerId, managerId].filter((value): value is number => value !== undefined);
        if (jobIds.length) {
          await db.delete(messagesTable).where(inArray(messagesTable.jobId, jobIds));
          await db.delete(activityEventsTable).where(inArray(activityEventsTable.jobId, jobIds));
          await db.delete(jobAssignmentsTable).where(inArray(jobAssignmentsTable.jobId, jobIds));
          await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
        }
        if (employeeIds.length) {
          await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
        }
      }
    },
    30_000,
  );
});