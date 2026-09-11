import { Router, type IRouter } from "express";
import crypto, { createHash, randomBytes } from "node:crypto";
import { and, eq, ne, gte, lte, asc, desc, inArray, isNull } from "drizzle-orm";
import { db, customersTable, addressesTable, servicePlansTable, serviceOccurrencesTable, employeesTable, employeeBindingTokensTable, employeeJobNotesTable, jobAssignmentsTable, timeEntriesTable, proofPhotosTable, incidentsTable, incidentHistoryTable, workerRatesTable, payPeriodsTable, payoutRecordsTable, activityEventsTable, messagesTable, notificationsTable, jobsTable } from "@workspace/db";
import { requireActiveEmployee, requireAuth, requireRole } from "../middlewares/auth";
import { generateOccurrences } from "../lib/recurrence";
import { calculatePayableMinutes, calculatePayoutCents } from "../lib/time-entries";
import { formatPayoutAmountCents, parsePayoutAmountCents } from "../lib/payouts";
import { canCompleteJob, canTransitionIncident, canTransitionPayPeriod, isChronologicalTimeEntry, isValidBreakMinutes, isValidCorrectionMinutes } from "../lib/operations-rules";
import { canCleanerAccessJob } from "../lib/job-access";
import { employeeForClerkUser, notifyEmployees, notifyAssignedCleaners } from "../lib/notifications";
import { isProofPhotoContentType, isProofPhotoObjectPath, isProofPhotoSize } from "../lib/proof-photos";

const router: IRouter = Router();
router.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/integrations/elevate/jobs") {
    next();
    return;
  }
  if (req.method === "POST" && req.path === "/employees/claim") {
    requireAuth(req, res, next);
    return;
  }
  requireActiveEmployee(req, res, next);
});
const id = (value: string | string[]) => Number.parseInt(Array.isArray(value) ? value[0]! : value, 10);
const body = (req: any) => req.body ?? {};
const hashBindingToken = (token: string) => createHash("sha256").update(token).digest("hex");
function chicagoBoundary(date: string, endOfDay: boolean) {
  const [year, month, day] = date.split("-").map(Number);
  const rough = new Date(Date.UTC(year!, month! - 1, day!, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(rough);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const localAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  const boundary = new Date(rough.getTime() - (localAsUtc - rough.getTime()));
  if (endOfDay) boundary.setUTCMilliseconds(999);
  return boundary;
}
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !dateOnlyPattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}
function parseDateQuery(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
const event = async (type: string, title: string, detail?: string, jobId?: number) => {
  await db.insert(activityEventsTable).values({ type, title, detail, jobId });
};
async function currentEmployee(req: any) {
  return req.authContext ? (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, req.authContext.clerkUserId)))[0] : undefined;
}
async function canAccessJob(req: any, jobId: number) {
  if (["owner", "manager"].includes((req.authContext?.role ?? "").toLowerCase())) return true;
  const employee = await currentEmployee(req);
  if (!employee) return false;
  return (await db.select().from(jobAssignmentsTable).where(and(eq(jobAssignmentsTable.jobId, jobId), eq(jobAssignmentsTable.employeeId, employee.id), eq(jobAssignmentsTable.status, "accepted")))).length > 0;
}

router.get("/customers", requireRole("owner", "manager"), async (_req, res) => res.json(await db.select().from(customersTable).orderBy(asc(customersTable.name))));
router.post("/customers", requireRole("owner", "manager"), async (req, res) => {
  const input = body(req);
  if (!input.name) { res.status(400).json({ error: "name is required" }); return; }
  const [customer] = await db.insert(customersTable).values({ name: input.name, phone: input.phone, email: input.email, notes: input.notes }).returning();
  res.status(201).json(customer);
});
router.patch("/customers/:id", requireRole("owner", "manager"), async (req, res) => {
  const customerId = id(req.params.id);
  const [existing] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!existing) { res.status(404).json({ error: "Customer not found" }); return; }
  const input = body(req);
  if (Object.hasOwn(input, "name") && (typeof input.name !== "string" || !input.name.trim())) { res.status(400).json({ error: "name must be nonblank" }); return; }
  const updates: Record<string, unknown> = {};
  for (const field of ["name", "phone", "email", "notes"]) {
    if (Object.hasOwn(input, field)) updates[field] = input[field];
  }
  const [customer] = await db.update(customersTable).set(updates).where(eq(customersTable.id, customerId)).returning();
  res.json(customer);
});
router.get("/customers/:id/addresses", requireRole("owner", "manager"), async (req, res) => res.json(await db.select().from(addressesTable).where(eq(addressesTable.customerId, id(req.params.id)))));
router.post("/customers/:id/addresses", requireRole("owner", "manager"), async (req, res) => {
  const customerId = id(req.params.id);
  const [customer] = await db.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const input = body(req);
  if (!input.line1 || !input.city || !input.state || !input.postalCode) { res.status(400).json({ error: "address fields are required" }); return; }
  const [address] = await db.insert(addressesTable).values({ customerId, ...input }).returning();
  res.status(201).json(address);
});
router.patch("/customers/:customerId/addresses/:id", requireRole("owner", "manager"), async (req, res) => {
  const customerId = id(req.params.customerId);
  const addressId = id(req.params.id);
  const [existing] = await db.select().from(addressesTable).where(and(eq(addressesTable.id, addressId), eq(addressesTable.customerId, customerId)));
  if (!existing) { res.status(404).json({ error: "Address not found" }); return; }
  const input = body(req);
  const requiredFields = ["line1", "city", "state", "postalCode"] as const;
  if (requiredFields.some((field) => Object.hasOwn(input, field) && (typeof input[field] !== "string" || !input[field].trim()))) {
    res.status(400).json({ error: "address fields must be nonblank" });
    return;
  }
  const updates: Record<string, unknown> = {};
  for (const field of ["label", "line1", "line2", "city", "state", "postalCode", "accessNotes"]) {
    if (Object.hasOwn(input, field)) updates[field] = input[field];
  }
  const [address] = await db.update(addressesTable).set(updates).where(eq(addressesTable.id, addressId)).returning();
  res.json(address);
});

router.get("/service-plans", requireRole("owner", "manager"), async (_req, res) => res.json(await db.select().from(servicePlansTable)));
router.get("/service-plans/:id/occurrences", requireRole("owner", "manager"), async (req, res) => res.json(await db.select().from(serviceOccurrencesTable).where(eq(serviceOccurrencesTable.planId, id(req.params.id)))));
router.post("/service-plans", requireRole("owner", "manager"), async (req, res) => {
  const input = body(req);
  if (!input.customerId || !input.addressId || !input.nextOccurrence || !input.frequency) { res.status(400).json({ error: "customerId, addressId, nextOccurrence and frequency are required" }); return; }
  const [plan] = await db.insert(servicePlansTable).values(input).returning();
  res.status(201).json(plan);
});
router.patch("/service-plans/:id", requireRole("owner", "manager"), async (req, res) => {
  const [plan] = await db.update(servicePlansTable).set(body(req)).where(eq(servicePlansTable.id, id(req.params.id))).returning();
  if (!plan) { res.status(404).json({ error: "Service plan not found" }); return; } res.json(plan);
});
router.post("/service-plans/:id/pause", requireRole("owner", "manager"), async (req, res) => res.json((await db.update(servicePlansTable).set({ pausedAt: new Date() }).where(eq(servicePlansTable.id, id(req.params.id))).returning())[0]));
router.post("/service-plans/:id/resume", requireRole("owner", "manager"), async (req, res) => res.json((await db.update(servicePlansTable).set({ pausedAt: null }).where(eq(servicePlansTable.id, id(req.params.id))).returning())[0]));
router.post("/service-plans/:id/generate", requireRole("owner", "manager"), async (req, res) => {
  const plan = (await db.select().from(servicePlansTable).where(eq(servicePlansTable.id, id(req.params.id))))[0];
  if (!plan) { res.status(404).json({ error: "Service plan not found" }); return; }
  if (plan.pausedAt) { res.status(409).json({ error: "Service plan is paused" }); return; }
  const dates = generateOccurrences(plan.nextOccurrence, { frequency: plan.frequency as any, intervalWeeks: plan.intervalWeeks ?? undefined }, Number(body(req).count ?? 12));
  const customer = (await db.select().from(customersTable).where(eq(customersTable.id, plan.customerId)))[0];
  const address = (await db.select().from(addressesTable).where(eq(addressesTable.id, plan.addressId)))[0];
  if (!customer || !address) { res.status(422).json({ error: "Plan customer/address is missing" }); return; }
  const rows = [];
  for (const occurrenceDate of dates) {
    const existing = (await db.select().from(serviceOccurrencesTable).where(and(eq(serviceOccurrencesTable.planId, plan.id), eq(serviceOccurrencesTable.occurrenceDate, occurrenceDate))))[0];
    if (existing) { rows.push(existing); continue; }
    const [job] = await db.insert(jobsTable).values({
      clientName: customer.name,
      address: `${address.line1}, ${address.city}, ${address.state} ${address.postalCode}`,
      scheduledDate: occurrenceDate,
      startTime: String(plan.preferences.startTime ?? "09:00"),
      endTime: String(plan.preferences.endTime ?? "12:00"),
      serviceType: plan.serviceType,
      status: "scheduled",
      teamMemberIds: [],
      checklist: [],
      photos: [],
      accessInstructions: address.accessNotes,
    }).returning();
    const [occurrence] = await db.insert(serviceOccurrencesTable).values({ planId: plan.id, occurrenceDate, jobId: job.id }).returning();
    rows.push(occurrence);
  }
  const next = dates.at(-1);
  if (next) await db.update(servicePlansTable).set({ nextOccurrence: generateOccurrences(next, { frequency: plan.frequency as any, intervalWeeks: plan.intervalWeeks ?? undefined }, 2)[1]! }).where(eq(servicePlansTable.id, plan.id));
  await event("recurrence", "Service occurrences generated", `${rows.length} occurrence(s) generated`);
  res.status(201).json(rows);
});
router.post("/occurrences/:id/skip", requireRole("owner", "manager"), async (req, res) => res.json((await db.update(serviceOccurrencesTable).set({ status: "skipped", skippedReason: body(req).reason ?? "Skipped by operator" }).where(eq(serviceOccurrencesTable.id, id(req.params.id))).returning())[0]));
router.patch("/occurrences/:id", requireRole("owner", "manager"), async (req, res) => res.json((await db.update(serviceOccurrencesTable).set(body(req)).where(eq(serviceOccurrencesTable.id, id(req.params.id))).returning())[0]));

router.get("/employees/me", async (req, res) => {
  const employee = req.authContext ? (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, req.authContext.clerkUserId)))[0] : undefined;
  if (!employee || employee.active !== "true") { res.status(403).json({ error: "No active employee profile is linked to this Clerk user" }); return; } res.json(employee);
});
// Deactivated employees are hidden by default so assignment pickers stay clean, but the
// Team page asks for them explicitly — otherwise a revoked person is unreachable forever.
router.get("/employees", requireRole("owner", "manager"), async (req, res) => res.json(
  req.query.includeInactive === "true"
    ? await db.select().from(employeesTable).orderBy(asc(employeesTable.id))
    : await db.select().from(employeesTable).where(eq(employeesTable.active, "true")),
));
router.post("/employees", requireRole("owner"), async (req, res) => {
  const input = body(req);
  if (!input.name) { res.status(400).json({ error: "name is required" }); return; }
  const role = input.role ?? "cleaner";
  const isPendingCleaner = role === "cleaner" && (!input.clerkUserId || String(input.clerkUserId).startsWith("pending-"));
  const clerkUserId = isPendingCleaner ? `pending-${crypto.randomUUID()}` : input.clerkUserId;
  if (!clerkUserId) { res.status(400).json({ error: "clerkUserId is required for owners and managers" }); return; }
  const [employee] = await db.insert(employeesTable).values({ name: input.name, clerkUserId, role, phone: input.phone, active: input.active ?? "true" }).returning();
  let bindingToken: string | undefined;
  if (isPendingCleaner) {
    bindingToken = randomBytes(32).toString("hex");
    await db.insert(employeeBindingTokensTable).values({
      employeeId: employee.id,
      tokenHash: hashBindingToken(bindingToken),
      createdByClerkUserId: req.authContext!.clerkUserId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  }
  res.status(201).json({ ...employee, bindingToken });
});
router.post("/employees/claim", requireAuth, async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) { res.status(400).json({ error: "binding token is required" }); return; }
  const clerkUserId = req.authContext!.clerkUserId;
  if (await employeeForClerkUser(clerkUserId)) { res.status(409).json({ error: "This Clerk user is already linked to an employee" }); return; }
  const [binding] = await db.select().from(employeeBindingTokensTable).where(eq(employeeBindingTokensTable.tokenHash, hashBindingToken(token)));
  if (!binding || binding.claimedAt || binding.expiresAt <= new Date()) { res.status(400).json({ error: "Binding token is invalid or expired" }); return; }
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, binding.employeeId));
  if (!employee || employee.role !== "cleaner" || employee.active !== "true" || !employee.clerkUserId.startsWith("pending-")) {
    res.status(409).json({ error: "Employee is not eligible for binding" }); return;
  }
  const [claimed] = await db.update(employeesTable).set({ clerkUserId }).where(and(eq(employeesTable.id, employee.id), eq(employeesTable.clerkUserId, employee.clerkUserId))).returning();
  if (!claimed) { res.status(409).json({ error: "Employee was already claimed" }); return; }
  await db.update(employeeBindingTokensTable).set({ claimedAt: new Date() }).where(eq(employeeBindingTokensTable.id, binding.id));
  res.json(claimed);
});
router.patch("/employees/:id", requireRole("owner"), async (req, res) => {
  const [employee] = await db.update(employeesTable).set(body(req)).where(eq(employeesTable.id, id(req.params.id))).returning();
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; } res.json(employee);
});
router.get("/jobs/assigned", async (req, res) => {
  const employee = req.authContext ? (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, req.authContext.clerkUserId)))[0] : undefined;
  if (!employee) { res.status(403).json({ error: "No employee profile is linked to this Clerk user" }); return; }
  res.json(await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.employeeId, employee.id)));
});
router.post("/assignments/:id/:decision", async (req, res) => {
  const decision = req.params.decision;
  if (!["accept", "decline"].includes(decision)) { res.status(400).json({ error: "decision must be accept or decline" }); return; }
  const assignment = (await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.id, id(req.params.id))))[0];
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }
  const employee = await currentEmployee(req);
  if (!employee || (employee.id !== assignment.employeeId && !["owner", "manager"].includes((req.authContext?.role ?? "").toLowerCase()))) { res.status(403).json({ error: "Assignment is not yours" }); return; }
  const [updated] = await db.update(jobAssignmentsTable).set({ status: decision === "accept" ? "accepted" : "declined" }).where(eq(jobAssignmentsTable.id, assignment.id)).returning();
  await event("assignment", `Assignment ${decision}ed`, undefined, assignment.jobId);
  res.json(updated);
});

router.post("/jobs/:jobId/time/clock-in", async (req, res) => {
  const employee = req.authContext ? (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, req.authContext.clerkUserId)))[0] : undefined;
  if (!employee) { res.status(403).json({ error: "No employee profile is linked to this Clerk user" }); return; }
  if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; }
  if ((await db.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.jobId, id(req.params.jobId)), eq(timeEntriesTable.employeeId, employee.id), isNull(timeEntriesTable.clockOut)))).length) { res.status(409).json({ error: "An active time entry already exists" }); return; }
  const [entry] = await db.insert(timeEntriesTable).values({ jobId: id(req.params.jobId), employeeId: employee.id, clockIn: new Date() }).returning(); res.status(201).json(entry);
});
router.post("/time-entries/:id/clock-out", async (req, res) => { const entry = (await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id(req.params.id))))[0]; if (!entry) { res.status(404).json({ error: "Time entry not found" }); return; } if (!(await canAccessJob(req, entry.jobId))) { res.status(403).json({ error: "Time entry is not yours" }); return; } const clockOut = new Date(); if (!isChronologicalTimeEntry(entry.clockIn, clockOut)) { res.status(409).json({ error: "Clock-out must be after clock-in" }); return; } res.json((await db.update(timeEntriesTable).set({ clockOut }).where(eq(timeEntriesTable.id, entry.id)).returning())[0]); });
router.post("/time-entries/:id/break", async (req, res) => { const entry = (await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id(req.params.id))))[0]; if (!entry || !(await canAccessJob(req, entry.jobId))) { res.status(entry ? 403 : 404).json({ error: entry ? "Time entry is not yours" : "Time entry not found" }); return; } const minutes = Number(body(req).minutes ?? 0); if (!isValidBreakMinutes(entry.clockIn, entry.clockOut, minutes)) { res.status(409).json({ error: "Break minutes cannot exceed worked time" }); return; } res.json((await db.update(timeEntriesTable).set({ breaksMinutes: minutes }).where(eq(timeEntriesTable.id, entry.id)).returning())[0]); });
router.post("/time-entries/:id/correction", async (req, res) => { const entry = (await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id(req.params.id))))[0]; if (!entry || !(await canAccessJob(req, entry.jobId))) { res.status(entry ? 403 : 404).json({ error: entry ? "Time entry is not yours" : "Time entry not found" }); return; } const correctionMinutes = Number(body(req).minutes); if (!isValidCorrectionMinutes(entry.clockIn, entry.clockOut, entry.breaksMinutes, correctionMinutes)) { res.status(409).json({ error: "Correction would create an impossible time entry" }); return; } res.json((await db.update(timeEntriesTable).set({ correctionMinutes, correctionReason: body(req).reason, correctionStatus: "pending" }).where(eq(timeEntriesTable.id, entry.id)).returning())[0]); });
router.post("/time-entries/:id/approve", requireRole("owner", "manager"), async (req, res) => { const manager = await currentEmployee(req); const [updated] = await db.update(timeEntriesTable).set({ correctionStatus: "approved", approvedAt: new Date(), approvedBy: manager?.id ?? null }).where(and(eq(timeEntriesTable.id, id(req.params.id)), eq(timeEntriesTable.correctionStatus, "pending"))).returning(); if (!updated) { res.status(404).json({ error: "Pending time correction not found" }); return; } await event("time", "Time correction approved", undefined, updated.jobId); res.json(updated); });
router.post("/time-entries/:id/reject", requireRole("owner", "manager"), async (req, res) => { const reason = body(req).reason; if (typeof reason !== "string" || !reason.trim()) { res.status(400).json({ error: "reason is required" }); return; } const [updated] = await db.update(timeEntriesTable).set({ correctionStatus: "rejected", correctionReason: reason, approvedAt: new Date(), approvedBy: (await currentEmployee(req))?.id ?? null }).where(and(eq(timeEntriesTable.id, id(req.params.id)), eq(timeEntriesTable.correctionStatus, "pending"))).returning(); if (!updated) { res.status(404).json({ error: "Pending time correction not found" }); return; } await event("time", "Time correction rejected", reason, updated.jobId); res.json(updated); });
router.get("/time-entries/active", async (req, res) => { const employee = await currentEmployee(req); const jobId = Number(req.query.jobId); const rows = await db.select().from(timeEntriesTable).where(and(employee && !["owner", "manager"].includes((req.authContext?.role ?? "").toLowerCase()) ? eq(timeEntriesTable.employeeId, employee.id) : undefined, Number.isFinite(jobId) ? eq(timeEntriesTable.jobId, jobId) : undefined, isNull(timeEntriesTable.clockOut))); res.json(rows); });
router.get("/time-entries", async (req, res) => { const employee = await currentEmployee(req); const rows = await db.select().from(timeEntriesTable).where(and(req.query.status === "pending" ? eq(timeEntriesTable.correctionStatus, "pending") : undefined, employee && !["owner", "manager"].includes((req.authContext?.role ?? "").toLowerCase()) ? eq(timeEntriesTable.employeeId, employee.id) : undefined)); res.json(rows); });
router.get("/jobs/:jobId/notes", async (req, res) => { if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; } res.json(await db.select().from(employeeJobNotesTable).where(eq(employeeJobNotesTable.jobId, id(req.params.jobId))).orderBy(asc(employeeJobNotesTable.createdAt))); });
router.post("/jobs/:jobId/notes", async (req, res) => { if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; } const employee = await currentEmployee(req); if (!employee || !body(req).body) { res.status(400).json({ error: "body is required" }); return; } const [note] = await db.insert(employeeJobNotesTable).values({ jobId: id(req.params.jobId), employeeId: employee.id, body: body(req).body }).returning(); await event("note", "Employee job note added", undefined, note.jobId); res.status(201).json(note); });
router.post("/jobs/:jobId/complete", async (req, res) => {
  const jobId = id(req.params.jobId);
  if (!(await canAccessJob(req, jobId))) { res.status(403).json({ error: "Job is not assigned to you" }); return; }
  const job = (await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)))[0];
  const activeTimeEntries = await db.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.jobId, jobId), isNull(timeEntriesTable.clockOut)));
  const photos = await db.select().from(proofPhotosTable).where(eq(proofPhotosTable.jobId, jobId));
  const checklist = (job?.checklist ?? []) as { completed: boolean }[];
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status === "completed" || job.completedAt) { res.status(409).json({ error: "Job is already completed" }); return; }
  if (activeTimeEntries.length) { res.status(409).json({ error: "Clock-out is required before completion" }); return; }
   if (!canCompleteJob(checklist, photos)) { res.status(409).json({ error: "Checklist, before photo, and after photo are required" }); return; }
  const employee = await currentEmployee(req);
  const [completed] = await db.update(jobsTable).set({ status: "completed", completedAt: new Date(), completedByEmployeeId: employee?.id }).where(eq(jobsTable.id, jobId)).returning();
  await event("job", "Job completed", undefined, jobId);
  await notifyEmployees((await db.select({ id: employeesTable.id }).from(employeesTable).where(inArray(employeesTable.role, ["owner", "manager"]))).map(({ id: employeeId }) => ({
    employeeId,
    jobId,
    kind: "job_completed",
    title: "Job completed",
    body: `${job.clientName} was completed with checklist, proof, and clock-out recorded.`,
  })));
  res.json(completed);
});

router.post("/jobs/:jobId/photos", async (req, res) => {
  // Authorize before validating: an unauthorized caller learns nothing about the payload shape.
  if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; }
  const input = body(req);
  if (
    !isProofPhotoObjectPath(input.objectPath) ||
    !["before", "after"].includes(input.kind) ||
    !isProofPhotoContentType(input.contentType) ||
    !isProofPhotoSize(input.byteSize)
  ) { res.status(400).json({ error: "A valid uploaded proof photo, type, size, and kind(before|after) are required" }); return; }
  const [photo] = await db.insert(proofPhotosTable).values({ jobId: id(req.params.jobId), kind: input.kind, objectPath: input.objectPath, contentType: input.contentType, byteSize: input.byteSize }).returning(); res.status(201).json(photo);
});
router.get("/jobs/:jobId/photos", async (req, res) => { if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; } res.json((await db.select().from(proofPhotosTable).where(eq(proofPhotosTable.jobId, id(req.params.jobId)))).map(photo => ({ ...photo, readUrl: `/api/storage/objects${photo.objectPath.replace("/objects", "")}` }))); });
router.post("/jobs/:jobId/incidents", async (req, res) => { const jobId = id(req.params.jobId); if (!(await canAccessJob(req, jobId))) { res.status(403).json({ error: "Job is not assigned to you" }); return; } const employee = await currentEmployee(req); const input = body(req); if (!["low", "medium", "high", "critical"].includes(input.severity ?? "medium") || !input.description) { res.status(400).json({ error: "severity and description are required" }); return; } const [incident] = await db.insert(incidentsTable).values({ jobId, type: input.type ?? "qa", severity: input.severity ?? "medium", description: input.description, evidencePhotoIds: input.evidencePhotoIds ?? [], reporterEmployeeId: employee?.id }).returning(); await db.insert(incidentHistoryTable).values({ incidentId: incident.id, toStatus: "open", actorClerkUserId: req.authContext?.clerkUserId }); res.status(201).json({ ...incident, history: [{ toStatus: "open" }] }); });
router.patch("/incidents/:id", requireRole("owner", "manager"), async (req, res) => { const existing = (await db.select().from(incidentsTable).where(eq(incidentsTable.id, id(req.params.id))))[0]; if (!existing) { res.status(404).json({ error: "Incident not found" }); return; } const next = body(req).status; if (!["open", "in_review", "resolved", "reclean"].includes(next)) { res.status(400).json({ error: "Invalid incident status" }); return; } if (!canTransitionIncident(existing.status as "open" | "in_review" | "resolved" | "reclean", next)) { res.status(409).json({ error: `Cannot move incident from ${existing.status} to ${next}` }); return; } const reviewer = await currentEmployee(req); const [incident] = await db.update(incidentsTable).set({ status: next, resolution: body(req).resolution, reviewedBy: reviewer?.id ?? null, reviewedAt: new Date() }).where(eq(incidentsTable.id, existing.id)).returning(); await db.insert(incidentHistoryTable).values({ incidentId: existing.id, fromStatus: existing.status, toStatus: next, note: body(req).note, actorClerkUserId: req.authContext?.clerkUserId }); const history = await db.select().from(incidentHistoryTable).where(eq(incidentHistoryTable.incidentId, existing.id)); res.json({ ...incident, history }); });
router.get("/incidents", requireRole("owner", "manager"), async (req, res) => { const filter = typeof req.query.status === "string" ? eq(incidentsTable.status, req.query.status) : undefined; const incidents = await db.select().from(incidentsTable).where(filter); res.json(await Promise.all(incidents.map(async incident => ({ ...incident, history: await db.select().from(incidentHistoryTable).where(eq(incidentHistoryTable.incidentId, incident.id)) })))); });

router.post("/worker-rates", requireRole("owner"), async (req, res) => { const [rate] = await db.insert(workerRatesTable).values(body(req)).returning(); res.status(201).json(rate); });
router.get("/payouts", requireRole("owner", "manager"), async (req, res) => {
  const start = parseDateQuery(req.query.start);
  const end = parseDateQuery(req.query.end);
  if (!start || !end) { res.status(400).json({ error: "start and end must be valid dates" }); return; }
  // Ordinary shifts are payable as clocked; only an unresolved correction holds an entry back.
  const entries = await db.select().from(timeEntriesTable).where(and(gte(timeEntriesTable.clockIn, start), lte(timeEntriesTable.clockIn, end), ne(timeEntriesTable.correctionStatus, "pending")));
  const employees = await db.select().from(employeesTable);
  const rates = await db.select().from(workerRatesTable);
  const periods = await db.select().from(payPeriodsTable);
  const records = await db.select().from(payoutRecordsTable);
  const exportRows = entries.map(entry => {
    const minutes = calculatePayableMinutes(entry);
    const rate = rates.find(r => r.employeeId === entry.employeeId);
    const worker = employees.find(e => e.id === entry.employeeId);
    const period = periods.find(candidate => entry.clockIn >= new Date(`${candidate.startsOn}T00:00:00Z`) && entry.clockIn <= new Date(`${candidate.endsOn}T23:59:59Z`));
    const record = period ? records.find(candidate => candidate.payPeriodId === period.id && candidate.employeeId === entry.employeeId) : undefined;
    const baseCents = rate ? calculatePayoutCents(minutes, Number(rate.hourlyRate)) : null;
    const adjustmentCents = record ? (parsePayoutAmountCents(record.adjustmentAmount) ?? 0) : 0;
    const finalCents = baseCents === null ? null : baseCents + adjustmentCents;
    return { entry, worker, approvedMinutes: minutes, approvedHours: minutes / 60, hourlyRate: rate?.hourlyRate ?? null, baseCents, adjustmentCents, adjustmentReason: record?.adjustmentReason ?? "", finalCents };
  });
  const result = exportRows.map(row => ({ ...row.entry, employee: row.worker, approvedMinutes: row.approvedMinutes, approvedHours: row.approvedHours, hourlyRate: row.hourlyRate, amount: row.finalCents === null ? null : row.finalCents / 100 }));
  if (req.query.format === "csv") { res.type("text/csv").send(["employee_id,employee,approved_minutes,approved_hours,hourly_rate,base_amount,adjustment_amount,adjustment_reason,final_amount", ...exportRows.map(r => `${r.entry.employeeId},${JSON.stringify(r.worker?.name ?? "")},${r.approvedMinutes},${r.approvedHours},${r.hourlyRate ?? ""},${r.baseCents === null ? "" : formatPayoutAmountCents(r.baseCents)},${formatPayoutAmountCents(r.adjustmentCents)},${JSON.stringify(r.adjustmentReason)},${r.finalCents === null ? "" : formatPayoutAmountCents(r.finalCents)}`)].join("\n")); return; }
  res.json(result);
});
router.get("/activity/history", requireRole("owner", "manager"), async (_req, res) => res.json(await db.select().from(activityEventsTable).orderBy(asc(activityEventsTable.createdAt))));
router.get("/jobs/:jobId/messages", async (req, res) => {
  const jobId = id(req.params.jobId);
  if (!(await canCleanerAccessJob(req, jobId))) {
    res.status(403).json({ error: "Job is not assigned to this cleaner" });
    return;
  }
  res.json(await db.select().from(messagesTable).where(eq(messagesTable.jobId, jobId)).orderBy(asc(messagesTable.createdAt)));
});

router.post("/jobs/:jobId/messages", async (req, res): Promise<void> => {
  const jobId = id(req.params.jobId);
  const messageBody = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!messageBody) { res.status(400).json({ error: "body is required" }); return; }
  if (!(await canCleanerAccessJob(req, jobId))) { res.status(403).json({ error: "Job is not assigned to this cleaner" }); return; }
  const role = (req.authContext?.role ?? "").toLowerCase();
  const audience = req.body?.audience ?? "employee";
  if (audience !== "employee" && !["owner", "manager"].includes(role)) {
    res.status(403).json({ error: "Only owners and managers can queue customer messages" }); return;
  }
  const intent = {
    recipient: typeof req.body?.recipient === "string" ? req.body.recipient : "job",
    body: messageBody,
    channel: audience === "employee" ? "internal" : (req.body?.channel ?? "sms"),
    audience,
  };
  const [message] = await db.insert(messagesTable).values({
    jobId,
    recipient: intent.recipient,
    body: intent.body,
    channel: intent.channel,
    audience: intent.audience,
    recipientPhone: typeof req.body?.recipientPhone === "string" ? req.body.recipientPhone : null,
    recipientName: typeof req.body?.recipientName === "string" ? req.body.recipientName : null,
    status: "queued",
    provider: "internal",
    actorClerkUserId: req.authContext?.clerkUserId,
    metadata: typeof req.body?.metadata === "object" && req.body.metadata ? req.body.metadata : {},
  }).returning();
  if (audience === "employee") {
    await notifyAssignedCleaners(jobId, {
      kind: "message",
      title: "New job message",
      body: messageBody,
    });
  }
  await event("message", "Internal job message sent", messageBody, jobId);
  res.status(201).json(message);
});

router.get("/notifications", async (req, res): Promise<void> => {
  const employee = await currentEmployee(req);
  if (!employee) { res.status(403).json({ error: "No employee profile is linked to this Clerk user" }); return; }
  const limit = Math.min(Math.max(Number(req.query.limit ?? 30), 1), 100);
  const rows = await db.select().from(notificationsTable).where(eq(notificationsTable.employeeId, employee.id)).orderBy(desc(notificationsTable.createdAt)).limit(limit);
  res.json(rows);
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const employee = await currentEmployee(req);
  if (!employee) { res.status(403).json({ error: "No employee profile is linked to this Clerk user" }); return; }
  const [notification] = await db.update(notificationsTable).set({ readAt: new Date() }).where(and(eq(notificationsTable.id, id(req.params.id)), eq(notificationsTable.employeeId, employee.id))).returning();
  if (!notification) { res.status(404).json({ error: "Notification not found" }); return; }
  res.json(notification);
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const employee = await currentEmployee(req);
  if (!employee) { res.status(403).json({ error: "No employee profile is linked to this Clerk user" }); return; }
  await db.update(notificationsTable).set({ readAt: new Date() }).where(and(eq(notificationsTable.employeeId, employee.id), isNull(notificationsTable.readAt)));
  res.status(204).send();
});

router.post("/pay-periods", requireRole("owner", "manager"), async (req, res) => { const input = body(req); if (!input.startsOn || !input.endsOn) { res.status(400).json({ error: "startsOn and endsOn are required" }); return; } const [period] = await db.insert(payPeriodsTable).values({ startsOn: input.startsOn, endsOn: input.endsOn }).onConflictDoNothing().returning(); res.status(201).json(period); });
router.get("/pay-periods", requireRole("owner", "manager"), async (_req, res) => res.json(await db.select().from(payPeriodsTable).orderBy(asc(payPeriodsTable.startsOn))));
router.post("/pay-periods/:id/approve", requireRole("owner", "manager"), async (req, res) => { const manager = await currentEmployee(req); const periodId = id(req.params.id); const [period] = await db.update(payPeriodsTable).set({ status: "approved", approvedBy: manager?.id, approvedAt: new Date() }).where(and(eq(payPeriodsTable.id, periodId), eq(payPeriodsTable.status, "draft"))).returning(); if (!period) { res.status(409).json({ error: "Pay period is not draft or does not exist" }); return; } const entries = await db.select().from(timeEntriesTable).where(and(gte(timeEntriesTable.clockIn, new Date(`${period.startsOn}T00:00:00Z`)), lte(timeEntriesTable.clockIn, new Date(`${period.endsOn}T23:59:59Z`)), ne(timeEntriesTable.correctionStatus, "pending"))); const rates = await db.select().from(workerRatesTable); const totals = new Map<number, number>(); for (const entry of entries) { const minutes = calculatePayableMinutes(entry); totals.set(entry.employeeId, (totals.get(entry.employeeId) ?? 0) + minutes); } for (const [employeeId, minutes] of totals) { const rate = rates.find(item => item.employeeId === employeeId); if (rate) await db.insert(payoutRecordsTable).values({ payPeriodId: periodId, employeeId, approvedMinutes: minutes, hourlyRate: rate.hourlyRate, amount: String(minutes / 60 * Number(rate.hourlyRate)) }).onConflictDoNothing(); } res.json(period); });
router.post("/pay-periods/:id/paid", requireRole("owner", "manager"), async (req, res) => { const manager = await currentEmployee(req); const [existing] = await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, id(req.params.id))); if (!existing) { res.status(404).json({ error: "Pay period not found" }); return; } if (!canTransitionPayPeriod(existing.status as "draft" | "approved" | "paid", "paid")) { res.status(409).json({ error: "Pay period must be approved first" }); return; } const [period] = await db.update(payPeriodsTable).set({ status: "paid", paidBy: manager?.id, paidAt: new Date() }).where(and(eq(payPeriodsTable.id, existing.id), eq(payPeriodsTable.status, "approved"))).returning(); res.json(period); });
router.post("/pay-periods/:id/adjustments", requireRole("owner", "manager"), async (req, res) => { const input = body(req); const reason = typeof input.reason === "string" ? input.reason.trim() : ""; if (!reason) { res.status(400).json({ error: "reason is required" }); return; } const adjustmentCents = parsePayoutAmountCents(input.amount); if (adjustmentCents === null) { res.status(400).json({ error: "amount must be a valid currency amount" }); return; } const [period] = await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, id(req.params.id))); if (!period || period.status !== "approved") { res.status(409).json({ error: "Payout adjustments require an approved unpaid period" }); return; } const manager = await currentEmployee(req); const [existing] = await db.select().from(payoutRecordsTable).where(and(eq(payoutRecordsTable.payPeriodId, id(req.params.id)), eq(payoutRecordsTable.employeeId, Number(input.employeeId)))); if (!existing) { res.status(404).json({ error: "Payout record not found" }); return; } if (existing.adjustmentReason || parsePayoutAmountCents(existing.adjustmentAmount) !== 0) { res.status(409).json({ error: "Payout adjustment already exists" }); return; } const baseCents = parsePayoutAmountCents(existing.amount); if (baseCents === null) { res.status(409).json({ error: "Payout base amount is invalid" }); return; } const [record] = await db.update(payoutRecordsTable).set({ adjustmentAmount: formatPayoutAmountCents(adjustmentCents), adjustmentReason: reason, adjustmentActor: manager?.id, amount: formatPayoutAmountCents(baseCents + adjustmentCents) }).where(eq(payoutRecordsTable.id, existing.id)).returning(); res.json(record); });
router.get("/reports/owner", requireRole("owner", "manager"), async (req, res) => {
  const start = typeof req.query.start === "string" ? req.query.start : "";
  const end = typeof req.query.end === "string" ? req.query.end : "";
  if (!isValidDateOnly(start) || !isValidDateOnly(end)) { res.status(400).json({ error: "start and end must be valid dates in YYYY-MM-DD format" }); return; }
  const reportStart = chicagoBoundary(start, false);
  const reportEnd = chicagoBoundary(end, true);
  const jobs = await db.select().from(jobsTable).where(and(gte(jobsTable.scheduledDate, start), lte(jobsTable.scheduledDate, end)));
  const incidents = await db.select().from(incidentsTable).where(and(gte(incidentsTable.createdAt, reportStart), lte(incidentsTable.createdAt, reportEnd)));
  const plans = await db.select().from(servicePlansTable);
  const employees = await db.select().from(employeesTable);
  const entries = await db.select().from(timeEntriesTable).where(and(gte(timeEntriesTable.clockIn, reportStart), lte(timeEntriesTable.clockIn, reportEnd), ne(timeEntriesTable.correctionStatus, "pending")));
  const rates = await db.select().from(workerRatesTable);
  const periods = await db.select().from(payPeriodsTable);
  const payoutRecords = await db.select().from(payoutRecordsTable);
  const labor = new Map<number, { approvedMinutes: number; baseCents: number }>();
  for (const entry of entries) {
    const minutes = calculatePayableMinutes(entry);
    const rate = rates.find(item => item.employeeId === entry.employeeId);
    const current = labor.get(entry.employeeId) ?? { approvedMinutes: 0, baseCents: 0 };
    current.approvedMinutes += minutes;
    current.baseCents += rate ? calculatePayoutCents(minutes, Number(rate.hourlyRate)) : 0;
    labor.set(entry.employeeId, current);
  }
  const incidentSummary = incidents.reduce((out, item) => {
    const key = `${item.severity}:${item.status}`;
    out[key] = (out[key] ?? 0) + 1;
    return out;
  }, {} as Record<string, number>);
  const completedThisWeek = jobs.filter(j => j.status === "completed" && j.completedAt && j.completedAt >= reportStart && j.completedAt <= reportEnd).length;
  const payoutTotals = [...labor.entries()].reduce((out, [employeeId, item]) => {
    const period = periods.find(candidate => candidate.startsOn <= end && candidate.endsOn >= start);
    const record = period ? payoutRecords.find(candidate => candidate.payPeriodId === period.id && candidate.employeeId === employeeId) : undefined;
    const adjustmentCents = record ? (parsePayoutAmountCents(record.adjustmentAmount) ?? 0) : 0;
    out.approvedMinutes += item.approvedMinutes;
    out.baseCents += item.baseCents;
    out.adjustmentCents += adjustmentCents;
    out.finalCents += item.baseCents + adjustmentCents;
    return out;
  }, { approvedMinutes: 0, baseCents: 0, adjustmentCents: 0, finalCents: 0 });
  res.json({
    dateRange: { start, end },
    jobs: { volume: jobs.length, completed: completedThisWeek, completedThisWeek },
    employees: employees.filter(employee => labor.has(employee.id)).map(employee => ({ ...employee, approvedMinutes: labor.get(employee.id)!.approvedMinutes, approvedHours: labor.get(employee.id)!.approvedMinutes / 60, amount: labor.get(employee.id)!.baseCents / 100 })),
    payouts: { approvedMinutes: payoutTotals.approvedMinutes, approvedHours: payoutTotals.approvedMinutes / 60, baseAmount: payoutTotals.baseCents / 100, adjustmentAmount: payoutTotals.adjustmentCents / 100, finalAmount: payoutTotals.finalCents / 100, amount: payoutTotals.finalCents / 100 },
    recurringServices: plans.filter(p => p.nextOccurrence >= start && p.nextOccurrence <= end && !p.pausedAt).length,
    activeRecurringServices: plans.filter(p => p.nextOccurrence >= start && p.nextOccurrence <= end && !p.pausedAt).length,
    pausedRecurringServices: plans.filter(p => p.nextOccurrence >= start && p.nextOccurrence <= end && Boolean(p.pausedAt)).length,
    incidents: incidentSummary,
    customerHistoryCount: new Set(jobs.map(j => j.clientName)).size,
  });
});

export default router;
