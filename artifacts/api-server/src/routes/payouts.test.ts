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

const token = `payouts-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerUserId = `${token}-manager`;
const cleanerUserId = `${token}-cleaner`;

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

describe("payout route authorization and pay-period lifecycle", () => {
  it(
    "creates exact eligible payouts and protects period transitions",
    async () => {
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      let cleanerId: number | undefined;
      let ownerId: number | undefined;
      let payPeriodId: number | undefined;
      let timeEntryId: number | undefined;
      let workerRateId: number | undefined;

      try {
        expectStatus(await request(baseUrl, "/pay-periods"), 401);
        expectStatus(await request(baseUrl, "/payouts?start=2020-02-01T00:00:00.000Z&end=2020-02-02T00:00:00.000Z"), 401);
        expect(expectStatus(await request(baseUrl, "/payouts?start=not-a-date&end=2020-02-02T00:00:00.000Z", {
          headers: ownerHeaders,
        }), 400)).toEqual({ error: "start and end must be valid dates" });

        const manager = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} manager`,
            clerkUserId: managerUserId,
            role: "manager",
            phone: "+12145550801",
          },
        }), 201) as { id: number };
        managerId = manager.id;

        const cleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} cleaner`,
            clerkUserId: cleanerUserId,
            role: "cleaner",
            phone: "+12145550802",
          },
        }), 201) as { id: number };
        cleanerId = cleaner.id;

        ownerId = (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, "dev-user")))[0]?.id;

        const cleanerDeniedPaths: Array<{ path: string; method: string; body?: Json }> = [
          { path: "/pay-periods", method: "GET" },
          { path: "/payouts?start=2020-02-01T00:00:00.000Z&end=2020-02-02T00:00:00.000Z", method: "GET" },
          { path: "/pay-periods", method: "POST", body: { startsOn: "2020-02-01", endsOn: "2020-02-01" } },
        ];
        for (const denied of cleanerDeniedPaths) {
          expectStatus(await request(baseUrl, denied.path, {
            method: denied.method,
            headers: { "x-dev-user-id": cleanerUserId },
            body: denied.body,
          }), 403);
        }

        const fixedClockIn = new Date("2020-02-01T09:00:00.000Z");
        const fixedClockOut = new Date("2020-02-01T09:30:00.000Z");
        const [timeEntry] = await db.insert(timeEntriesTable).values({
          jobId: 880001,
          employeeId: cleaner.id,
          clockIn: fixedClockIn,
          clockOut: fixedClockOut,
          breaksMinutes: 0,
          correctionStatus: "approved",
        }).returning();
        timeEntryId = timeEntry!.id;

        const rate = expectStatus(await request(baseUrl, "/worker-rates", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            employeeId: cleaner.id,
            hourlyRate: "20.00",
            effectiveFrom: "2020-01-01",
          },
        }), 201) as { id: number; hourlyRate: string };
        workerRateId = rate.id;
        expect(rate.hourlyRate).toBe("20.00");

        const created = expectStatus(await request(baseUrl, "/pay-periods", {
          method: "POST",
          headers: ownerHeaders,
          body: { startsOn: "2020-02-01", endsOn: "2020-02-01" },
        }), 201) as { id: number; status: string };
        payPeriodId = created.id;
        expect(created.status).toBe("draft");

        expectStatus(await request(baseUrl, `/pay-periods/${created.id}/paid`, {
          method: "POST",
          headers: ownerHeaders,
        }), 409);
        const [stillDraft] = await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, created.id));
        expect(stillDraft?.status).toBe("draft");
        expect(await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.payPeriodId, created.id))).toHaveLength(0);

        const approved = expectStatus(await request(baseUrl, `/pay-periods/${created.id}/approve`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
        }), 200) as { id: number; status: string; approvedBy: number | null };
        expect(approved.status).toBe("approved");
        expect(approved.approvedBy).toBe(manager.id);

        const [payout] = await db.select().from(payoutRecordsTable).where(and(
          eq(payoutRecordsTable.payPeriodId, created.id),
          eq(payoutRecordsTable.employeeId, cleaner.id),
        ));
        expect(payout).toBeDefined();
        expect(payout!.approvedMinutes).toBe(30);
        expect(Math.round(Number(payout!.amount) * 100)).toBe(1000);
        expect(payout!.hourlyRate).toBe("20.00");

        const periodBeforeDuplicateApproval = (await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, created.id)))[0]!;
        const payoutBeforeDuplicateApproval = { ...payout! };
        const duplicateApproval = expectStatus(await request(baseUrl, `/pay-periods/${created.id}/approve`, {
          method: "POST",
          headers: ownerHeaders,
        }), 200) as { id: number; status: string; approvedBy: number | null; approvedAt: string };
        expect(duplicateApproval).toMatchObject({
          id: periodBeforeDuplicateApproval.id,
          status: "approved",
          approvedBy: periodBeforeDuplicateApproval.approvedBy,
          approvedAt: periodBeforeDuplicateApproval.approvedAt?.toISOString(),
        });
        const periodAfterDuplicateApproval = (await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, created.id)))[0]!;
        const payoutAfterDuplicateApproval = (await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.id, payout!.id)))[0]!;
        expect(periodAfterDuplicateApproval).toMatchObject({
          id: periodBeforeDuplicateApproval.id,
          status: periodBeforeDuplicateApproval.status,
          approvedBy: periodBeforeDuplicateApproval.approvedBy,
        });
        expect(payoutAfterDuplicateApproval).toMatchObject({
          id: payoutBeforeDuplicateApproval.id,
          approvedMinutes: payoutBeforeDuplicateApproval.approvedMinutes,
          amount: payoutBeforeDuplicateApproval.amount,
        });

        const paid = expectStatus(await request(baseUrl, `/pay-periods/${created.id}/paid`, {
          method: "POST",
          headers: ownerHeaders,
        }), 200) as { id: number; status: string; paidBy: number | null };
        expect(paid.status).toBe("paid");
        if (ownerId !== undefined) expect(paid.paidBy).toBe(ownerId);

        const paidSnapshot = (await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, created.id)))[0]!;
        expectStatus(await request(baseUrl, `/pay-periods/${created.id}/paid`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
        }), 409);
        expectStatus(await request(baseUrl, `/pay-periods/${created.id}/approve`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
        }), 409);
        const paidAfterInvalidTransitions = (await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, created.id)))[0]!;
        expect(paidAfterInvalidTransitions).toMatchObject({
          id: paidSnapshot.id,
          status: "paid",
          approvedBy: paidSnapshot.approvedBy,
          paidBy: paidSnapshot.paidBy,
        });
        const payoutsAfterInvalidTransitions = await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.payPeriodId, created.id));
        expect(payoutsAfterInvalidTransitions).toHaveLength(1);
        expect(payoutsAfterInvalidTransitions[0]).toMatchObject({
          id: payout!.id,
          approvedMinutes: 30,
          amount: payout!.amount,
        });
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (payPeriodId) await db.delete(payoutRecordsTable).where(eq(payoutRecordsTable.payPeriodId, payPeriodId));
        if (payPeriodId) await db.delete(payPeriodsTable).where(eq(payPeriodsTable.id, payPeriodId));
        if (timeEntryId) await db.delete(timeEntriesTable).where(eq(timeEntriesTable.id, timeEntryId));
        if (workerRateId) await db.delete(workerRatesTable).where(eq(workerRatesTable.id, workerRateId));
        const employeeIds = [managerId, cleanerId].filter((id): id is number => id !== undefined);
        if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
      }
    },
    30_000,
  );

  it(
    "uses the rate effective on each payout entry's clock-in date",
    async () => {
      const { server, baseUrl } = await startServer();
      let employeeId: number | undefined;
      const rateIds: number[] = [];
      const entryIds: number[] = [];

      try {
        const [employee] = await db.insert(employeesTable).values({
          clerkUserId: `${token}-rate-change-cleaner`,
          name: `${token} rate change cleaner`,
          role: "cleaner",
          phone: "+12145550803",
        }).returning();
        employeeId = employee!.id;

        const [oldRate] = await db.insert(workerRatesTable).values({
          employeeId: employee!.id,
          hourlyRate: "20.00",
          effectiveFrom: "2031-01-01",
          effectiveTo: "2031-01-14",
        }).returning();
        const [newRate] = await db.insert(workerRatesTable).values({
          employeeId: employee!.id,
          hourlyRate: "30.00",
          effectiveFrom: "2031-01-15",
        }).returning();
        rateIds.push(oldRate!.id, newRate!.id);

        const [beforeChange] = await db.insert(timeEntriesTable).values({
          jobId: 999997,
          employeeId: employee!.id,
          clockIn: new Date("2031-01-14T14:00:00.000Z"),
          clockOut: new Date("2031-01-14T15:00:00.000Z"),
          correctionStatus: "none",
        }).returning();
        const [onChange] = await db.insert(timeEntriesTable).values({
          jobId: 999998,
          employeeId: employee!.id,
          clockIn: new Date("2031-01-15T14:00:00.000Z"),
          clockOut: new Date("2031-01-15T15:00:00.000Z"),
          correctionStatus: "none",
        }).returning();
        entryIds.push(beforeChange!.id, onChange!.id);

        const response = await request(baseUrl, "/payouts?start=2031-01-14T00:00:00.000Z&end=2031-01-15T23:59:59.000Z", {
          headers: ownerHeaders,
        });
        const rows = expectStatus(response, 200) as Array<{
          id: number;
          hourlyRate: string;
          amount: number;
        }>;
        expect(rows).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: beforeChange!.id, hourlyRate: "20.00", amount: 20 }),
          expect.objectContaining({ id: onChange!.id, hourlyRate: "30.00", amount: 30 }),
        ]));
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (entryIds.length) await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, entryIds));
        if (rateIds.length) await db.delete(workerRatesTable).where(inArray(workerRatesTable.id, rateIds));
        if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
      }
    },
    30_000,
  );
});
