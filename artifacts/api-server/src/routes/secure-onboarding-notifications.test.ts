import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  activityEventsTable,
  db,
  employeeBindingTokensTable,
  employeesTable,
  jobAssignmentsTable,
  jobsTable,
  messagesTable,
  notificationsTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `secure-onboarding-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const cleanerUserId = `${token}-cleaner`;
const secondUserId = `${token}-second`;

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

describe("secure cleaner onboarding and notifications", () => {
  it("binds a real authenticated identity once and delivers internal operations activity", async () => {
    const { server, baseUrl } = await startServer();
    let employeeId: number | undefined;
    let jobId: number | undefined;

    try {
      const created = expectStatus(await request(baseUrl, "/employees", {
        method: "POST",
        headers: ownerHeaders,
        body: { name: `${token} cleaner`, role: "cleaner", phone: "+12145550901" },
      }), 201) as { id: number; clerkUserId: string; bindingToken?: string };
      employeeId = created.id;
      expect(created.clerkUserId).toMatch(/^pending-/);
      expect(created.bindingToken).toMatch(/^[a-f0-9]{64}$/);

      const [binding] = await db.select().from(employeeBindingTokensTable).where(eq(employeeBindingTokensTable.employeeId, created.id));
      expect(binding?.tokenHash).toHaveLength(64);
      expect(binding?.tokenHash).not.toBe(created.bindingToken);
      expect(binding?.claimedAt).toBeNull();

      expectStatus(await request(baseUrl, "/employees/claim", {
        method: "POST",
        headers: { "x-dev-user-id": cleanerUserId },
        body: { token: "not-the-token" },
      }), 400);
      const claimed = expectStatus(await request(baseUrl, "/employees/claim", {
        method: "POST",
        headers: { "x-dev-user-id": cleanerUserId },
        body: { token: created.bindingToken },
      }), 200) as { id: number; clerkUserId: string };
      expect(claimed).toMatchObject({ id: created.id, clerkUserId: cleanerUserId });
      const [claimedBinding] = await db.select().from(employeeBindingTokensTable).where(eq(employeeBindingTokensTable.employeeId, created.id));
      expect(claimedBinding?.claimedAt).not.toBeNull();

      expectStatus(await request(baseUrl, "/employees/claim", {
        method: "POST",
        headers: { "x-dev-user-id": secondUserId },
        body: { token: created.bindingToken },
      }), 400);

      const job = expectStatus(await request(baseUrl, "/jobs", {
        method: "POST",
        headers: ownerHeaders,
        body: {
          clientName: `${token} client`,
          address: "120 Internal Lane, Dallas, TX 75201",
          scheduledDate: "2031-02-15",
          startTime: "09:00",
          endTime: "12:00",
          serviceType: "Standard cleaning",
          serviceVariant: "Onboarding regression",
          addOns: [],
          durationMinutes: 180,
          frequency: "One-time",
          notes: "Internal activity test",
          clientPhone: "+12145550902",
          teamMemberIds: [],
          employeeIds: [created.id],
        },
      }), 201) as { id: number };
      jobId = job.id;

      const initialNotifications = expectStatus(await request(baseUrl, "/notifications", {
        headers: { "x-dev-user-id": cleanerUserId },
      }), 200) as Array<{ kind: string }>;
      expect(initialNotifications.some((item) => item.kind === "assignment")).toBe(true);

      const [assignment] = await db.select().from(jobAssignmentsTable).where(and(
        eq(jobAssignmentsTable.jobId, job.id),
        eq(jobAssignmentsTable.employeeId, created.id),
      ));
      expect(assignment).toBeDefined();
      expectStatus(await request(baseUrl, `/assignments/${assignment!.id}/accept`, {
        method: "POST",
        headers: { "x-dev-user-id": cleanerUserId },
      }), 200);

      expectStatus(await request(baseUrl, `/jobs/${job.id}/messages`, {
        method: "POST",
        headers: { "x-dev-user-id": cleanerUserId },
        body: { body: "Access confirmed", audience: "employee", recipient: "operations" },
      }), 201);
      expectStatus(await request(baseUrl, `/jobs/${job.id}/messages`, {
        method: "POST",
        headers: { "x-dev-user-id": cleanerUserId },
        body: { body: "Customer message should be blocked", audience: "customer", channel: "sms" },
      }), 403);

      expectStatus(await request(baseUrl, `/jobs/${job.id}/reminders`, {
        method: "POST",
        headers: ownerHeaders,
        body: { title: "Bring lockbox key", body: "Confirm the side gate before departure." },
      }), 201);
      const afterActivity = expectStatus(await request(baseUrl, "/notifications", {
        headers: { "x-dev-user-id": cleanerUserId },
      }), 200) as Array<{ id: number; kind: string; readAt: string | null }>;
      expect(afterActivity.some((item) => item.kind === "message")).toBe(true);
      expect(afterActivity.some((item) => item.kind === "reminder")).toBe(true);

      const firstUnread = afterActivity.find((item) => item.readAt === null);
      expect(firstUnread).toBeDefined();
      expectStatus(await request(baseUrl, `/notifications/${firstUnread!.id}/read`, {
        method: "POST",
        headers: { "x-dev-user-id": cleanerUserId },
      }), 200);
      expectStatus(await request(baseUrl, "/notifications/read-all", {
        method: "POST",
        headers: { "x-dev-user-id": cleanerUserId },
      }), 204);
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      if (jobId) {
        await db.delete(messagesTable).where(eq(messagesTable.jobId, jobId));
        await db.delete(notificationsTable).where(eq(notificationsTable.jobId, jobId));
        await db.delete(activityEventsTable).where(eq(activityEventsTable.jobId, jobId));
        await db.delete(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, jobId));
        await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
      }
      if (employeeId) {
        await db.delete(employeeBindingTokensTable).where(eq(employeeBindingTokensTable.employeeId, employeeId));
        await db.delete(notificationsTable).where(eq(notificationsTable.employeeId, employeeId));
        await db.delete(employeesTable).where(inArray(employeesTable.id, [employeeId]));
      }
    }
  }, 30_000);
});