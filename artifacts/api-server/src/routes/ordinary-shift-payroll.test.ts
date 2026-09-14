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

const token = `ordinary-shift-payroll-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose an address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api` };
}

async function request(baseUrl: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: Json } = {}) {
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

describe("ordinary shift payroll records", () => {
  it("creates a payout record when approving a period with a normal clocked entry", async () => {
    const { server, baseUrl } = await startServer();
    let employeeId: number | undefined;
    let rateId: number | undefined;
    let periodId: number | undefined;
    let entryId: number | undefined;

    try {
      const [employee] = await db.insert(employeesTable).values({
        clerkUserId: `${token}-cleaner`,
        name: `${token} cleaner`,
        role: "cleaner",
        phone: "+12145550198",
      }).returning();
      employeeId = employee!.id;

      const [rate] = await db.insert(workerRatesTable).values({
        employeeId: employee!.id,
        hourlyRate: "25.00",
        effectiveFrom: "2031-01-01",
      }).returning();
      rateId = rate!.id;

      const [entry] = await db.insert(timeEntriesTable).values({
        jobId: 999999,
        employeeId: employee!.id,
        clockIn: new Date("2031-01-15T14:00:00.000Z"),
        clockOut: new Date("2031-01-15T15:30:00.000Z"),
        correctionStatus: "none",
        correctionMinutes: 20,
      }).returning();
      entryId = entry!.id;

      const [period] = await db.insert(payPeriodsTable).values({
        startsOn: "2031-01-15",
        endsOn: "2031-01-15",
      }).returning();
      periodId = period!.id;

      const response = await request(baseUrl, `/pay-periods/${period!.id}/approve`, {
        method: "POST",
        headers: ownerHeaders,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);

      const [payout] = await db.select().from(payoutRecordsTable).where(and(
        eq(payoutRecordsTable.payPeriodId, period!.id),
        eq(payoutRecordsTable.employeeId, employee!.id),
      ));
      expect(payout).toBeDefined();
      expect(payout!.approvedMinutes).toBe(90);
      expect(Number(payout!.amount)).toBe(37.5);
      expect(payout!.hourlyRate).toBe("25.00");
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      if (periodId) await db.delete(payoutRecordsTable).where(eq(payoutRecordsTable.payPeriodId, periodId));
      if (periodId) await db.delete(payPeriodsTable).where(eq(payPeriodsTable.id, periodId));
      if (entryId) await db.delete(timeEntriesTable).where(eq(timeEntriesTable.id, entryId));
      if (rateId) await db.delete(workerRatesTable).where(eq(workerRatesTable.id, rateId));
      if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    }
  }, 30_000);

  it("uses each shift's effective rate and keeps approval retries stable", async () => {
    const { server, baseUrl } = await startServer();
    const employeeIds: number[] = [];
    const rateIds: number[] = [];
    const entryIds: number[] = [];
    let periodId: number | undefined;

    try {
      const [employee] = await db.insert(employeesTable).values({
        clerkUserId: `${token}-rate-change-cleaner`,
        name: `${token} rate change cleaner`,
        role: "cleaner",
        phone: "+12145550199",
      }).returning();
      employeeIds.push(employee!.id);

      const [oldRate] = await db.insert(workerRatesTable).values({
        employeeId: employee!.id,
        hourlyRate: "20.00",
        effectiveFrom: "2031-02-01",
        effectiveTo: "2031-02-14",
      }).returning();
      const [newRate] = await db.insert(workerRatesTable).values({
        employeeId: employee!.id,
        hourlyRate: "30.00",
        effectiveFrom: "2031-02-15",
      }).returning();
      rateIds.push(oldRate!.id, newRate!.id);

      const [beforeChange] = await db.insert(timeEntriesTable).values({
        jobId: 999991,
        employeeId: employee!.id,
        clockIn: new Date("2031-02-14T14:00:00.000Z"),
        clockOut: new Date("2031-02-14T14:30:00.000Z"),
        correctionStatus: "none",
      }).returning();
      const [onChange] = await db.insert(timeEntriesTable).values({
        jobId: 999992,
        employeeId: employee!.id,
        clockIn: new Date("2031-02-15T14:00:00.000Z"),
        clockOut: new Date("2031-02-15T14:30:00.000Z"),
        correctionStatus: "none",
      }).returning();
      entryIds.push(beforeChange!.id, onChange!.id);

      const [period] = await db.insert(payPeriodsTable).values({
        startsOn: "2031-02-14",
        endsOn: "2031-02-15",
      }).returning();
      periodId = period!.id;

      const firstApproval = await request(baseUrl, `/pay-periods/${period!.id}/approve`, {
        method: "POST",
        headers: ownerHeaders,
      });
      expect(firstApproval.status, JSON.stringify(firstApproval.body)).toBe(200);

      const [payout] = await db.select().from(payoutRecordsTable).where(and(
        eq(payoutRecordsTable.payPeriodId, period!.id),
        eq(payoutRecordsTable.employeeId, employee!.id),
      ));
      expect(payout).toMatchObject({
        approvedMinutes: 60,
        hourlyRate: "30.00",
        amount: "25.00",
      });
      const payoutSnapshot = { ...payout! };
      const periodSnapshot = (await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, period!.id)))[0]!;

      const retry = await request(baseUrl, `/pay-periods/${period!.id}/approve`, {
        method: "POST",
        headers: ownerHeaders,
      });
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      expect(retry.body).toMatchObject({
        id: periodSnapshot.id,
        status: "approved",
        approvedBy: periodSnapshot.approvedBy,
        approvedAt: periodSnapshot.approvedAt?.toISOString(),
      });

      const [payoutAfterRetry] = await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.id, payout!.id));
      expect(payoutAfterRetry).toEqual(payoutSnapshot);
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      if (periodId) await db.delete(payoutRecordsTable).where(eq(payoutRecordsTable.payPeriodId, periodId));
      if (periodId) await db.delete(payPeriodsTable).where(eq(payPeriodsTable.id, periodId));
      if (entryIds.length) await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, entryIds));
      if (rateIds.length) await db.delete(workerRatesTable).where(inArray(workerRatesTable.id, rateIds));
      if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
    }
  }, 30_000);

  it("rolls back approval status and earlier payout rows when payout creation fails", async () => {
    const { server, baseUrl } = await startServer();
    const employeeIds: number[] = [];
    const rateIds: number[] = [];
    const entryIds: number[] = [];
    let periodId: number | undefined;

    try {
      const [firstEmployee] = await db.insert(employeesTable).values({
        clerkUserId: `${token}-rollback-first`,
        name: `${token} rollback first`,
        role: "cleaner",
        phone: "+12145550200",
      }).returning();
      const [secondEmployee] = await db.insert(employeesTable).values({
        clerkUserId: `${token}-rollback-second`,
        name: `${token} rollback second`,
        role: "cleaner",
        phone: "+12145550201",
      }).returning();
      employeeIds.push(firstEmployee!.id, secondEmployee!.id);

      const [firstRate] = await db.insert(workerRatesTable).values({
        employeeId: firstEmployee!.id,
        hourlyRate: "20.00",
        effectiveFrom: "2031-03-01",
      }).returning();
      const [secondRate] = await db.insert(workerRatesTable).values({
        employeeId: secondEmployee!.id,
        hourlyRate: "20.00",
        effectiveFrom: "2031-03-01",
      }).returning();
      rateIds.push(firstRate!.id, secondRate!.id);

      const [firstEntry] = await db.insert(timeEntriesTable).values({
        jobId: 999993,
        employeeId: firstEmployee!.id,
        clockIn: new Date("2031-03-01T14:00:00.000Z"),
        clockOut: new Date("2031-03-01T14:30:00.000Z"),
        correctionStatus: "none",
      }).returning();
      const [secondEntry] = await db.insert(timeEntriesTable).values({
        jobId: 999994,
        employeeId: secondEmployee!.id,
        clockIn: new Date("2031-03-01T15:00:00.000Z"),
        clockOut: new Date("2031-03-01T15:30:00.000Z"),
        correctionStatus: "none",
      }).returning();
      entryIds.push(firstEntry!.id, secondEntry!.id);

      const [period] = await db.insert(payPeriodsTable).values({
        startsOn: "2031-03-01",
        endsOn: "2031-03-01",
      }).returning();
      periodId = period!.id;
      const [existingPayout] = await db.insert(payoutRecordsTable).values({
        payPeriodId: period!.id,
        employeeId: secondEmployee!.id,
        approvedMinutes: 30,
        hourlyRate: "99.00",
        amount: "99.00",
      }).returning();

      const response = await request(baseUrl, `/pay-periods/${period!.id}/approve`, {
        method: "POST",
        headers: ownerHeaders,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(500);

      const [afterFailure] = await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, period!.id));
      expect(afterFailure?.status).toBe("draft");
      const payouts = await db.select().from(payoutRecordsTable).where(eq(payoutRecordsTable.payPeriodId, period!.id));
      expect(payouts).toHaveLength(1);
      expect(payouts[0]).toEqual(existingPayout);
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      if (periodId) await db.delete(payoutRecordsTable).where(eq(payoutRecordsTable.payPeriodId, periodId));
      if (periodId) await db.delete(payPeriodsTable).where(eq(payPeriodsTable.id, periodId));
      if (entryIds.length) await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, entryIds));
      if (rateIds.length) await db.delete(workerRatesTable).where(inArray(workerRatesTable.id, rateIds));
      if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
    }
  }, 30_000);
});