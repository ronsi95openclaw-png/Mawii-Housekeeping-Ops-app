import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { and, eq, gte, lte, asc, isNull } from "drizzle-orm";
import { db, customersTable, addressesTable, servicePlansTable, serviceOccurrencesTable, employeesTable, employeeJobNotesTable, jobAssignmentsTable, timeEntriesTable, proofPhotosTable, incidentsTable, incidentHistoryTable, workerRatesTable, payPeriodsTable, payoutRecordsTable, activityEventsTable, messagesTable, jobsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { generateOccurrences } from "../lib/recurrence";
import { calculateWorkedMinutes } from "../lib/time-entries";
import { canCompleteJob, canTransitionIncident, canTransitionPayPeriod, isChronologicalTimeEntry, isValidBreakMinutes } from "../lib/operations-rules";
import { canCleanerAccessJob } from "../lib/job-access";

const router: IRouter = Router();
router.use(requireAuth);
const id = (value: string | string[]) => Number.parseInt(Array.isArray(value) ? value[0]! : value, 10);
const body = (req: any) => req.body ?? {};
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
router.get("/customers/:id/addresses", requireRole("owner", "manager"), async (req, res) => res.json(await db.select().from(addressesTable).where(eq(addressesTable.customerId, id(req.params.id)))));
router.post("/customers/:id/addresses", requireRole("owner", "manager"), async (req, res) => {
  const input = body(req);
  if (!input.line1 || !input.city || !input.state || !input.postalCode) { res.status(400).json({ error: "address fields are required" }); return; }
  const [address] = await db.insert(addressesTable).values({ customerId: id(req.params.id), ...input }).returning();
  res.status(201).json(address);
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
  if (!employee) { res.status(403).json({ error: "No employee profile is linked to this Clerk user" }); return; } res.json(employee);
});
router.get("/employees", requireRole("owner", "manager"), async (_req, res) => res.json(await db.select().from(employeesTable).where(eq(employeesTable.active, "true"))));
router.post("/employees", requireRole("owner", "manager"), async (req, res) => {
  const input = body(req);
  if (!input.name) { res.status(400).json({ error: "name is required" }); return; }
  const [employee] = await db.insert(employeesTable).values({ name: input.name, clerkUserId: input.clerkUserId ?? `pending-${crypto.randomUUID()}`, role: input.role ?? "cleaner", phone: input.phone, active: input.active ?? "true" }).returning();
  res.status(201).json(employee);
});
router.patch("/employees/:id", requireRole("owner", "manager"), async (req, res) => {
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
router.post("/time-entries/:id/correction", async (req, res) => { const entry = (await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id(req.params.id))))[0]; if (!entry || !(await canAccessJob(req, entry.jobId))) { res.status(entry ? 403 : 404).json({ error: entry ? "Time entry is not yours" : "Time entry not found" }); return; } res.json((await db.update(timeEntriesTable).set({ correctionMinutes: Number(body(req).minutes), correctionReason: body(req).reason, correctionStatus: "pending" }).where(eq(timeEntriesTable.id, entry.id)).returning())[0]); });
router.post("/time-entries/:id/approve", requireRole("owner", "manager"), async (req, res) => { const manager = await currentEmployee(req); const [updated] = await db.update(timeEntriesTable).set({ correctionStatus: "approved", approvedAt: new Date(), approvedBy: manager?.id ?? null }).where(and(eq(timeEntriesTable.id, id(req.params.id)), eq(timeEntriesTable.correctionStatus, "pending"))).returning(); if (!updated) { res.status(404).json({ error: "Pending time correction not found" }); return; } await event("time", "Time correction approved", undefined, updated.jobId); res.json(updated); });
router.post("/time-entries/:id/reject", requireRole("owner", "manager"), async (req, res) => { const reason = body(req).reason; if (!reason) { res.status(400).json({ error: "reason is required" }); return; } const [updated] = await db.update(timeEntriesTable).set({ correctionStatus: "rejected", correctionReason: reason, approvedAt: new Date(), approvedBy: (await currentEmployee(req))?.id ?? null }).where(and(eq(timeEntriesTable.id, id(req.params.id)), eq(timeEntriesTable.correctionStatus, "pending"))).returning(); if (!updated) { res.status(404).json({ error: "Pending time correction not found" }); return; } await event("time", "Time correction rejected", reason, updated.jobId); res.json(updated); });
router.get("/time-entries/active", async (req, res) => { const employee = await currentEmployee(req); const jobId = Number(req.query.jobId); const rows = await db.select().from(timeEntriesTable).where(and(employee && !["owner", "manager"].includes((req.authContext?.role ?? "").toLowerCase()) ? eq(timeEntriesTable.employeeId, employee.id) : undefined, Number.isFinite(jobId) ? eq(timeEntriesTable.jobId, jobId) : undefined, isNull(timeEntriesTable.clockOut))); res.json(rows); });
router.get("/time-entries", async (req, res) => { const employee = await currentEmployee(req); const rows = await db.select().from(timeEntriesTable).where(and(req.query.status === "pending" ? eq(timeEntriesTable.correctionStatus, "pending") : undefined, employee && !["owner", "manager"].includes((req.authContext?.role ?? "").toLowerCase()) ? eq(timeEntriesTable.employeeId, employee.id) : undefined)); res.json(rows); });
router.post("/jobs/:jobId/notes", async (req, res) => { if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; } const employee = await currentEmployee(req); if (!employee || !body(req).body) { res.status(400).json({ error: "body is required" }); return; } const [note] = await db.insert(employeeJobNotesTable).values({ jobId: id(req.params.jobId), employeeId: employee.id, body: body(req).body }).returning(); await event("note", "Employee job note added", undefined, note.jobId); res.status(201).json(note); });
router.post("/jobs/:jobId/complete", async (req, res) => {
  const jobId = id(req.params.jobId);
  if (!(await canAccessJob(req, jobId))) { res.status(403).json({ error: "Job is not assigned to you" }); return; }
  const job = (await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)))[0];
  const photos = await db.select().from(proofPhotosTable).where(eq(proofPhotosTable.jobId, jobId));
  const checklist = (job?.checklist ?? []) as { completed: boolean }[];
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
   if (!canCompleteJob(checklist, photos)) { res.status(409).json({ error: "Checklist, before photo, and after photo are required" }); return; }
  const employee = await currentEmployee(req);
  const [completed] = await db.update(jobsTable).set({ status: "completed", completedAt: new Date(), completedByEmployeeId: employee?.id }).where(eq(jobsTable.id, jobId)).returning();
  await event("job", "Job completed", undefined, jobId);
  res.json(completed);
});

router.post("/jobs/:jobId/photos", async (req, res) => {
  const input = body(req);
  if (!input.objectPath || !["before", "after"].includes(input.kind)) { res.status(400).json({ error: "objectPath and kind(before|after) are required" }); return; }
  if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; }
  const [photo] = await db.insert(proofPhotosTable).values({ jobId: id(req.params.jobId), kind: input.kind, objectPath: input.objectPath, contentType: input.contentType ?? "image/jpeg", byteSize: input.byteSize }).returning(); res.status(201).json(photo);
});
router.get("/jobs/:jobId/photos", async (req, res) => { if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; } res.json((await db.select().from(proofPhotosTable).where(eq(proofPhotosTable.jobId, id(req.params.jobId)))).map(photo => ({ ...photo, readUrl: `/api/storage/objects${photo.objectPath.replace("/objects", "")}` }))); });
router.post("/jobs/:jobId/incidents", async (req, res) => { const jobId = id(req.params.jobId); if (!(await canAccessJob(req, jobId))) { res.status(403).json({ error: "Job is not assigned to you" }); return; } const employee = await currentEmployee(req); const input = body(req); if (!["low", "medium", "high", "critical"].includes(input.severity ?? "medium") || !input.description) { res.status(400).json({ error: "severity and description are required" }); return; } const [incident] = await db.insert(incidentsTable).values({ jobId, type: input.type ?? "qa", severity: input.severity ?? "medium", description: input.description, evidencePhotoIds: input.evidencePhotoIds ?? [], reporterEmployeeId: employee?.id }).returning(); await db.insert(incidentHistoryTable).values({ incidentId: incident.id, toStatus: "open", actorClerkUserId: req.authContext?.clerkUserId }); res.status(201).json({ ...incident, history: [{ toStatus: "open" }] }); });
router.patch("/incidents/:id", requireRole("owner", "manager"), async (req, res) => { const existing = (await db.select().from(incidentsTable).where(eq(incidentsTable.id, id(req.params.id))))[0]; if (!existing) { res.status(404).json({ error: "Incident not found" }); return; } const next = body(req).status; if (!["open", "in_review", "resolved", "reclean"].includes(next)) { res.status(400).json({ error: "Invalid incident status" }); return; } if (!canTransitionIncident(existing.status as "open" | "in_review" | "resolved" | "reclean", next)) { res.status(409).json({ error: `Cannot move incident from ${existing.status} to ${next}` }); return; } const [incident] = await db.update(incidentsTable).set({ status: next, resolution: body(req).resolution, reviewedAt: new Date() }).where(eq(incidentsTable.id, existing.id)).returning(); await db.insert(incidentHistoryTable).values({ incidentId: existing.id, fromStatus: existing.status, toStatus: next, note: body(req).note, actorClerkUserId: req.authContext?.clerkUserId }); const history = await db.select().from(incidentHistoryTable).where(eq(incidentHistoryTable.incidentId, existing.id)); res.json({ ...incident, history }); });
router.get("/incidents", requireRole("owner", "manager"), async (req, res) => { const filter = typeof req.query.status === "string" ? eq(incidentsTable.status, req.query.status) : undefined; const incidents = await db.select().from(incidentsTable).where(filter); res.json(await Promise.all(incidents.map(async incident => ({ ...incident, history: await db.select().from(incidentHistoryTable).where(eq(incidentHistoryTable.incidentId, incident.id)) })))); });

router.post("/worker-rates", requireRole("owner", "manager"), async (req, res) => { const [rate] = await db.insert(workerRatesTable).values(body(req)).returning(); res.status(201).json(rate); });
router.get("/payouts", requireRole("owner", "manager"), async (req, res) => {
  const entries = await db.select().from(timeEntriesTable).where(and(gte(timeEntriesTable.clockIn, new Date(String(req.query.start))), lte(timeEntriesTable.clockIn, new Date(String(req.query.end)))));
  const employees = await db.select().from(employeesTable); const rates = await db.select().from(workerRatesTable);
  const result = entries.map(entry => { const minutes = entry.correctionStatus === "approved" && entry.clockOut ? calculateWorkedMinutes(entry) : 0; const rate = rates.find(r => r.employeeId === entry.employeeId); const worker = employees.find(e => e.id === entry.employeeId); return { ...entry, employee: worker, approvedMinutes: minutes, approvedHours: minutes / 60, hourlyRate: rate?.hourlyRate ?? null, amount: rate ? (minutes / 60) * Number(rate.hourlyRate) : null }; });
  if (req.query.format === "csv") { res.type("text/csv").send(["employee_id,employee,approved_minutes,approved_hours,hourly_rate,amount", ...result.map(r => `${r.employeeId},${JSON.stringify(r.employee?.name ?? "")},${r.approvedMinutes},${r.approvedHours},${r.hourlyRate ?? ""},${r.amount ?? ""}`)].join("\n")); return; }
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

router.post("/pay-periods", requireRole("owner", "manager"), async (req, res) => { const input = body(req); if (!input.startsOn || !input.endsOn) { res.status(400).json({ error: "startsOn and endsOn are required" }); return; } const [period] = await db.insert(payPeriodsTable).values({ startsOn: input.startsOn, endsOn: input.endsOn }).onConflictDoNothing().returning(); res.status(201).json(period); });
router.get("/pay-periods", requireRole("owner", "manager"), async (_req, res) => res.json(await db.select().from(payPeriodsTable).orderBy(asc(payPeriodsTable.startsOn))));
router.post("/pay-periods/:id/approve", requireRole("owner", "manager"), async (req, res) => { const manager = await currentEmployee(req); const periodId = id(req.params.id); const [period] = await db.update(payPeriodsTable).set({ status: "approved", approvedBy: manager?.id, approvedAt: new Date() }).where(and(eq(payPeriodsTable.id, periodId), eq(payPeriodsTable.status, "draft"))).returning(); if (!period) { res.status(409).json({ error: "Pay period is not draft or does not exist" }); return; } const entries = await db.select().from(timeEntriesTable).where(and(gte(timeEntriesTable.clockIn, new Date(`${period.startsOn}T00:00:00Z`)), lte(timeEntriesTable.clockIn, new Date(`${period.endsOn}T23:59:59Z`)), eq(timeEntriesTable.correctionStatus, "approved"))); const rates = await db.select().from(workerRatesTable); const totals = new Map<number, number>(); for (const entry of entries) totals.set(entry.employeeId, (totals.get(entry.employeeId) ?? 0) + (entry.clockOut ? calculateWorkedMinutes(entry) : 0)); for (const [employeeId, minutes] of totals) { const rate = rates.find(item => item.employeeId === employeeId); if (rate) await db.insert(payoutRecordsTable).values({ payPeriodId: periodId, employeeId, approvedMinutes: minutes, hourlyRate: rate.hourlyRate, amount: String(minutes / 60 * Number(rate.hourlyRate)) }).onConflictDoNothing(); } res.json(period); });
router.post("/pay-periods/:id/paid", requireRole("owner", "manager"), async (req, res) => { const manager = await currentEmployee(req); const [existing] = await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, id(req.params.id))); if (!existing) { res.status(404).json({ error: "Pay period not found" }); return; } if (!canTransitionPayPeriod(existing.status as "draft" | "approved" | "paid", "paid")) { res.status(409).json({ error: "Pay period must be approved first" }); return; } const [period] = await db.update(payPeriodsTable).set({ status: "paid", paidBy: manager?.id, paidAt: new Date() }).where(and(eq(payPeriodsTable.id, existing.id), eq(payPeriodsTable.status, "approved"))).returning(); res.json(period); });
router.post("/pay-periods/:id/adjustments", requireRole("owner", "manager"), async (req, res) => { const input = body(req); const manager = await currentEmployee(req); const [record] = await db.update(payoutRecordsTable).set({ adjustmentAmount: String(input.amount), adjustmentReason: input.reason, adjustmentActor: manager?.id }).where(and(eq(payoutRecordsTable.payPeriodId, id(req.params.id)), eq(payoutRecordsTable.employeeId, Number(input.employeeId)))).returning(); if (!record) { res.status(404).json({ error: "Payout record not found" }); return; } res.json(record); });
router.get("/reports/owner", requireRole("owner", "manager"), async (req, res) => {
  const start = String(req.query.start);
  const end = String(req.query.end);
  if (!start || !end) { res.status(400).json({ error: "start and end are required" }); return; }
  const jobs = await db.select().from(jobsTable).where(and(gte(jobsTable.scheduledDate, start), lte(jobsTable.scheduledDate, end)));
  const incidents = await db.select().from(incidentsTable).where(and(gte(incidentsTable.createdAt, new Date(`${start}T00:00:00Z`)), lte(incidentsTable.createdAt, new Date(`${end}T23:59:59Z`))));
  const plans = await db.select().from(servicePlansTable);
  const employees = await db.select().from(employeesTable);
  const entries = await db.select().from(timeEntriesTable).where(and(gte(timeEntriesTable.clockIn, new Date(`${start}T00:00:00Z`)), lte(timeEntriesTable.clockIn, new Date(`${end}T23:59:59Z`)), eq(timeEntriesTable.correctionStatus, "approved")));
  const rates = await db.select().from(workerRatesTable);
  const labor = new Map<number, { approvedMinutes: number; amount: number }>();
  for (const entry of entries) {
    const minutes = entry.clockOut ? calculateWorkedMinutes(entry) : 0;
    const rate = rates.find(item => item.employeeId === entry.employeeId);
    const current = labor.get(entry.employeeId) ?? { approvedMinutes: 0, amount: 0 };
    current.approvedMinutes += minutes;
    current.amount += rate ? minutes / 60 * Number(rate.hourlyRate) : 0;
    labor.set(entry.employeeId, current);
  }
  const incidentSummary = incidents.reduce((out, item) => {
    const key = `${item.severity}:${item.status}`;
    out[key] = (out[key] ?? 0) + 1;
    return out;
  }, {} as Record<string, number>);
  res.json({
    dateRange: { start, end },
    jobs: { volume: jobs.length, completed: jobs.filter(j => j.status === "completed").length },
    employees: employees.map(employee => ({ ...employee, ...(labor.get(employee.id) ?? { approvedMinutes: 0, amount: 0 }) })),
    payouts: { approvedMinutes: [...labor.values()].reduce((sum, item) => sum + item.approvedMinutes, 0), amount: [...labor.values()].reduce((sum, item) => sum + item.amount, 0) },
    recurringServices: plans.filter(p => !p.pausedAt).length,
    incidents: incidentSummary,
    customerHistoryCount: new Set(jobs.map(j => j.clientName)).size,
  });
});

export default router;