import { describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  activityEventsTable,
  db,
  employeesTable,
  incidentHistoryTable,
  incidentsTable,
  jobAssignmentsTable,
  jobsTable,
  proofPhotosTable,
} from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `incidents-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
const managerUserId = `${token}-manager`;
const assignedCleanerUserId = `${token}-assigned`;
const unrelatedCleanerUserId = `${token}-unrelated`;

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

describe("incident route authorization and review", () => {
  it(
    "persists severity and evidence and records only valid review transitions",
    async () => {
      const { server, baseUrl } = await startServer();
      let managerId: number | undefined;
      let assignedCleanerId: number | undefined;
      let unrelatedCleanerId: number | undefined;
      let ownerId: number | undefined;
      let jobId: number | undefined;
      const incidentIds: number[] = [];
      const proofPhotoIds: number[] = [];

      try {
        expectStatus(await request(baseUrl, "/jobs/1/incidents", {
          method: "POST",
          body: { severity: "high", description: "Unauthenticated incident" },
        }), 401);

        const manager = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} manager`,
            clerkUserId: managerUserId,
            role: "manager",
            phone: "+12145550701",
          },
        }), 201) as { id: number };
        managerId = manager.id;

        const assignedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} assigned cleaner`,
            clerkUserId: assignedCleanerUserId,
            role: "cleaner",
            phone: "+12145550702",
          },
        }), 201) as { id: number };
        assignedCleanerId = assignedCleaner.id;

        const unrelatedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} unrelated cleaner`,
            clerkUserId: unrelatedCleanerUserId,
            role: "cleaner",
            phone: "+12145550703",
          },
        }), 201) as { id: number };
        unrelatedCleanerId = unrelatedCleaner.id;

        const owner = (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, "dev-user")))[0];
        ownerId = owner?.id;

        const job = expectStatus(await request(baseUrl, "/jobs", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            clientName: `${token} job`,
            address: "700 Fixed Incident Street, Dallas, TX 75001",
            scheduledDate: "2030-01-20",
            startTime: "09:00",
            endTime: "11:00",
            serviceType: "Standard cleaning",
            serviceVariant: "Incident regression",
            addOns: [],
            durationMinutes: 120,
            frequency: "One-time",
            notes: "Disposable incident fixture",
            clientPhone: "+12145550704",
            teamMemberIds: [],
            employeeIds: [assignedCleaner.id],
          },
        }), 201) as { id: number };
        jobId = job.id;

        const [assignment] = await db.select().from(jobAssignmentsTable).where(and(
          eq(jobAssignmentsTable.jobId, job.id),
          eq(jobAssignmentsTable.employeeId, assignedCleaner.id),
        ));
        expect(assignment).toBeDefined();
        expectStatus(await request(baseUrl, `/assignments/${assignment!.id}/accept`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200);

        const validPhoto = expectStatus(await request(baseUrl, `/jobs/${job.id}/photos`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: {
            kind: "before",
            objectPath: "/objects/uploads/00000000-0000-4000-8000-000000000101",
            contentType: "image/jpeg",
            byteSize: 1024,
          },
        }), 201) as { id: number };
        proofPhotoIds.push(validPhoto.id);
        const wrongJobPhoto = (await db.insert(proofPhotosTable).values({
          jobId: job.id + 1,
          kind: "after",
          objectPath: "/objects/uploads/00000000-0000-4000-8000-000000000102",
          contentType: "image/jpeg",
          byteSize: 1024,
        }).returning())[0]!;
        proofPhotoIds.push(wrongJobPhoto.id);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/incidents`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: {
            severity: "high",
            description: "Missing evidence photo",
            evidencePhotoIds: [999999999],
          },
        }), 422);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/incidents`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: {
            severity: "high",
            description: "Evidence photo belongs to another job",
            evidencePhotoIds: [wrongJobPhoto.id],
          },
        }), 422);

        const severities = ["low", "medium", "high", "critical"] as const;
        for (const [index, severity] of severities.entries()) {
          const incident = expectStatus(await request(baseUrl, `/jobs/${job.id}/incidents`, {
            method: "POST",
            headers: { "x-dev-user-id": assignedCleanerUserId },
            body: {
              type: "safety",
              severity,
              description: `${token} ${severity} incident`,
              evidencePhotoIds: [validPhoto.id],
            },
          }), 201) as {
            id: number;
            severity: string;
            evidencePhotoIds: number[];
            status: string;
            history: Array<{ toStatus: string }>;
          };
          incidentIds.push(incident.id);
          expect(incident.severity).toBe(severity);
           expect(incident.evidencePhotoIds).toEqual([validPhoto.id]);
          expect(incident.status).toBe("open");
          expect(incident.history).toEqual([{ toStatus: "open" }]);

          const [persisted] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, incident.id));
          expect(persisted?.severity).toBe(severity);
           expect(persisted?.evidencePhotoIds).toEqual([validPhoto.id]);
        }

        expectStatus(await request(baseUrl, `/jobs/${job.id}/incidents`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
          body: {
            severity: "high",
            description: "Unrelated cleaner incident",
            evidencePhotoIds: [9999],
          },
        }), 403);
        expectStatus(await request(baseUrl, "/incidents", {
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/incidents/${incidentIds[0]}`, {
          method: "PATCH",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { status: "in_review" },
        }), 403);

        const firstIncidentId = incidentIds[0]!;
        expectStatus(await request(baseUrl, `/incidents/${firstIncidentId}`, {
          method: "PATCH",
          headers: { "x-dev-user-id": managerUserId },
          body: { status: "in_review", note: "Manager reviewed fixed incident" },
        }), 200);
        let [firstAfterReview] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, firstIncidentId));
        expect(firstAfterReview?.status).toBe("in_review");
        expect(firstAfterReview?.reviewedBy).toBe(managerId);
        let firstHistory = await db.select().from(incidentHistoryTable)
          .where(eq(incidentHistoryTable.incidentId, firstIncidentId));
        expect(firstHistory.at(-1)).toMatchObject({
          fromStatus: "open",
          toStatus: "in_review",
          note: "Manager reviewed fixed incident",
          actorClerkUserId: managerUserId,
        });

        expectStatus(await request(baseUrl, `/incidents/${firstIncidentId}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { status: "resolved", resolution: "Resolved by owner" },
        }), 200);
        [firstAfterReview] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, firstIncidentId));
        expect(firstAfterReview?.status).toBe("resolved");
        if (ownerId !== undefined) expect(firstAfterReview?.reviewedBy).toBe(ownerId);
        firstHistory = await db.select().from(incidentHistoryTable)
          .where(eq(incidentHistoryTable.incidentId, firstIncidentId));
        expect(firstHistory.at(-1)).toMatchObject({
          fromStatus: "in_review",
          toStatus: "resolved",
          actorClerkUserId: "dev-user",
        });

        const firstHistoryCount = firstHistory.length;
        expectStatus(await request(baseUrl, `/incidents/${firstIncidentId}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { status: "resolved", resolution: "Repeated resolution" },
        }), 409);
        expectStatus(await request(baseUrl, `/incidents/${firstIncidentId}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { status: "open", resolution: "Backward transition" },
        }), 409);
        [firstAfterReview] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, firstIncidentId));
        expect(firstAfterReview?.status).toBe("resolved");
        firstHistory = await db.select().from(incidentHistoryTable)
          .where(eq(incidentHistoryTable.incidentId, firstIncidentId));
        expect(firstHistory).toHaveLength(firstHistoryCount);

        const secondIncidentId = incidentIds[1]!;
        expectStatus(await request(baseUrl, `/incidents/${secondIncidentId}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { status: "resolved" },
        }), 409);
        const [secondBeforeInvalid] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, secondIncidentId));
        const secondHistoryBeforeInvalid = await db.select().from(incidentHistoryTable)
          .where(eq(incidentHistoryTable.incidentId, secondIncidentId));
        expect(secondBeforeInvalid?.status).toBe("open");
        expect(secondHistoryBeforeInvalid).toHaveLength(1);
        expectStatus(await request(baseUrl, `/incidents/${secondIncidentId}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { status: "closed" },
        }), 400);

        expectStatus(await request(baseUrl, `/incidents/${secondIncidentId}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { status: "in_review", note: "Owner started review" },
        }), 200);
        expectStatus(await request(baseUrl, `/incidents/${secondIncidentId}`, {
          method: "PATCH",
          headers: ownerHeaders,
          body: { status: "reclean", note: "Owner requested reclean" },
        }), 200);
        expectStatus(await request(baseUrl, `/incidents/${secondIncidentId}`, {
          method: "PATCH",
          headers: { "x-dev-user-id": managerUserId },
          body: { status: "resolved", resolution: "Manager confirmed reclean" },
        }), 200);
        const [secondAfterReview] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, secondIncidentId));
        expect(secondAfterReview?.status).toBe("resolved");
        expect(secondAfterReview?.reviewedBy).toBe(managerId);
        const secondHistory = await db.select().from(incidentHistoryTable)
          .where(eq(incidentHistoryTable.incidentId, secondIncidentId));
        expect(secondHistory.map((entry) => ({
          fromStatus: entry.fromStatus,
          toStatus: entry.toStatus,
          actorClerkUserId: entry.actorClerkUserId,
        }))).toEqual([
          { fromStatus: null, toStatus: "open", actorClerkUserId: assignedCleanerUserId },
          { fromStatus: "open", toStatus: "in_review", actorClerkUserId: "dev-user" },
          { fromStatus: "in_review", toStatus: "reclean", actorClerkUserId: "dev-user" },
          { fromStatus: "reclean", toStatus: "resolved", actorClerkUserId: managerUserId },
        ]);
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (incidentIds.length) {
          await db.delete(incidentHistoryTable).where(inArray(incidentHistoryTable.incidentId, incidentIds));
          await db.delete(incidentsTable).where(inArray(incidentsTable.id, incidentIds));
        } else if (jobId) {
          const fixtureIncidents = await db.select({ id: incidentsTable.id }).from(incidentsTable).where(eq(incidentsTable.jobId, jobId));
          if (fixtureIncidents.length) {
            const ids = fixtureIncidents.map((incident) => incident.id);
            await db.delete(incidentHistoryTable).where(inArray(incidentHistoryTable.incidentId, ids));
            await db.delete(incidentsTable).where(inArray(incidentsTable.id, ids));
          }
        }
        if (proofPhotoIds.length) await db.delete(proofPhotosTable).where(inArray(proofPhotosTable.id, proofPhotoIds));
        if (jobId) {
          await db.delete(activityEventsTable).where(eq(activityEventsTable.jobId, jobId));
          await db.delete(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, jobId));
          await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
        }
        const employeeIds = [managerId, assignedCleanerId, unrelatedCleanerId].filter((id): id is number => id !== undefined);
        if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
      }
    },
    30_000,
  );
});