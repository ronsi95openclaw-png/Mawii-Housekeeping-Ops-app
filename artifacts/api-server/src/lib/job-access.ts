import { and, eq, inArray } from "drizzle-orm";
import { db, employeesTable, jobAssignmentsTable } from "@workspace/db";

export async function canCleanerAccessJob(req: { authContext?: { clerkUserId?: string; role?: string } }, jobId: number) {
  const role = (req.authContext?.role ?? "").toLowerCase();
  if (role === "owner" || role === "manager") return true;
  if (role !== "cleaner") return false;

  const clerkUserId = req.authContext?.clerkUserId;
  if (!clerkUserId) return false;
  const employee = (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, clerkUserId)))[0];
  if (!employee) return false;

  return (await db.select().from(jobAssignmentsTable).where(and(
    eq(jobAssignmentsTable.jobId, jobId),
    eq(jobAssignmentsTable.employeeId, employee.id),
    inArray(jobAssignmentsTable.status, ["assigned", "accepted"]),
  ))).length > 0;
}