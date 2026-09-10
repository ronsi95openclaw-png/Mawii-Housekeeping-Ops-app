import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  db,
  employeesTable,
  payPeriodsTable,
  payoutRecordsTable,
  timeEntriesTable,
  workerRatesTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `payout-adjustments-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerUserId = `${token}-manager`;
const cleanerUserId = `${token}-cleaner`;
const secondCleanerUserId = `${token}-second-cleaner`;
const unrelatedWorkerUserId = `${token}-unrelated-worker`;

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

describe("payout adjustment and export routes", () => {
  it(
    "authorizes adjustments, preserves exact totals, and exports only the target period",
    async () => {
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      const employeeIds: number[] = [];
      const timeEntryIds: number[] = [];
      const workerRateIds: number[] = [];
      const payPeriodIds: number[] = [];

      try {
        expectStatus(await request(baseUrl, "/payouts?start=2020-03-01T00:00:00.000Z&end=2020-03-01T23:59:59.000Z"), 401);

        const manager = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} manager`,
            clerkUserId: managerUserId,
            role: "manager",
            phone: "+12145550901",
          },
        }), 201) as { id: number };
        managerId = manager.id;

        const createEmployee = async (name: string, clerkUserId: string) => {
          const employee = expectStatus(await request(baseUrl, "/employees", {
            method: "POST",
            headers: ownerHeaders,
            body: { name, clerkUserId, role: "cleaner", phone: "+12145550902" },
          }), 201) as { id: number };
          employeeIds.push(employee.id);
          return employee;
        };
        const workerA = await createEmployee(`${token} Target Worker A`, cleanerUserId);
        const workerB = await createEmployee(`${token} Target Worker B`, secondCleanerUserId);
        const unrelatedWorker = await createEmployee(`${token} Unrelated Worker`, unrelatedWorkerUserId);

        const insertEntry = async (employeeId: number, clockIn: string, clockOut: string) => {
          const [entry] = await db.insert(timeEntriesTable).values({
            jobId: 880101 + timeEntryIds.length,
            employeeId,
            clockIn: new Date(clockIn),
            clockOut: new Date(clockOut),
            correctionStatus: "approved",
          }).returning();
          timeEntryIds.push(entry!.id);
          return entry!;
        };
        await insertEntry(workerA.id, "2020-03-01T09:00:00.000Z", "2020-03-01T09:30:00.000Z");
        await insertEntry(workerB.id, "2020-03-01T10:00:00.000Z", "2020-03-01T10:30:00.000Z");
        await insertEntry(unrelatedWorker.id, "2020-04-01T09:00:00.000Z", "2020-04-01T09:30:00.000Z");

        const createRate = async (employeeId: number) => {
          const rate = expectStatus(await request(baseUrl, "/worker-rates", {
            method: "POST",
            headers: { "x-dev-user-id": managerUserId },
            body: { employeeId, hourlyRate: "20.00", effectiveFrom: "2020-01-01" },
          }), 201) as { id: number };
          workerRateIds.push(rate.id);
        };
        await createRate(workerA.id);
        await createRate(workerB.id);
        await createRate(unrelatedWorker.id);

        const targetPeriod = expectStatus(await request(baseUrl, "/pay-periods", {
          method: "POST",
          headers: ownerHeaders,
          body: { startsOn: "2020-03-01", endsOn: "2020-03-01" },
        }), 201) as { id: number };
        payPeriodIds.push(targetPeriod.id);
        const unrelatedPeriod = expectStatus(await request(baseUrl, "/pay-periods", {
          method: "POST",
          headers: ownerHeaders,
          body: { startsOn: "2020-04-01", endsOn: "2020-04-01" },
        }), 201) as { id: number };
        payPeriodIds.push(unrelatedPeriod.id);

        expectStatus(await request(baseUrl, `/pay-periods/${targetPeriod.id}/adjustments`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { employeeId: workerA.id, amount: "2.25", reason: "Too early" },
        }), 409);
        expectStatus(await request(baseUrl, `/pay-periods/${targetPeriod.id}/approve`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
        }), 200);
        expectStatus(await request(baseUrl, `/pay-periods/${unrelatedPeriod.id}/approve`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
        }), 200);
        const [unrelatedPayout] = await db.select().from(payoutRecordsTable).where(and(
          eq(payoutRecordsTable.payPeriodId, unrelatedPeriod.id),
          eq(payoutRecordsTable.employeeId, unrelatedWorker.id),
        ));
        expect(unrelatedPayout).toBeDefined();

        const [workerAPayout] = await db.select().from(payoutRecordsTable).where(and(
          eq(payoutRecordsTable.payPeriodId, targetPeriod.id),
          eq(payoutRecordsTable.employeeId, workerA.id),
        ));
        const [workerBPayout] = await db.select().from(payoutRecordsTable).where(and(
          eq(payoutRecordsTable.payPeriodId, targetPeriod.id),
          eq(payoutRecordsTable.employeeId, workerB.id),
        ));
        expect(workerAPayout).toBeDefined();
        expect(workerBPayout).toBeDefined();

        expectStatus(await request(baseUrl, `/pay-periods/${targetPeriod.id}/adjustments`, {
          method: "POST",
          headers: { "x-dev-user-id": cleanerUserId },
          body: { employeeId: workerA.id, amount: "2.25", reason: "Cleaner attempt" },
        }), 403);
        for (const reason of [undefined, "", "   "]) {
          expectStatus(await request(baseUrl, `/pay-periods/${targetPeriod.id}/adjustments`, {
            method: "POST",
            headers: { "x-dev-user-id": managerUserId },
            body: { employeeId: workerA.id, amount: "2.25", ...(reason === undefined ? {} : { reason }) },
          }), 400);
        }

        const positive = expectStatus(await request(baseUrl, `/pay-periods/${targetPeriod.id}/adjustments`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { employeeId: workerA.id, amount: "2.25", reason: "  Manager bonus  " },
        }), 200) as { adjustmentAmount: string; adjustmentReason: string; adjustmentActor: number; amount: string };
        expect(positive.adjustmentAmount).toBe("2.25");
        expect(positive.adjustmentReason).toBe("Manager bonus");
        expect(positive.adjustmentActor).toBe(manager.id);
        expect(Math.round(Number(positive.amount) * 100)).toBe(1225);

        const positiveSnapshot = (await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.id, workerAPayout!.id)))[0]!;
        expectStatus(await request(baseUrl, `/pay-periods/${targetPeriod.id}/adjustments`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { employeeId: workerA.id, amount: "1.00", reason: "Replay attempt" },
        }), 409);
        const positiveAfterReplay = (await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.id, workerAPayout!.id)))[0]!;
        expect(positiveAfterReplay).toMatchObject({
          adjustmentAmount: positiveSnapshot.adjustmentAmount,
          adjustmentReason: positiveSnapshot.adjustmentReason,
          adjustmentActor: positiveSnapshot.adjustmentActor,
          amount: positiveSnapshot.amount,
        });

        const negative = expectStatus(await request(baseUrl, `/pay-periods/${targetPeriod.id}/adjustments`, {
          method: "POST",
          headers: ownerHeaders,
          body: { employeeId: workerB.id, amount: "-1.50", reason: "  Owner correction  " },
        }), 200) as { adjustmentAmount: string; adjustmentReason: string; adjustmentActor: number; amount: string };
        expect(negative.adjustmentAmount).toBe("-1.50");
        expect(negative.adjustmentReason).toBe("Owner correction");
        if (negative.adjustmentActor !== null) expect(negative.adjustmentActor).not.toBe(manager.id);
        expect(Math.round(Number(negative.amount) * 100)).toBe(850);

        const payoutBeforePaid = (await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.id, workerAPayout!.id)))[0]!;
        expectStatus(await request(baseUrl, `/pay-periods/${targetPeriod.id}/paid`, {
          method: "POST",
          headers: ownerHeaders,
        }), 200);
        expectStatus(await request(baseUrl, `/pay-periods/${unrelatedPeriod.id}/paid`, {
          method: "POST",
          headers: ownerHeaders,
        }), 200);
        expectStatus(await request(baseUrl, `/pay-periods/${unrelatedPeriod.id}/adjustments`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { employeeId: unrelatedWorker.id, amount: "3.00", reason: "After paid" },
        }), 409);
        const unrelatedAfterPaidAttempt = (await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.id, unrelatedPayout!.id)))[0]!;
        expect(unrelatedAfterPaidAttempt).toMatchObject({
          adjustmentAmount: unrelatedPayout!.adjustmentAmount,
          adjustmentReason: unrelatedPayout!.adjustmentReason,
          adjustmentActor: unrelatedPayout!.adjustmentActor,
          amount: unrelatedPayout!.amount,
        });

        const csvResponse = await request(baseUrl, "/payouts?start=2020-03-01T00:00:00.000Z&end=2020-03-01T23:59:59.000Z&format=csv", {
          headers: ownerHeaders,
        });
        expectStatus(csvResponse, 200);
        const csv = (csvResponse.body as { raw: string }).raw;
        expect(csv).toContain("employee_id,employee,approved_minutes,approved_hours,hourly_rate,base_amount,adjustment_amount,adjustment_reason,final_amount");
        expect(csv).toContain(`${workerA.id},"`);
        expect(csv).toContain("Manager bonus");
        expect(csv).toContain("12.25");
        expect(csv).toContain("Owner correction");
        expect(csv).toContain("8.50");
        expect(csv).not.toContain(`${unrelatedWorker.id}`);
        expect(csv).not.toContain("Unrelated Worker");
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (payPeriodIds.length) await db.delete(payoutRecordsTable).where(inArray(payoutRecordsTable.payPeriodId, payPeriodIds));
        if (payPeriodIds.length) await db.delete(payPeriodsTable).where(inArray(payPeriodsTable.id, payPeriodIds));
        if (timeEntryIds.length) await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, timeEntryIds));
        if (workerRateIds.length) await db.delete(workerRatesTable).where(inArray(workerRatesTable.id, workerRateIds));
        const allEmployeeIds = [...employeeIds, managerId].filter((id): id is number => id !== undefined);
        if (allEmployeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, allEmployeeIds));
      }
    },
    30_000,
  );
});