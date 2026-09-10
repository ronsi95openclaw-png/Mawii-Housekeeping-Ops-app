import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  db,
  employeesTable,
  incidentsTable,
  jobsTable,
  payPeriodsTable,
  payoutRecordsTable,
  servicePlansTable,
  timeEntriesTable,
  workerRatesTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `owner-reports-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerUserId = `${token}-manager`;
const cleanerUserId = `${token}-cleaner`;
const unrelatedWorkerUserId = `${token}-unrelated-worker`;
const reportStart = "2030-09-01";
const reportEnd = "2030-09-07";

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

describe("owner report route boundaries", () => {
  it(
    "reports only the fixed Central-time week and its intended operational metrics",
    async () => {
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      const employeeIds: number[] = [];
      const jobIds: number[] = [];
      const timeEntryIds: number[] = [];
      const workerRateIds: number[] = [];
      const incidentIds: number[] = [];
      const servicePlanIds: number[] = [];
      let payPeriodId: number | undefined;
      let payoutRecordId: number | undefined;

      try {
        expectStatus(await request(baseUrl, `/reports/owner?start=${reportStart}&end=${reportEnd}`), 401);

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

        const createEmployee = async (name: string, clerkUserId: string) => {
          const employee = expectStatus(await request(baseUrl, "/employees", {
            method: "POST",
            headers: ownerHeaders,
            body: { name, clerkUserId, role: "cleaner", phone: "+12145550602" },
          }), 201) as { id: number };
          employeeIds.push(employee.id);
          return employee;
        };
        const cleaner = await createEmployee(`${token} intended cleaner`, cleanerUserId);
        const unrelatedWorker = await createEmployee(`${token} unrelated worker`, unrelatedWorkerUserId);

        expectStatus(await request(baseUrl, `/reports/owner?start=${reportStart}&end=${reportEnd}`, {
          headers: { "x-dev-user-id": cleanerUserId },
        }), 403);

        const createJob = async (scheduledDate: string, status: string, completedAt: string | null, clientName: string) => {
          const [job] = await db.insert(jobsTable).values({
            clientName,
            address: `${token} address`,
            scheduledDate,
            startTime: "09:00",
            endTime: "10:00",
            status,
            serviceType: "Standard cleaning",
            serviceVariant: "Owner report regression",
            addOns: [],
            durationMinutes: 60,
            frequency: "One-time",
            notes: `${token} disposable report fixture`,
            teamMemberIds: [],
            checklist: [],
            photos: [],
            completedAt: completedAt ? new Date(completedAt) : null,
            completedByEmployeeId: completedAt ? cleaner.id : null,
          }).returning();
          jobIds.push(job!.id);
          return job!;
        };

        await createJob("2030-09-03", "completed", "2030-09-04T10:00:00-05:00", `${token} completed in week`);
        await createJob("2030-09-04", "scheduled", null, `${token} scheduled`);
        await createJob("2030-09-05", "cancelled", null, `${token} cancelled`);
        await createJob("2030-09-02", "completed", "2030-08-30T10:00:00-05:00", `${token} completed prior`);
        await createJob("2030-09-06", "completed", "2030-09-08T10:00:00-05:00", `${token} completed next`);
        await createJob("2030-08-31", "completed", "2030-09-01T10:00:00-05:00", `${token} prior scheduled`);
        await createJob("2030-09-08", "completed", "2030-09-07T10:00:00-05:00", `${token} next scheduled`);

        const [inRangeEntry] = await db.insert(timeEntriesTable).values({
          jobId: jobIds[0]!,
          employeeId: cleaner.id,
          clockIn: new Date("2030-09-04T11:00:00-05:00"),
          clockOut: new Date("2030-09-04T11:45:00-05:00"),
          breaksMinutes: 0,
          correctionStatus: "approved",
        }).returning();
        timeEntryIds.push(inRangeEntry!.id);
        const [outOfRangeEntry] = await db.insert(timeEntriesTable).values({
          jobId: jobIds[3]!,
          employeeId: cleaner.id,
          clockIn: new Date("2030-08-30T11:00:00-05:00"),
          clockOut: new Date("2030-08-30T13:00:00-05:00"),
          breaksMinutes: 0,
          correctionStatus: "approved",
        }).returning();
        timeEntryIds.push(outOfRangeEntry!.id);
        const [unrelatedEntry] = await db.insert(timeEntriesTable).values({
          jobId: jobIds[0]!,
          employeeId: unrelatedWorker.id,
          clockIn: new Date("2030-08-30T14:00:00-05:00"),
          clockOut: new Date("2030-08-30T15:00:00-05:00"),
          breaksMinutes: 0,
          correctionStatus: "approved",
        }).returning();
        timeEntryIds.push(unrelatedEntry!.id);

        const createRate = async (employeeId: number) => {
          const rate = expectStatus(await request(baseUrl, "/worker-rates", {
            method: "POST",
            headers: ownerHeaders,
            body: { employeeId, hourlyRate: "20.00", effectiveFrom: "2030-01-01" },
          }), 201) as { id: number };
          workerRateIds.push(rate.id);
        };
        await createRate(cleaner.id);
        await createRate(unrelatedWorker.id);

        const [period] = await db.insert(payPeriodsTable).values({
          startsOn: reportStart,
          endsOn: reportEnd,
          status: "approved",
          approvedBy: manager.id,
          approvedAt: new Date("2030-09-07T18:00:00-05:00"),
        }).returning();
        payPeriodId = period!.id;
        const [payout] = await db.insert(payoutRecordsTable).values({
          payPeriodId: period!.id,
          employeeId: cleaner.id,
          approvedMinutes: 45,
          hourlyRate: "20.00",
          amount: "17.25",
          adjustmentAmount: "2.25",
          adjustmentReason: `${token} report adjustment`,
          adjustmentActor: manager.id,
        }).returning();
        payoutRecordId = payout!.id;

        const createIncident = async (severity: string, status: string, createdAt: string) => {
          const [incident] = await db.insert(incidentsTable).values({
            jobId: jobIds[0]!,
            type: "quality",
            severity,
            description: `${token} ${severity} ${status}`,
            status,
            createdAt: new Date(createdAt),
          }).returning();
          incidentIds.push(incident!.id);
        };
        await createIncident("low", "open", "2030-09-01T00:15:00-05:00");
        await createIncident("high", "resolved", "2030-09-04T12:00:00-05:00");
        await createIncident("medium", "in_review", "2030-09-07T23:00:00-05:00");
        await createIncident("critical", "open", "2030-08-31T23:00:00-05:00");

        const createPlan = async (nextOccurrence: string, pausedAt: string | null) => {
          const [plan] = await db.insert(servicePlansTable).values({
            customerId: 900001 + servicePlanIds.length,
            addressId: 910001 + servicePlanIds.length,
            serviceType: "Standard cleaning",
            frequency: "weekly",
            nextOccurrence,
            pausedAt: pausedAt ? new Date(pausedAt) : null,
          }).returning();
          servicePlanIds.push(plan!.id);
        };
        await createPlan("2030-09-03", null);
        await createPlan("2030-09-04", "2030-09-01T00:00:00-05:00");
        await createPlan("2030-09-08", null);

        const ownerReport = expectStatus(await request(baseUrl, `/reports/owner?start=${reportStart}&end=${reportEnd}`, {
          headers: ownerHeaders,
        }), 200) as {
          jobs: { volume: number; completed: number; completedThisWeek: number };
          employees: Array<{ id: number; approvedMinutes: number; approvedHours: number; amount: number }>;
          payouts: { approvedMinutes: number; approvedHours: number; baseAmount: number; adjustmentAmount: number; finalAmount: number };
          recurringServices: number;
          activeRecurringServices: number;
          pausedRecurringServices: number;
          incidents: Record<string, number>;
          customerHistoryCount: number;
        };
        expect(ownerReport.jobs).toEqual({ volume: 5, completed: 1, completedThisWeek: 1 });
        expect(ownerReport.employees).toEqual([
          expect.objectContaining({ id: cleaner.id, approvedMinutes: 45, approvedHours: 0.75, amount: 15 }),
        ]);
        expect(ownerReport.payouts).toEqual({
          approvedMinutes: 45,
          approvedHours: 0.75,
          baseAmount: 15,
          adjustmentAmount: 2.25,
          finalAmount: 17.25,
          amount: 17.25,
        });
        expect(Math.round(ownerReport.payouts.baseAmount * 100)).toBe(1500);
        expect(Math.round(ownerReport.payouts.adjustmentAmount * 100)).toBe(225);
        expect(Math.round(ownerReport.payouts.finalAmount * 100)).toBe(1725);
        expect(ownerReport.incidents).toEqual({
          "low:open": 1,
          "high:resolved": 1,
          "medium:in_review": 1,
        });
        expect(ownerReport.recurringServices).toBe(1);
        expect(ownerReport.activeRecurringServices).toBe(1);
        expect(ownerReport.pausedRecurringServices).toBe(1);
        expect(ownerReport.customerHistoryCount).toBe(5);

        const managerReport = expectStatus(await request(baseUrl, `/reports/owner?start=${reportStart}&end=${reportEnd}`, {
          headers: { "x-dev-user-id": managerUserId },
        }), 200) as { jobs: { completedThisWeek: number } };
        expect(managerReport.jobs.completedThisWeek).toBe(1);
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (incidentIds.length) await db.delete(incidentsTable).where(inArray(incidentsTable.id, incidentIds));
        if (payoutRecordId) await db.delete(payoutRecordsTable).where(eq(payoutRecordsTable.id, payoutRecordId));
        if (payPeriodId) await db.delete(payPeriodsTable).where(eq(payPeriodsTable.id, payPeriodId));
        if (servicePlanIds.length) await db.delete(servicePlansTable).where(inArray(servicePlansTable.id, servicePlanIds));
        if (timeEntryIds.length) await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, timeEntryIds));
        if (workerRateIds.length) await db.delete(workerRatesTable).where(inArray(workerRatesTable.id, workerRateIds));
        if (jobIds.length) await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
        const allEmployeeIds = [...employeeIds, managerId].filter((id): id is number => id !== undefined);
        if (allEmployeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, allEmployeeIds));
      }
    },
    30_000,
  );
});