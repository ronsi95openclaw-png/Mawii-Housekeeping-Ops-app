import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import app from "../app";
import {
  activityEventsTable,
  db,
  employeesTable,
  jobAssignmentsTable,
  jobsTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `authorization-routes-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerUserId = `${token}-manager`;
const assignedCleanerUserId = `${token}-assigned-cleaner`;
const unrelatedCleanerUserId = `${token}-unrelated-cleaner`;
const unknownUserId = `${token}-unknown-user`;

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

describe("production route authorization", () => {
  it(
    "enforces identity, role, assignment, and checklist boundaries through the real app",
    async () => {
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      let assignedCleanerId: number | undefined;
      let unrelatedCleanerId: number | undefined;
      let assignedJobId: number | undefined;
      let unrelatedJobId: number | undefined;

      try {
        expectStatus(await request(baseUrl, "/jobs/1"), 401);
        expectStatus(await request(baseUrl, "/reports/owner?start=2026-09-12&end=2026-09-12"), 401);

        expectStatus(await request(baseUrl, "/reports/owner?start=2026-09-12&end=2026-09-12", {
          headers: { "x-dev-user-id": unknownUserId },
        }), 403);
        expectStatus(await request(baseUrl, "/jobs", {
          headers: { "x-dev-user-id": unknownUserId },
        }), 403);
        expectStatus(await request(baseUrl, "/dashboard/summary", {
          headers: { "x-dev-user-id": unknownUserId },
        }), 403);
        expectStatus(await request(baseUrl, "/team", {
          headers: { "x-dev-user-id": unknownUserId },
        }), 403);

        const manager = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: "Authorization Route Manager",
            clerkUserId: managerUserId,
            role: "manager",
            phone: "+12145550201",
          },
        }), 201) as { id: number };
        managerId = manager.id;

        const assignedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: "Authorization Route Assigned Cleaner",
            clerkUserId: assignedCleanerUserId,
            role: "cleaner",
            phone: "+12145550202",
          },
        }), 201) as { id: number };
        assignedCleanerId = assignedCleaner.id;

        const unrelatedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: "Authorization Route Unrelated Cleaner",
            clerkUserId: unrelatedCleanerUserId,
            role: "cleaner",
            phone: "+12145550203",
          },
        }), 201) as { id: number };
        unrelatedCleanerId = unrelatedCleaner.id;

        const createJob = async (clientName: string, employeeIds: number[]) =>
          expectStatus(await request(baseUrl, "/jobs", {
            method: "POST",
            headers: ownerHeaders,
            body: {
              clientName,
              address: "200 Authorization Lane, Dallas, TX 75001",
              scheduledDate: "2026-09-12",
              startTime: "09:00",
              endTime: "12:00",
              serviceType: "Standard cleaning",
              serviceVariant: "Authorization regression",
              addOns: [],
              durationMinutes: 180,
              frequency: "One-time",
              notes: "Disposable authorization test record",
              clientPhone: "+12145550204",
              teamMemberIds: [],
              employeeIds,
            },
          }), 201) as { id: number };

        const assignedJob = await createJob(`${token}-assigned-job`, [assignedCleaner.id]);
        assignedJobId = assignedJob.id;
        const unrelatedJob = await createJob(`${token}-unrelated-job`, [unrelatedCleaner.id]);
        unrelatedJobId = unrelatedJob.id;

        expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}`, {
          headers: ownerHeaders,
        }), 200);
        expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}`, {
          headers: { "x-dev-user-id": managerUserId },
        }), 200);
        expectStatus(await request(baseUrl, `/reports/owner?start=2026-09-12&end=2026-09-12`, {
          headers: ownerHeaders,
        }), 200);
        expectStatus(await request(baseUrl, `/reports/owner?start=2026-09-12&end=2026-09-12`, {
          headers: { "x-dev-user-id": managerUserId },
        }), 200);

        const assignedCleanerJob = expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as { checklist: Array<{ id: number; completed: boolean }> };
        expectStatus(await request(baseUrl, `/jobs/${unrelatedJob.id}`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/reports/owner?start=2026-09-12&end=2026-09-12`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, "/dashboard/summary", {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, "/activity", {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, "/team", {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 403);

        const checklistItem = assignedCleanerJob.checklist[0];
        expect(checklistItem).toBeDefined();
        expectStatus(await request(baseUrl, `/jobs/${unrelatedJob.id}/checklist`, {
          method: "PATCH",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { itemId: checklistItem!.id, completed: true },
        }), 403);
        expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}/checklist`, {
          method: "PATCH",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { itemId: checklistItem!.id, completed: true },
        }), 200);

        const persistedJob = expectStatus(await request(baseUrl, `/jobs/${assignedJob.id}`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as { checklist: Array<{ id: number; completed: boolean }> };
        expect(persistedJob.checklist.find((item) => item.id === checklistItem!.id)?.completed).toBe(true);
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        const jobIds = [assignedJobId, unrelatedJobId].filter((value): value is number => value !== undefined);
        const employeeIds = [managerId, assignedCleanerId, unrelatedCleanerId].filter((value): value is number => value !== undefined);
        if (jobIds.length) {
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
