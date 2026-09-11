import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
});