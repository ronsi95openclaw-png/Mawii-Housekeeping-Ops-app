import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import app from "../app";
import {
  db,
  employeesTable,
  jobImportEventsTable,
  jobsTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `elevate-import-regression-${randomUUID()}`;
const testSecret = `${token}-webhook-secret`;
const managerUserId = `${token}-manager`;
const cleanerUserId = `${token}-cleaner`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerHeaders = { "x-dev-user-id": managerUserId };
const cleanerHeaders = { "x-dev-user-id": cleanerUserId };

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

function signedHeaders() {
  return { "X-Mawii-Signature": testSecret };
}

describe("Elevate import regression", () => {
  it(
    "protects, normalizes, deduplicates, records, and authorizes appointment imports",
    async () => {
      process.env.SESSION_SECRET = testSecret;
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      let cleanerId: number | undefined;

      const normalPayload = {
        appointmentId: `${token}-normal`,
        clientName: `${token} normal customer`,
        clientPhone: "+12145550101",
        address: "100 Normal Intake Street, Dallas, TX 75201",
        appointment: "Standard cleaning",
        variant: "Normal boundary",
        addOns: ["Inside fridge"],
        durationMinutes: 90,
        frequency: "One-time",
        dateTime: "2031-02-14T15:30:00.000Z",
        endDateTime: "2031-02-14T17:00:00.000Z",
        status: "scheduled",
        notes: "Normal DFW business-time appointment.",
      };
      const daylightStartPayload = {
        appointmentId: `${token}-dst-start`,
        clientName: `${token} daylight start customer`,
        address: "200 Spring Intake Street, Dallas, TX 75201",
        appointment: "Deep cleaning",
        durationMinutes: 90,
        dateTime: "2031-03-09T14:30:00.000Z",
      };
      const daylightEndPayload = {
        appointmentId: `${token}-dst-end`,
        clientName: `${token} daylight end customer`,
        address: "300 Fall Intake Street, Dallas, TX 75201",
        appointment: "Move-out cleaning",
        durationMinutes: 60,
        dateTime: "2031-11-02T15:30:00.000Z",
      };
      const malformedPayload = {
        appointmentId: `${token}-malformed`,
        clientName: "",
      };
      const semanticPayload = {
        appointmentId: `${token}-semantic`,
        clientName: `${token} semantic failure`,
        address: "400 Semantic Intake Street, Dallas, TX 75201",
        appointment: "Standard cleaning",
        dateTime: "2031-02-15T16:00:00.000Z",
        endDateTime: "2031-02-15T15:00:00.000Z",
      };

      try {
        const [manager] = await db.insert(employeesTable).values({
          clerkUserId: managerUserId,
          name: `${token} manager`,
          role: "manager",
          phone: "+12145550102",
        }).returning();
        managerId = manager.id;
        const [cleaner] = await db.insert(employeesTable).values({
          clerkUserId: cleanerUserId,
          name: `${token} cleaner`,
          role: "cleaner",
          phone: "+12145550103",
        }).returning();
        cleanerId = cleaner.id;

        const beforeStatus = expectStatus(await request(baseUrl, "/integrations/elevate/status", {
          headers: managerHeaders,
        }), 200) as { totalReceived: number; failedCount: number };
        expectStatus(await request(baseUrl, "/integrations/elevate/status"), 401);
        expectStatus(await request(baseUrl, "/integrations/elevate/status", {
          headers: cleanerHeaders,
        }), 403);

        expectStatus(await request(baseUrl, "/integrations/elevate/jobs", {
          method: "POST",
          body: normalPayload,
        }), 401);
        expectStatus(await request(baseUrl, "/integrations/elevate/jobs", {
          method: "POST",
          headers: { "X-Mawii-Signature": `${testSecret}-wrong` },
          body: normalPayload,
        }), 401);
        expect(await db.select().from(jobImportEventsTable).where(like(jobImportEventsTable.externalId, `${token}%`))).toHaveLength(0);
        expect(await db.select().from(jobsTable).where(like(jobsTable.externalId, `${token}%`))).toHaveLength(0);

        const normal = expectStatus(await request(baseUrl, "/integrations/elevate/jobs", {
          method: "POST",
          headers: signedHeaders(),
          body: normalPayload,
        }), 201) as {
          success: boolean;
          duplicate: boolean;
          job: { id: number; clientName: string; clientPhone: string | null; address: string; scheduledDate: string; startTime: string; endTime: string; externalId: string };
        };
        expect(normal).toMatchObject({
          success: true,
          duplicate: false,
          job: {
            clientName: normalPayload.clientName,
            clientPhone: normalPayload.clientPhone,
            address: normalPayload.address,
            scheduledDate: "2031-02-14",
            startTime: "09:30",
            endTime: "11:00",
            externalId: normalPayload.appointmentId,
          },
        });

        const daylightStart = expectStatus(await request(baseUrl, "/integrations/elevate/jobs", {
          method: "POST",
          headers: signedHeaders(),
          body: daylightStartPayload,
        }), 201) as { job: { scheduledDate: string; startTime: string; endTime: string } };
        expect(daylightStart.job).toMatchObject({
          scheduledDate: "2031-03-09",
          startTime: "09:30",
          endTime: "11:00",
        });

        const daylightEnd = expectStatus(await request(baseUrl, "/integrations/elevate/jobs", {
          method: "POST",
          headers: signedHeaders(),
          body: daylightEndPayload,
        }), 201) as { job: { scheduledDate: string; startTime: string; endTime: string } };
        expect(daylightEnd.job).toMatchObject({
          scheduledDate: "2031-11-02",
          startTime: "09:30",
          endTime: "10:30",
        });

        const replay = expectStatus(await request(baseUrl, "/integrations/elevate/jobs", {
          method: "POST",
          headers: signedHeaders(),
          body: normalPayload,
        }), 200) as { success: boolean; duplicate: boolean; job: { id: number } };
        expect(replay).toMatchObject({ success: true, duplicate: true, job: { id: normal.job.id } });

        expectStatus(await request(baseUrl, "/integrations/elevate/jobs", {
          method: "POST",
          headers: signedHeaders(),
          body: malformedPayload,
        }), 400);
        expectStatus(await request(baseUrl, "/integrations/elevate/jobs", {
          method: "POST",
          headers: signedHeaders(),
          body: semanticPayload,
        }), 422);

        const jobs = await db.select().from(jobsTable).where(like(jobsTable.externalId, `${token}%`));
        expect(jobs).toHaveLength(3);
        expect(new Set(jobs.map((job) => job.externalId)).size).toBe(3);
        expect(jobs.find((job) => job.externalId === normalPayload.appointmentId)).toMatchObject({
          clientName: normalPayload.clientName,
          clientPhone: normalPayload.clientPhone,
          address: normalPayload.address,
        });

        const events = await db.select().from(jobImportEventsTable).where(like(jobImportEventsTable.externalId, `${token}%`));
        expect(events).toHaveLength(6);
        expect(events.filter((event) => event.success && !event.duplicate)).toHaveLength(3);
        expect(events.filter((event) => event.success && event.duplicate)).toHaveLength(1);
        expect(events.filter((event) => !event.success)).toHaveLength(2);
        expect(events.find((event) => event.externalId === normalPayload.appointmentId && event.duplicate)).toMatchObject({
          success: true,
          duplicate: true,
          jobId: normal.job.id,
        });
        expect(events.find((event) => event.externalId === malformedPayload.appointmentId)).toMatchObject({
          success: false,
          duplicate: false,
          jobId: null,
        });
        expect(events.find((event) => event.externalId === semanticPayload.appointmentId)).toMatchObject({
          success: false,
          duplicate: false,
          jobId: null,
        });
        expect(await db.select().from(jobsTable).where(eq(jobsTable.externalId, semanticPayload.appointmentId))).toHaveLength(0);

        const afterStatus = expectStatus(await request(baseUrl, "/integrations/elevate/status", {
          headers: managerHeaders,
        }), 200) as {
          configured: boolean;
          totalReceived: number;
          failedCount: number;
          recentEvents: Array<{ externalId: string | null; success: boolean; duplicate: boolean }>;
        };
        expect(afterStatus.configured).toBe(true);
        expect(afterStatus.totalReceived).toBe(beforeStatus.totalReceived + 6);
        expect(afterStatus.failedCount).toBe(beforeStatus.failedCount + 2);
        expect(afterStatus.recentEvents).toEqual(expect.arrayContaining([
          expect.objectContaining({ externalId: normalPayload.appointmentId, success: true, duplicate: false }),
          expect.objectContaining({ externalId: normalPayload.appointmentId, success: true, duplicate: true }),
          expect.objectContaining({ externalId: malformedPayload.appointmentId, success: false, duplicate: false }),
          expect.objectContaining({ externalId: semanticPayload.appointmentId, success: false, duplicate: false }),
        ]));
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        const jobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(like(jobsTable.externalId, `${token}%`));
        if (jobs.length) {
          await db.delete(jobImportEventsTable).where(like(jobImportEventsTable.externalId, `${token}%`));
          await db.delete(jobsTable).where(like(jobsTable.externalId, `${token}%`));
        } else {
          await db.delete(jobImportEventsTable).where(like(jobImportEventsTable.externalId, `${token}%`));
        }
        if (managerId || cleanerId) {
          await db.delete(employeesTable).where(and(
            managerId ? eq(employeesTable.id, managerId) : undefined,
            cleanerId ? eq(employeesTable.id, cleanerId) : undefined,
          ));
        }
        delete process.env.SESSION_SECRET;
      }
    },
    30_000,
  );
});