export type WorkerRole = "owner" | "manager" | "cleaner";

export function hasRole(role: string | null | undefined, allowed: readonly WorkerRole[]): boolean {
  return !!role && allowed.includes(role.toLowerCase() as WorkerRole);
}

export function canManageOperations(role?: string | null): boolean {
  return hasRole(role, ["owner", "manager"]);
}

export function canAccessAssignedJob(role: string | null | undefined, assignedEmployeeIds: readonly number[], employeeId: number): boolean {
  return canManageOperations(role) || (hasRole(role, ["cleaner"]) && assignedEmployeeIds.includes(employeeId));
}