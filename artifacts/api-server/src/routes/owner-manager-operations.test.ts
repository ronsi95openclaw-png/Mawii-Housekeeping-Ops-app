import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, like, inArray } from "drizzle-orm";
import app from "../app";
import {
  activityEventsTable,
  addressesTable,
  customersTable,
  db,
  employeesTable,
  jobAssignmentsTable,
  jobsTable,
  workerRatesTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `owner-manager-operations-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerUserId = `${token}-manager`;
const cleanerUserId = `${token}-cleaner`;
const canonicalEmployeeUserId = `${token}-canonical`;

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

describe("owner and manager operations", () => {
  it(
    "preserves canonical identities, policy boundaries, and persisted operations",
    async () => {
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      let cleanerId: number | undefined;
      let canonicalEmployeeId: number | undefined;
      let customerId: number | undefined;
      let addressId: number | undefined;
      let jobId: number | undefined;

      try {
        for (const path of ["/employees", "/customers", "/jobs", "/worker-rates"]) {
          expectStatus(await request(baseUrl, path, { method: "POST", body: {} }), 401);
        }

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

        const cleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} cleaner`,
            clerkUserId: cleanerUserId,
            role: "cleaner",
            phone: "+12145550902",
          },
        }), 201) as { id: number };
        cleanerId = cleaner.id;

        for (const [path, body] of [
          ["/employees", { name: `${token} unauthorized`, clerkUserId: `${token}-unauthorized`, role: "cleaner" }],
          ["/customers", { name: `${token} unauthorized customer` }],
          ["/jobs", {}],
          ["/worker-rates", { employeeId: cleaner.id, hourlyRate: "21.00", effectiveFrom: "2031-01-01" }],
        ] as const) {
          expectStatus(await request(baseUrl, path, {
            method: "POST",
            headers: { "x-dev-user-id": cleanerUserId },
            body,
          }), 403);
        }
        expectStatus(await request(baseUrl, `/employees/${cleaner.id}`, {
          method: "PATCH",
          headers: { "x-dev-user-id": cleanerUserId },
          body: { name: `${token} unauthorized edit` },
        }), 403);

        expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { name: `${token} manager-created employee`, clerkUserId: `${token}-manager-created`, role: "cleaner" },
        }), 403);
        expectStatus(await request(baseUrl, `/employees/${cleaner.id}`, {
          method: "PATCH",
          headers: { "x-dev-user-id": managerUserId },
          body: { name: `${token} manager edit`, role: "manager" },
        }), 403);
        expectStatus(await request(baseUrl, "/worker-rates", {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { employeeId: cleaner.id, hourlyRate: "22.00", effectiveFrom: "2031-01-01" },
        }), 403);

        const canonicalEmployee = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} canonical cleaner`,
            clerkUserId: canonicalEmployeeUserId,
            role: "cleaner",
            phone: "+12145550903",
          },
        }), 201) as { id: number; clerkUserId: string; role: string };
        canonicalEmployeeId = canonicalEmployee.id;
        const rate = expectStatus(await request(baseUrl, "/worker-rates", {
          method: "POST",
          headers: ownerHeaders,
          body: { employeeId: canonicalEmployee.id, hourlyRate: "24.50", effectiveFrom: "2031-01-01" },
        }), 201) as { employeeId: number; hourlyRate: string; effectiveFrom: string };
        expect(rate).toMatchObject({ employeeId: canonicalEmployee.id, hourlyRate: "24.50", effectiveFrom: "2031-01-01" });

        const editedEmployee = expectStatus(await request(baseUrl, `/employees/${canonicalEmployee.id}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { name: `${token} canonical cleaner edited`, phone: "+12145550904" },
        }), 200) as { id: number; clerkUserId: string; name: string; phone: string; role: string };
        expect(editedEmployee).toMatchObject({
          id: canonicalEmployee.id,
          clerkUserId: canonicalEmployeeUserId,
          name: `${token} canonical cleaner edited`,
          phone: "+12145550904",
          role: "cleaner",
        });
        const [persistedEmployee] = await db.select().from(employeesTable).where(eq(employeesTable.id, canonicalEmployee.id));
        expect(persistedEmployee).toMatchObject({
          clerkUserId: canonicalEmployeeUserId,
          name: `${token} canonical cleaner edited`,
          phone: "+12145550904",
          role: "cleaner",
        });
        const [persistedRate] = await db.select().from(workerRatesTable).where(eq(workerRatesTable.employeeId, canonicalEmployee.id));
        expect(persistedRate).toMatchObject({ hourlyRate: "24.50", effectiveFrom: "2031-01-01" });

        const customer = expectStatus(await request(baseUrl, "/customers", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} customer`,
            phone: "+12145550905",
            email: "operations@example.test",
            notes: "Initial customer notes",
          },
        }), 201) as { id: number; name: string; phone: string; email: string; notes: string };
        customerId = customer.id;
        const address = expectStatus(await request(baseUrl, `/customers/${customer.id}/addresses`, {
          method: "POST",
          headers: ownerHeaders,
          body: {
            label: "Primary",
            line1: "800 Operations Avenue",
            line2: "Suite 10",
            city: "Dallas",
            state: "TX",
            postalCode: "75201",
            accessNotes: "Use the rear entrance.",
          },
        }), 201) as { id: number; customerId: number; line2: string; accessNotes: string };
        addressId = address.id;
        expect(address).toMatchObject({ customerId: customer.id, line2: "Suite 10", accessNotes: "Use the rear entrance." });

        const clearedCustomer = expectStatus(await request(baseUrl, `/customers/${customer.id}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { name: `${token} customer edited`, phone: null, email: null, notes: null },
        }), 200) as { id: number; name: string; phone: string | null; email: string | null; notes: string | null };
        expect(clearedCustomer).toMatchObject({
          id: customer.id,
          name: `${token} customer edited`,
          phone: null,
          email: null,
          notes: null,
        });
        const clearedAddress = expectStatus(await request(baseUrl, `/customers/${customer.id}/addresses/${address.id}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { line2: null, accessNotes: null },
        }), 200) as { id: number; customerId: number; line1: string; line2: string | null; accessNotes: string | null };
        expect(clearedAddress).toMatchObject({
          id: address.id,
          customerId: customer.id,
          line1: "800 Operations Avenue",
          line2: null,
          accessNotes: null,
        });
        const [persistedCustomer] = await db.select().from(customersTable).where(eq(customersTable.id, customer.id));
        const [persistedAddress] = await db.select().from(addressesTable).where(eq(addressesTable.id, address.id));
        expect(persistedCustomer).toMatchObject({ name: `${token} customer edited`, phone: null, email: null, notes: null });
        expect(persistedAddress).toMatchObject({ customerId: customer.id, line2: null, accessNotes: null });

        expectStatus(await request(baseUrl, "/customers/999999/addresses", {
          method: "POST",
          headers: ownerHeaders,
          body: { line1: "Invalid", city: "Dallas", state: "TX", postalCode: "75201" },
        }), 404);
        expect((await db.select().from(addressesTable).where(eq(addressesTable.line1, "Invalid"))).length).toBe(0);

        const job = expectStatus(await request(baseUrl, "/jobs", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            clientName: `${token} one-time job`,
            address: "800 Operations Avenue, Dallas, TX 75201",
            scheduledDate: "2031-02-14",
            startTime: "09:00",
            endTime: "12:00",
            serviceType: "Standard cleaning",
            serviceVariant: "Operations regression",
            addOns: ["Inside fridge"],
            durationMinutes: 180,
            frequency: "One-time",
            notes: "Follow the entry instructions and complete every required item.",
            clientPhone: "+12145550906",
            teamMemberIds: [],
            employeeIds: [],
          },
        }), 201) as { id: number; notes: string; checklist: Array<{ completed: boolean }>; photos: unknown[] };
        jobId = job.id;
        expect(job.notes).toContain("entry instructions");
        expect(job.checklist.length).toBeGreaterThan(0);
        expect(job.checklist.every((item) => item.completed === false)).toBe(true);
        expect(job.photos).toEqual([]);

        expectStatus(await request(baseUrl, `/jobs/${job.id}/assignments`, {
          method: "POST",
          headers: { "x-dev-user-id": managerUserId },
          body: { employeeId: canonicalEmployee.id },
        }), 201);
        const firstAssignmentCount = (await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, job.id))).length;
        expect(firstAssignmentCount).toBe(1);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/assignments`, {
          method: "POST",
          headers: ownerHeaders,
          body: { employeeId: canonicalEmployee.id },
        }), 201);
        expect((await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, job.id))).length).toBe(1);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/assignments`, {
          method: "POST",
          headers: ownerHeaders,
          body: { employeeId: canonicalEmployee.clerkUserId },
        }), 400);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/assignments`, {
          method: "POST",
          headers: ownerHeaders,
          body: { employeeId: manager.id },
        }), 422);
        const [canonicalAssignment] = await db.select().from(jobAssignmentsTable).where(and(
          eq(jobAssignmentsTable.jobId, job.id),
          eq(jobAssignmentsTable.employeeId, canonicalEmployee.id),
        ));
        expect(canonicalAssignment).toBeDefined();
        expect((await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, job.id))).length).toBe(1);

        // The crew picker sends employeeIds and nothing else, which once left the update
        // with no column to write and failed the entire request.
        expectStatus(await request(baseUrl, `/jobs/${job.id}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { employeeIds: [] },
        }), 200);
        expect((await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, job.id))).length).toBe(0);
        expectStatus(await request(baseUrl, `/jobs/${job.id}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { employeeIds: [canonicalEmployee.id] },
        }), 200);
        expect((await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, job.id))).length).toBe(1);

        expectStatus(await request(baseUrl, `/jobs/999999/assignments`, {
          method: "POST",
          headers: ownerHeaders,
          body: { employeeId: canonicalEmployee.id },
        }), 404);
        expect((await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, 999999))).length).toBe(0);

        const invalidJobName = `${token} invalid employee job`;
        expectStatus(await request(baseUrl, "/jobs", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            clientName: invalidJobName,
            address: "900 Invalid Reference Road, Dallas, TX 75201",
            scheduledDate: "2031-02-15",
            startTime: "09:00",
            endTime: "10:00",
            serviceType: "Standard cleaning",
            notes: "Must not persist.",
            teamMemberIds: [],
            employeeIds: [999999],
          },
        }), 422);
        expect((await db.select().from(jobsTable).where(eq(jobsTable.clientName, invalidJobName))).length).toBe(0);

        expectStatus(await request(baseUrl, `/customers/${customer.id}`, {
          method: "PATCH",
          headers: { "x-dev-user-id": managerUserId },
          body: { name: `${token} manager-edited customer` },
        }), 200);
        expectStatus(await request(baseUrl, `/customers/${customer.id}/addresses/${address.id}`, {
          method: "PATCH",
          headers: { "x-dev-user-id": managerUserId },
          body: { line1: "801 Manager Operations Avenue" },
        }), 200);
        expectStatus(await request(baseUrl, `/jobs/${job.id}`, {
          method: "PATCH",
          headers: { "x-dev-user-id": managerUserId },
          body: { notes: "Manager-confirmed entry instructions." },
        }), 200);
        const [managerCustomer] = await db.select().from(customersTable).where(eq(customersTable.id, customer.id));
        const [managerAddress] = await db.select().from(addressesTable).where(eq(addressesTable.id, address.id));
        const [managerJob] = await db.select().from(jobsTable).where(eq(jobsTable.id, job.id));
        expect(managerCustomer?.name).toBe(`${token} manager-edited customer`);
        expect(managerAddress?.line1).toBe("801 Manager Operations Avenue");
        expect(managerJob?.notes).toBe("Manager-confirmed entry instructions.");
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        const jobRows = await db.select({ id: jobsTable.id }).from(jobsTable).where(like(jobsTable.clientName, `${token}%`));
        const jobIds = jobRows.map((row) => row.id);
        if (jobIds.length) {
          await db.delete(jobAssignmentsTable).where(inArray(jobAssignmentsTable.jobId, jobIds));
          await db.delete(activityEventsTable).where(inArray(activityEventsTable.jobId, jobIds));
          await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
        }
        const customerRows = await db.select({ id: customersTable.id }).from(customersTable).where(like(customersTable.name, `${token}%`));
        const customerIds = customerRows.map((row) => row.id);
        if (customerIds.length) {
          await db.delete(addressesTable).where(inArray(addressesTable.customerId, customerIds));
          await db.delete(customersTable).where(inArray(customersTable.id, customerIds));
        }
        const employeeRows = await db.select({ id: employeesTable.id }).from(employeesTable).where(like(employeesTable.clerkUserId, `${token}%`));
        const employeeIds = employeeRows.map((row) => row.id);
        if (employeeIds.length) {
          await db.delete(workerRatesTable).where(inArray(workerRatesTable.employeeId, employeeIds));
          await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
        }
        void managerId;
        void cleanerId;
        void canonicalEmployeeId;
        void customerId;
        void addressId;
        void jobId;
      }
    },
    30_000,
  );
});