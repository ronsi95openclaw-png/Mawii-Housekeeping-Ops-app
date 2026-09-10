import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
type FrequencyCase = {
  name: string;
  frequency: string;
  intervalWeeks?: number;
  start: string;
  expectedDates: string[];
};

const token = `recurring-generation-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerUserId = `${token}-manager`;

const cases: FrequencyCase[] = [
  {
    name: "weekly",
    frequency: "weekly",
    start: "2030-01-15",
    expectedDates: ["2030-01-15", "2030-01-22", "2030-01-29", "2030-02-05"],
  },
  {
    name: "biweekly",
    frequency: "biweekly",
    start: "2030-01-15",
    expectedDates: ["2030-01-15", "2030-01-29", "2030-02-12", "2030-02-26"],
  },
  {
    name: "monthly",
    frequency: "monthly",
    start: "2030-01-15",
    expectedDates: ["2030-01-15", "2030-02-15", "2030-03-15", "2030-04-15"],
  },
  {
    name: "every-N-week",
    frequency: "every_n_weeks",
    intervalWeeks: 3,
    start: "2030-01-15",
    expectedDates: ["2030-01-15", "2030-02-05", "2030-02-26", "2030-03-19"],
  },
];

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

describe("recurring-service generation", () => {
  it("requires authentication for generation", async () => {
    const { server, baseUrl } = await startServer();
    try {
      expectStatus(await request(baseUrl, "/service-plans/1/generate", {
        method: "POST",
        body: { count: 4 },
      }), 401);
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each(cases)(
    "lets an owner-created plan generate and deduplicate $name occurrences through a manager",
    async (frequencyCase) => {
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      let customerId: number | undefined;
      let addressId: number | undefined;
      let planId: number | undefined;
      let jobIds: number[] = [];
      let occurrenceIds: number[] = [];
      const activityBefore = new Set((await db.select({ id: activityEventsTable.id }).from(activityEventsTable)).map((row) => row.id));

      try {
        const manager = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} manager`,
            clerkUserId: managerUserId,
            role: "manager",
            phone: "+12145550301",
          },
        }), 201) as { id: number };
        managerId = manager.id;

        const customer = expectStatus(await request(baseUrl, "/customers", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} customer`,
            phone: "+12145550302",
          },
        }), 201) as { id: number };
        customerId = customer.id;

        const address = expectStatus(await request(baseUrl, `/customers/${customer.id}/addresses`, {
          method: "POST",
          headers: ownerHeaders,
          body: {
            line1: "300 Fixed Date Street",
            city: "Dallas",
            state: "TX",
            postalCode: "75001",
            accessNotes: "Business timezone regression fixture",
          },
        }), 201) as { id: number };
        addressId = address.id;

        const plan = expectStatus(await request(baseUrl, "/service-plans", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            customerId: customer.id,
            addressId: address.id,
            serviceType: `${token} ${frequencyCase.name}`,
            frequency: frequencyCase.frequency,
            intervalWeeks: frequencyCase.intervalWeeks,
            nextOccurrence: frequencyCase.start,
            preferences: { startTime: "09:00", endTime: "12:00" },
          },
        }), 201) as { id: number };
        planId = plan.id;

        const firstGeneration = expectStatus(await request(baseUrl, `/service-plans/${plan.id}/generate`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { count: frequencyCase.expectedDates.length },
        }), 201) as Array<{ id: number; planId: number; jobId: number | null; occurrenceDate: string }>;
        const secondGeneration = expectStatus(await request(baseUrl, `/service-plans/${plan.id}/generate`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { count: frequencyCase.expectedDates.length },
        }), 201) as Array<{ id: number; planId: number; jobId: number | null; occurrenceDate: string }>;

        expect(firstGeneration.map((occurrence) => occurrence.occurrenceDate)).toEqual(frequencyCase.expectedDates);
        expect(firstGeneration.every((occurrence) => occurrence.planId === plan.id && occurrence.jobId !== null)).toBe(true);
        expect(secondGeneration.every((occurrence) => occurrence.planId === plan.id && occurrence.jobId !== null)).toBe(true);

        const occurrences = await db.select().from(serviceOccurrencesTable).where(eq(serviceOccurrencesTable.planId, plan.id));
        const jobs = await db.select().from(jobsTable).where(inArray(jobsTable.id, occurrences.flatMap((occurrence) => occurrence.jobId ?? [])));
        const dates = occurrences.map((occurrence) => occurrence.occurrenceDate);
        const linkedJobIds = occurrences.map((occurrence) => occurrence.jobId);

        expect(occurrences).toHaveLength(frequencyCase.expectedDates.length * 2);
        expect(jobs).toHaveLength(occurrences.length);
        expect(new Set(dates).size).toBe(occurrences.length);
        expect(new Set(linkedJobIds).size).toBe(occurrences.length);
        expect(occurrences.every((occurrence) => occurrence.jobId !== null)).toBe(true);
        expect(jobs.every((job) => dates.includes(job.scheduledDate))).toBe(true);

        jobIds = jobs.map((job) => job.id);
        occurrenceIds = occurrences.map((occurrence) => occurrence.id);
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        const currentActivity = await db.select({ id: activityEventsTable.id }).from(activityEventsTable);
        const generatedActivityIds = currentActivity
          .map((row) => row.id)
          .filter((id) => !activityBefore.has(id));
        if (generatedActivityIds.length) {
          await db.delete(activityEventsTable).where(inArray(activityEventsTable.id, generatedActivityIds));
        }
        if (occurrenceIds.length) {
          await db.delete(serviceOccurrencesTable).where(inArray(serviceOccurrencesTable.id, occurrenceIds));
        } else if (planId) {
          await db.delete(serviceOccurrencesTable).where(eq(serviceOccurrencesTable.planId, planId));
        }
        if (jobIds.length) {
          await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
        }
        if (planId) {
          await db.delete(servicePlansTable).where(eq(servicePlansTable.id, planId));
        }
        if (addressId) {
          await db.delete(addressesTable).where(eq(addressesTable.id, addressId));
        }
        if (customerId) {
          await db.delete(customersTable).where(eq(customersTable.id, customerId));
        }
        if (managerId) {
          await db.delete(employeesTable).where(eq(employeesTable.id, managerId));
        }
      }
    },
    30_000,
  );
});