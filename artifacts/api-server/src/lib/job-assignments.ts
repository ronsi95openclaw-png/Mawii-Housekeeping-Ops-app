import { eq, inArray } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";

export async function checkAssignmentEligibility(employeeIds: readonly number[]) {
  const requestedIds = [...new Set(employeeIds)];
  const employees = requestedIds.length
    ? await db
      .select({
        id: employeesTable.id,
        active: employeesTable.active,
        role: employeesTable.role,
      })
      .from(employeesTable)
      .where(inArray(employeesTable.id, requestedIds))
    : [];
  const foundIds = new Set(employees.map((employee) => employee.id));
  const missingEmployeeIds = requestedIds.filter((employeeId) => !foundIds.has(employeeId));
  const ineligibleEmployeeIds = employees
    .filter((employee) => employee.active !== "true" || employee.role !== "cleaner")
    .map((employee) => employee.id);

  return {
    requestedIds,
    employees,
    missingEmployeeIds,
    ineligibleEmployeeIds,
    valid: missingEmployeeIds.length === 0 && ineligibleEmployeeIds.length === 0,
  };
}