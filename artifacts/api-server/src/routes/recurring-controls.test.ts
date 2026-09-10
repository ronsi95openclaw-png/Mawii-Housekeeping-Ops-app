import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  activityEventsTable,
  addressesTable,
  customersTable,
  db,
  employeesTable,
  jobsTable,
  serviceOccurrencesTable,
  servicePlansTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;
type Fixture = {
  server: Server;
  baseUrl: string;
  planId: number;
  managerUserId: string;
  cleanerUserId?: string;
  cleanup: () => Promise<void>;
};

const token = `recurring-controls-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };

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

async function createFixture(withCleaner = false): Promise<Fixture> {
  const { server, baseUrl } = await startServer();
  const managerUserId = `${token}-${randomUUID()}-manager`;
  const cleanerUserId = `${token}-${randomUUID()}-cleaner`;
  let managerId: number | undefined;
  let cleanerId: number | undefined;
  let customerId: number | undefined;
  let addressId: number | undefined;
  let planId: number | undefined;
  const activityBefore = new Set((await db.select({ id: activityEventsTable.id }).from(activityEventsTable)).map((row) => row.id));

  const cleanup = async () => {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    const occurrences = planId
      ? await db.select().from(serviceOccurrencesTable).where(eq(serviceOccurrencesTable.planId, planId))
      : [];
    const occurrenceIds = occurrences.map((occurrence) => occurrence.id);
    const jobIds = occurrences.flatMap((occurrence) => occurrence.jobId ?? []);
    const currentActivity = await db.select({ id: activityEventsTable.id }).from(activityEventsTable);
    const generatedActivityIds = currentActivity
      .map((row) => row.id)
      .filter((id) => !activityBefore.has(id));
    if (generatedActivityIds.length) {
      await db.delete(activityEventsTable).where(inArray(activityEventsTable.id, generatedActivityIds));
    }
    if (occurrenceIds.length) {
      await db.delete(serviceOccurrencesTable).where(inArray(serviceOccurrencesTable.id, occurrenceIds));
    }
    if (jobIds.length) {
      await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
    }
    if (planId) await db.delete(servicePlansTable).where(eq(servicePlansTable.id, planId));
    if (addressId) await db.delete(addressesTable).where(eq(addressesTable.id, addressId));
    if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
    const employeeIds = [managerId, cleanerId].filter((id): id is number => id !== undefined);
    if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
  };

  try {
    const manager = expectStatus(await request(baseUrl, "/employees", {
      method: "POST",
      headers: ownerHeaders,
      body: {
        name: `${token} manager`,
        clerkUserId: managerUserId,
        role: "manager",
        phone: "+12145550401",
      },
    }), 201) as { id: number };
    managerId = manager.id;

    if (withCleaner) {
      const cleaner = expectStatus(await request(baseUrl, "/employees", {
        method: "POST",
        headers: ownerHeaders,
        body: {
          name: `${token} cleaner`,
          clerkUserId: cleanerUserId,
          role: "cleaner",
          phone: "+12145550402",
        },
      }), 201) as { id: number };
      cleanerId = cleaner.id;
    }

    const customer = expectStatus(await request(baseUrl, "/customers", {
      method: "POST",
      headers: ownerHeaders,
      body: { name: `${token} customer`, phone: "+12145550403" },
    }), 201) as { id: number };
    customerId = customer.id;

    const address = expectStatus(await request(baseUrl, `/customers/${customer.id}/addresses`, {
      method: "POST",
      headers: ownerHeaders,
      body: {
        line1: "400 Fixed Series Street",
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        accessNotes: "Recurring controls fixture",
      },
    }), 201) as { id: number };
    addressId = address.id;

    const plan = expectStatus(await request(baseUrl, "/service-plans", {
      method: "POST",
      headers: ownerHeaders,
      body: {
        customerId: customer.id,
        addressId: address.id,
        serviceType: `${token} service`,
        frequency: "weekly",
        nextOccurrence: "2030-01-15",
        preferences: { startTime: "09:00", endTime: "12:00" },
      },
    }), 201) as { id: number };
    planId = plan.id;

    return { server, baseUrl, planId: plan.id, managerUserId, cleanerUserId: withCleaner ? cleanerUserId : undefined, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function listOccurrences(planId: number) {
  return db.select().from(serviceOccurrencesTable).where(eq(serviceOccurrencesTable.planId, planId));
}

describe("recurring-service controls", () => {
  it("edits only one generated occurrence without changing the series or creating a duplicate", async () => {
    const fixture = await createFixture();
    try {
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: ownerHeaders,
        body: { count: 3 },
      }), 201);
      const before = (await listOccurrences(fixture.planId)).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
      const [planBefore] = await db.select().from(servicePlansTable).where(eq(servicePlansTable.id, fixture.planId));
      const target = before[1]!;

      const updated = expectStatus(await request(fixture.baseUrl, `/occurrences/${target.id}`, {
        method: "PATCH",
        headers: { "x-dev-user-id": fixture.managerUserId },
        body: { occurrenceDate: "2030-01-24" },
      }), 200) as { id: number; planId: number; jobId: number | null; occurrenceDate: string };
      expect(updated.id).toBe(target.id);
      expect(updated.planId).toBe(fixture.planId);
      expect(updated.jobId).toBe(target.jobId);
      expect(updated.occurrenceDate).toBe("2030-01-24");

      const after = (await listOccurrences(fixture.planId)).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
      const [planAfter] = await db.select().from(servicePlansTable).where(eq(servicePlansTable.id, fixture.planId));
      expect(after).toHaveLength(3);
      expect(new Set(after.map((occurrence) => occurrence.id)).size).toBe(3);
      expect(after.filter((occurrence) => occurrence.id !== target.id).map((occurrence) => occurrence.occurrenceDate))
        .toEqual(before.filter((occurrence) => occurrence.id !== target.id).map((occurrence) => occurrence.occurrenceDate));
      expect(planAfter?.nextOccurrence).toBe(planBefore?.nextOccurrence);
    } finally {
      await fixture.cleanup();
    }
  });

  it("applies changed series settings only to newly eligible future jobs", async () => {
    const fixture = await createFixture();
    try {
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: ownerHeaders,
        body: { count: 2 },
      }), 201);
      const historicalOccurrences = await listOccurrences(fixture.planId);
      const historicalJobIds = historicalOccurrences.flatMap((occurrence) => occurrence.jobId ?? []);
      const [historicalPlan] = await db.select().from(servicePlansTable).where(eq(servicePlansTable.id, fixture.planId));

      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}`, {
        method: "PATCH",
        headers: { "x-dev-user-id": fixture.managerUserId },
        body: {
          serviceType: `${token} updated future service`,
          frequency: "biweekly",
          nextOccurrence: "2030-02-05",
        },
      }), 200);
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: { "x-dev-user-id": fixture.managerUserId },
        body: { count: 2 },
      }), 201);

      const occurrences = await listOccurrences(fixture.planId);
      const allJobIds = occurrences.flatMap((occurrence) => occurrence.jobId ?? []);
      const jobs = await db.select().from(jobsTable).where(inArray(jobsTable.id, allJobIds));
      const historicalJobs = jobs.filter((job) => historicalJobIds.includes(job.id));
      const futureJobs = jobs.filter((job) => !historicalJobIds.includes(job.id));
      const [updatedPlan] = await db.select().from(servicePlansTable).where(eq(servicePlansTable.id, fixture.planId));

      expect(occurrences).toHaveLength(4);
      expect(historicalJobs).toHaveLength(2);
      expect(historicalJobs.every((job) => job.serviceType === historicalPlan?.serviceType)).toBe(true);
      expect(futureJobs).toHaveLength(2);
      expect(futureJobs.every((job) => job.serviceType === `${token} updated future service`)).toBe(true);
      expect(futureJobs.map((job) => job.scheduledDate).sort()).toEqual(["2030-02-05", "2030-02-19"]);
      expect(updatedPlan?.frequency).toBe("biweekly");
    } finally {
      await fixture.cleanup();
    }
  });

  it("pauses generation and resumes future generation without backfilling duplicates", async () => {
    const fixture = await createFixture();
    try {
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: ownerHeaders,
        body: { count: 1 },
      }), 201);
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/pause`, {
        method: "POST",
        headers: { "x-dev-user-id": fixture.managerUserId },
      }), 200);
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: { "x-dev-user-id": fixture.managerUserId },
        body: { count: 1 },
      }), 409);
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/resume`, {
        method: "POST",
        headers: { "x-dev-user-id": fixture.managerUserId },
      }), 200);
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: { "x-dev-user-id": fixture.managerUserId },
        body: { count: 1 },
      }), 201);

      const occurrences = await listOccurrences(fixture.planId);
      expect(occurrences).toHaveLength(2);
      expect(new Set(occurrences.map((occurrence) => occurrence.occurrenceDate)).size).toBe(2);
      expect(occurrences.map((occurrence) => occurrence.occurrenceDate).sort()).toEqual(["2030-01-15", "2030-01-22"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("skips only the selected occurrence without creating a replacement duplicate", async () => {
    const fixture = await createFixture();
    try {
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: ownerHeaders,
        body: { count: 2 },
      }), 201);
      const before = (await listOccurrences(fixture.planId)).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
      const target = before[0]!;

      expectStatus(await request(fixture.baseUrl, `/occurrences/${target.id}/skip`, {
        method: "POST",
        headers: { "x-dev-user-id": fixture.managerUserId },
        body: { reason: "Fixture skip" },
      }), 200);
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: ownerHeaders,
        body: { count: 1 },
      }), 201);

      const after = await listOccurrences(fixture.planId);
      const skipped = after.filter((occurrence) => occurrence.occurrenceDate === target.occurrenceDate);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.status).toBe("skipped");
      expect(skipped[0]?.skippedReason).toBe("Fixture skip");
      expect(after).toHaveLength(3);
      expect(new Set(after.map((occurrence) => occurrence.occurrenceDate)).size).toBe(3);
      expect(after.find((occurrence) => occurrence.id === before[1]?.id)?.status).toBe("scheduled");
    } finally {
      await fixture.cleanup();
    }
  });

  it("restricts administrative recurring controls to owners and managers", async () => {
    const fixture = await createFixture(true);
    try {
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: ownerHeaders,
        body: { count: 1 },
      }), 201);
      const [occurrence] = await listOccurrences(fixture.planId);
      const cleanerHeaders = { "x-dev-user-id": fixture.cleanerUserId! };

      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}`, {
        method: "PATCH",
        headers: cleanerHeaders,
        body: { serviceType: "Unauthorized change" },
      }), 403);
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/pause`, {
        method: "POST",
        headers: cleanerHeaders,
      }), 403);
      expectStatus(await request(fixture.baseUrl, `/service-plans/${fixture.planId}/generate`, {
        method: "POST",
        headers: cleanerHeaders,
        body: { count: 1 },
      }), 403);
      expectStatus(await request(fixture.baseUrl, `/occurrences/${occurrence!.id}`, {
        method: "PATCH",
        headers: cleanerHeaders,
        body: { occurrenceDate: "2030-01-24" },
      }), 403);
      expectStatus(await request(fixture.baseUrl, `/occurrences/${occurrence!.id}/skip`, {
        method: "POST",
        headers: cleanerHeaders,
        body: { reason: "Unauthorized skip" },
      }), 403);
    } finally {
      await fixture.cleanup();
    }
  });
});