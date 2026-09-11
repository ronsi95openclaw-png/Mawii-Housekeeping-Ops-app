import { and, eq, isNull } from "drizzle-orm";
import { db, employeesTable, notificationsTable, jobAssignmentsTable } from "@workspace/db";

export type NotificationInput = {
  employeeId: number;
  jobId?: number | null;
  kind: string;
  title: string;
  body: string;
};

export async function notifyEmployees(inputs: NotificationInput[]) {
  if (!inputs.length) return [];
  return db.insert(notificationsTable).values(inputs).returning();
}

export async function employeeForClerkUser(clerkUserId: string) {
  return (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, clerkUserId)))[0];
}

export async function notifyAssignedCleaners(
  jobId: number,
  notification: Omit<NotificationInput, "employeeId" | "jobId">,
) {
  const assignments = await db
    .select({ employeeId: jobAssignmentsTable.employeeId })
    .from(jobAssignmentsTable)
    .where(and(eq(jobAssignmentsTable.jobId, jobId), eq(jobAssignmentsTable.status, "accepted")));
  return notifyEmployees(assignments.map(({ employeeId }) => ({ ...notification, employeeId, jobId })));
}

export async function unreadNotificationsForEmployee(employeeId: number) {
  return db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.employeeId, employeeId), isNull(notificationsTable.readAt)));
}