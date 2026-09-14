import { describe, expect, it, vi } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  activityEventsTable,
  db,
  employeeJobNotesTable,
  employeesTable,
  jobAssignmentsTable,
  jobsTable,
  proofPhotosTable,
  timeEntriesTable,
} from "@workspace/db";

const notificationTestState = vi.hoisted(() => ({ failJobCompletionNotifications: false }));

vi.mock("../lib/notifications", async () => {
  const actual = await vi.importActual<typeof import("../lib/notifications")>("../lib/notifications");
  return {
    ...actual,
    notifyEmployees: async (inputs: Parameters<typeof actual.notifyEmployees>[0]) => {
      if (notificationTestState.failJobCompletionNotifications && inputs.some((input) => input.kind === "job_completed")) {
        throw new Error("simulated completion notification failure");
      }
      return actual.notifyEmployees(inputs);
    },
  };
});

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `cleaner-job-workflow-${randomUUID()}`;
const ownerHeaders = { "x-dev-user-id": "dev-user" };
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

describe("cleaner assigned-job workflow", () => {
  it(
    "persists the assigned workflow, enforces job boundaries, and gates completion",
    async () => {
      const { server, baseUrl } = await startServer();
      let assignedCleanerId: number | undefined;
      let unrelatedCleanerId: number | undefined;
      let jobId: number | undefined;
      let assignmentId: number | undefined;
      let timeEntryId: number | undefined;
      let noteId: number | undefined;
      const photoIds: number[] = [];

      try {
        const assignedCleaner = expectStatus(await request(baseUrl, "/employees", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            name: `${token} assigned cleaner`,
            clerkUserId: assignedCleanerUserId,
            role: "cleaner",
            phone: "+12145550801",
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
            phone: "+12145550802",
          },
        }), 201) as { id: number };
        unrelatedCleanerId = unrelatedCleaner.id;

        const job = expectStatus(await request(baseUrl, "/jobs", {
          method: "POST",
          headers: ownerHeaders,
          body: {
            clientName: `${token} client`,
            address: "700 Workflow Street, Dallas, TX 75201",
            scheduledDate: "2031-01-15",
            startTime: "09:00",
            endTime: "12:00",
            serviceType: "Standard cleaning",
            serviceVariant: "Cleaner workflow regression",
            addOns: [],
            durationMinutes: 180,
            frequency: "One-time",
            notes: "Follow the client instructions and document any issue.",
            clientPhone: "+12145550803",
            teamMemberIds: [],
            employeeIds: [assignedCleaner.id],
          },
        }), 201) as { id: number };
        jobId = job.id;

        await db.update(jobsTable).set({
          accessInstructions: "Use the side gate; lockbox code is in the work order.",
        }).where(eq(jobsTable.id, job.id));

        const [assignment] = await db.select().from(jobAssignmentsTable).where(and(
          eq(jobAssignmentsTable.jobId, job.id),
          eq(jobAssignmentsTable.employeeId, assignedCleaner.id),
        ));
        expect(assignment).toBeDefined();
        assignmentId = assignment!.id;

        expectStatus(await request(baseUrl, `/jobs/${job.id}`, {
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/assignments/${assignment!.id}/accept`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/notes`, {
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/notes`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
          body: { body: "Unauthorized note" },
        }), 403);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/checklist`, {
          method: "PATCH",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
          body: { itemId: 1, completed: true },
        }), 403);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/photos`, {
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/photos`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
          body: { kind: "before", objectPath: "/objects/private/unauthorized-before.jpg" },
        }), 403);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/time/clock-in`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);
        expectStatus(await request(baseUrl, `/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);

        expectStatus(await request(baseUrl, `/assignments/${assignment!.id}/accept`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200);
        const [acceptedAssignment] = await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.id, assignment!.id));
        expect(acceptedAssignment?.status).toBe("accepted");

        const assignedJob = expectStatus(await request(baseUrl, `/jobs/${job.id}`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as {
          address: string;
          clientName: string;
          clientPhone: string | null;
          notes: string;
          accessInstructions?: string | null;
          checklist: Array<{ id: number; completed: boolean }>;
        };
        expect(assignedJob.address).toContain("700 Workflow Street");
        // The crew needs the name and address to do the work, but customer contact stays
        // with the desk — and hiding it in the interface alone would still send it here.
        expect(assignedJob.clientName).toBeTruthy();
        expect(assignedJob.clientPhone).toBeNull();
        expect(assignedJob.notes).toContain("client instructions");
        expect(assignedJob.accessInstructions).toBe("Use the side gate; lockbox code is in the work order.");
        expect(assignedJob.checklist.length).toBeGreaterThan(1);

        const createdNote = expectStatus(await request(baseUrl, `/jobs/${job.id}/notes`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { body: "Gate was secured and client request was reviewed." },
        }), 201) as { id: number };
        noteId = createdNote.id;
        const notes = expectStatus(await request(baseUrl, `/jobs/${job.id}/notes`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as Array<{ id: number; body: string }>;
        expect(notes).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: createdNote.id, body: "Gate was secured and client request was reviewed." }),
        ]));

        const firstChecklistItem = assignedJob.checklist[0]!;
        expectStatus(await request(baseUrl, `/jobs/${job.id}/checklist`, {
          method: "PATCH",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: { itemId: firstChecklistItem.id, completed: true },
        }), 200);
        const afterFirstChecklist = expectStatus(await request(baseUrl, `/jobs/${job.id}`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as { checklist: Array<{ id: number; completed: boolean }> };
        expect(afterFirstChecklist.checklist.find((item) => item.id === firstChecklistItem.id)?.completed).toBe(true);

        timeEntryId = (expectStatus(await request(baseUrl, `/jobs/${job.id}/time/clock-in`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 201) as { id: number }).id;
        expectStatus(await request(baseUrl, `/time-entries/${timeEntryId}/clock-out`, {
          method: "POST",
          headers: { "x-dev-user-id": unrelatedCleanerUserId },
        }), 403);

        expectStatus(await request(baseUrl, `/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 409);

        for (const item of assignedJob.checklist.slice(1)) {
          expectStatus(await request(baseUrl, `/jobs/${job.id}/checklist`, {
            method: "PATCH",
            headers: { "x-dev-user-id": assignedCleanerUserId },
            body: { itemId: item.id, completed: true },
          }), 200);
        }

        const beforePhoto = expectStatus(await request(baseUrl, `/jobs/${job.id}/photos`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: {
            kind: "before",
            objectPath: "/objects/uploads/00000000-0000-4000-8000-000000000001",
            contentType: "image/jpeg",
            byteSize: 1024,
          },
        }), 201) as { id: number };
        photoIds.push(beforePhoto.id);
        const [persistedBeforePhoto] = await db.select().from(proofPhotosTable).where(eq(proofPhotosTable.id, beforePhoto.id));
        expect(persistedBeforePhoto).toMatchObject({
          jobId: job.id,
          uploadedBy: assignedCleanerId,
          kind: "before",
        });
        expect(persistedBeforePhoto?.capturedAt).toBeInstanceOf(Date);
        const oneProof = expectStatus(await request(baseUrl, `/jobs/${job.id}/photos`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as Array<{ id: number; kind: string }>;
        expect(oneProof).toEqual(expect.arrayContaining([expect.objectContaining({ id: beforePhoto.id, kind: "before" })]));
        expectStatus(await request(baseUrl, `/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 409);

        const afterPhoto = expectStatus(await request(baseUrl, `/jobs/${job.id}/photos`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
          body: {
            kind: "after",
            objectPath: "/objects/uploads/00000000-0000-4000-8000-000000000002",
            contentType: "image/jpeg",
            byteSize: 1024,
          },
        }), 201) as { id: number };
        photoIds.push(afterPhoto.id);
        const bothProofs = expectStatus(await request(baseUrl, `/jobs/${job.id}/photos`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as Array<{ id: number; kind: string }>;
        expect(bothProofs).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: beforePhoto.id, kind: "before" }),
          expect.objectContaining({ id: afterPhoto.id, kind: "after" }),
        ]));

        expectStatus(await request(baseUrl, `/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 409);

        expectStatus(await request(baseUrl, `/time-entries/${timeEntryId}/clock-out`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200);
        notificationTestState.failJobCompletionNotifications = true;
        let completionResponse: Awaited<ReturnType<typeof request>>;
        try {
          completionResponse = await request(baseUrl, `/jobs/${job.id}/complete`, {
            method: "POST",
            headers: { "x-dev-user-id": assignedCleanerUserId },
          });
        } finally {
          notificationTestState.failJobCompletionNotifications = false;
        }
        const completed = expectStatus(completionResponse, 200) as { status: string };
        expect(completed.status).toBe("completed");
        const completedRead = expectStatus(await request(baseUrl, `/jobs/${job.id}`, {
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 200) as { status: string };
        expect(completedRead.status).toBe("completed");
        expectStatus(await request(baseUrl, `/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { "x-dev-user-id": assignedCleanerUserId },
        }), 409);
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (jobId) {
          await db.delete(employeeJobNotesTable).where(eq(employeeJobNotesTable.jobId, jobId));
          await db.delete(proofPhotosTable).where(eq(proofPhotosTable.jobId, jobId));
          await db.delete(timeEntriesTable).where(eq(timeEntriesTable.jobId, jobId));
          await db.delete(activityEventsTable).where(eq(activityEventsTable.jobId, jobId));
          await db.delete(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, jobId));
          await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
        }
        const employeeIds = [assignedCleanerId, unrelatedCleanerId].filter((value): value is number => value !== undefined);
        if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
        void assignmentId;
        void noteId;
        void photoIds;
      }
    },
    30_000,
  );
});