import { Router, type IRouter } from "express";
import { and, eq, gte, lte, asc, isNull } from "drizzle-orm";
import { db, customersTable, addressesTable, servicePlansTable, serviceOccurrencesTable, employeesTable, jobAssignmentsTable, timeEntriesTable, proofPhotosTable, incidentsTable, workerRatesTable, activityEventsTable, messagesTable, jobsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { generateOccurrences } from "../lib/recurrence";
import { calculateWorkedMinutes } from "../lib/time-entries";

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

router.get("/customers", async (_req, res) => res.json(await db.select().from(customersTable).orderBy(asc(customersTable.name))));
router.post("/customers", async (req, res) => {
  const input = body(req);
  if (!input.name) { res.status(400).json({ error: "name is required" }); return; }
  const [customer] = await db.insert(customersTable).values({ name: input.name, phone: input.phone, email: input.email, notes: input.notes }).returning();
  res.status(201).json(customer);
});
router.get("/customers/:id/addresses", async (req, res) => res.json(await db.select().from(addressesTable).where(eq(addressesTable.customerId, id(req.params.id)))));
router.post("/customers/:id/addresses", async (req, res) => {
  const input = body(req);
  if (!input.line1 || !input.city || !input.state || !input.postalCode) { res.status(400).json({ error: "address fields are required" }); return; }
  const [address] = await db.insert(addressesTable).values({ customerId: id(req.params.id), ...input }).returning();
  res.status(201).json(address);
});

router.get("/service-plans", async (_req, res) => res.json(await db.select().from(servicePlansTable)));
router.get("/service-plans/:id/occurrences", async (req, res) => res.json(await db.select().from(serviceOccurrencesTable).where(eq(serviceOccurrencesTable.planId, id(req.params.id)))));
router.post("/service-plans", async (req, res) => {
  const input = body(req);
  if (!input.customerId || !input.addressId || !input.nextOccurrence || !input.frequency) { res.status(400).json({ error: "customerId, addressId, nextOccurrence and frequency are required" }); return; }
  const [plan] = await db.insert(servicePlansTable).values(input).returning();
  res.status(201).json(plan);
});
router.patch("/service-plans/:id", async (req, res) => {
  const [plan] = await db.update(servicePlansTable).set(body(req)).where(eq(servicePlansTable.id, id(req.params.id))).returning();
  if (!plan) { res.status(404).json({ error: "Service plan not found" }); return; } res.json(plan);
});
router.post("/service-plans/:id/pause", async (req, res) => res.json((await db.update(servicePlansTable).set({ pausedAt: new Date() }).where(eq(servicePlansTable.id, id(req.params.id))).returning())[0]));
router.post("/service-plans/:id/resume", async (req, res) => res.json((await db.update(servicePlansTable).set({ pausedAt: null }).where(eq(servicePlansTable.id, id(req.params.id))).returning())[0]));
router.post("/service-plans/:id/generate", async (req, res) => {
  const plan = (await db.select().from(servicePlansTable).where(eq(servicePlansTable.id, id(req.params.id))))[0];
  if (!plan) { res.status(404).json({ error: "Service plan not found" }); return; }
  const dates = generateOccurrences(plan.nextOccurrence, { frequency: plan.frequency as any, intervalWeeks: plan.intervalWeeks ?? undefined }, Number(body(req).count ?? 12));
  const rows = await db.insert(serviceOccurrencesTable).values(dates.map(occurrenceDate => ({ planId: plan.id, occurrenceDate }))).onConflictDoNothing().returning();
  res.status(201).json(rows);
});
router.post("/occurrences/:id/skip", async (req, res) => res.json((await db.update(serviceOccurrencesTable).set({ status: "skipped", skippedReason: body(req).reason ?? "Skipped by operator" }).where(eq(serviceOccurrencesTable.id, id(req.params.id))).returning())[0]));
router.patch("/occurrences/:id", async (req, res) => res.json((await db.update(serviceOccurrencesTable).set(body(req)).where(eq(serviceOccurrencesTable.id, id(req.params.id))).returning())[0]));

router.get("/employees/me", async (req, res) => {
  const employee = req.authContext ? (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, req.authContext.clerkUserId)))[0] : undefined;
  if (!employee) { res.status(404).json({ error: "Employee profile not found" }); return; } res.json(employee);
});
router.get("/employees", requireRole("owner", "manager"), async (_req, res) => res.json(await db.select().from(employeesTable).where(eq(employeesTable.active, "true"))));
router.get("/jobs/assigned", async (req, res) => {
  const employee = req.authContext ? (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, req.authContext.clerkUserId)))[0] : undefined;
  if (!employee) { res.status(404).json({ error: "Employee profile not found" }); return; }
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
  if (!employee) { res.status(404).json({ error: "Employee profile not found" }); return; }
  if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; }
  const [entry] = await db.insert(timeEntriesTable).values({ jobId: id(req.params.jobId), employeeId: employee.id, clockIn: new Date() }).returning(); res.status(201).json(entry);
});
router.post("/time-entries/:id/clock-out", async (req, res) => { const entry = (await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id(req.params.id))))[0]; if (!entry) { res.status(404).json({ error: "Time entry not found" }); return; } if (!(await canAccessJob(req, entry.jobId))) { res.status(403).json({ error: "Time entry is not yours" }); return; } res.json((await db.update(timeEntriesTable).set({ clockOut: new Date() }).where(eq(timeEntriesTable.id, entry.id)).returning())[0]); });
router.post("/time-entries/:id/break", async (req, res) => { const entry = (await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id(req.params.id))))[0]; if (!entry || !(await canAccessJob(req, entry.jobId))) { res.status(entry ? 403 : 404).json({ error: entry ? "Time entry is not yours" : "Time entry not found" }); return; } res.json((await db.update(timeEntriesTable).set({ breaksMinutes: Number(body(req).minutes ?? 0) }).where(eq(timeEntriesTable.id, entry.id)).returning())[0]); });
router.post("/time-entries/:id/correction", async (req, res) => { const entry = (await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id(req.params.id))))[0]; if (!entry || !(await canAccessJob(req, entry.jobId))) { res.status(entry ? 403 : 404).json({ error: entry ? "Time entry is not yours" : "Time entry not found" }); return; } res.json((await db.update(timeEntriesTable).set({ correctionMinutes: Number(body(req).minutes), correctionReason: body(req).reason, correctionStatus: "pending" }).where(eq(timeEntriesTable.id, entry.id)).returning())[0]); });
router.post("/time-entries/:id/approve", requireRole("owner", "manager"), async (req, res) => { const manager = await currentEmployee(req); const [updated] = await db.update(timeEntriesTable).set({ correctionStatus: "approved", approvedAt: new Date(), approvedBy: manager?.id ?? null }).where(eq(timeEntriesTable.id, id(req.params.id))).returning(); if (!updated) { res.status(404).json({ error: "Time entry not found" }); return; } await event("time", "Time correction approved", undefined, updated.jobId); res.json(updated); });
router.get("/time-entries/active", async (req, res) => { const employee = await currentEmployee(req); const jobId = Number(req.query.jobId); const rows = await db.select().from(timeEntriesTable).where(and(employee && !["owner", "manager"].includes((req.authContext?.role ?? "").toLowerCase()) ? eq(timeEntriesTable.employeeId, employee.id) : undefined, Number.isFinite(jobId) ? eq(timeEntriesTable.jobId, jobId) : undefined, isNull(timeEntriesTable.clockOut))); res.json(rows); });
router.get("/time-entries", async (req, res) => { const employee = await currentEmployee(req); const rows = await db.select().from(timeEntriesTable).where(and(req.query.status === "pending" ? eq(timeEntriesTable.correctionStatus, "pending") : undefined, employee && !["owner", "manager"].includes((req.authContext?.role ?? "").toLowerCase()) ? eq(timeEntriesTable.employeeId, employee.id) : undefined)); res.json(rows); });

router.post("/jobs/:jobId/photos", async (req, res) => {
  const input = body(req);
  if (!input.objectPath || !["before", "after"].includes(input.kind)) { res.status(400).json({ error: "objectPath and kind(before|after) are required" }); return; }
  if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; }
  const [photo] = await db.insert(proofPhotosTable).values({ jobId: id(req.params.jobId), kind: input.kind, objectPath: input.objectPath, contentType: input.contentType ?? "image/jpeg", byteSize: input.byteSize }).returning(); res.status(201).json(photo);
});
router.get("/jobs/:jobId/photos", async (req, res) => { if (!(await canAccessJob(req, id(req.params.jobId)))) { res.status(403).json({ error: "Job is not assigned to you" }); return; } res.json((await db.select().from(proofPhotosTable).where(eq(proofPhotosTable.jobId, id(req.params.jobId)))).map(photo => ({ ...photo, readUrl: `/api/storage/objects${photo.objectPath.replace("/objects", "")}` }))); });
router.get("/incidents", requireRole("owner", "manager"), async (req, res) => { const filter = typeof req.query.status === "string" ? eq(incidentsTable.status, req.query.status) : undefined; const incidents = await db.select().from(incidentsTable).where(filter); res.json(incidents); });
router.post("/jobs/:jobId/incidents", async (req, res) => { const [incident] = await db.insert(incidentsTable).values({ jobId: id(req.params.jobId), type: body(req).type ?? "qa", description: body(req).description ?? "" }).returning(); res.status(201).json(incident); });
router.patch("/incidents/:id", requireRole("owner", "manager"), async (req, res) => res.json((await db.update(incidentsTable).set({ ...body(req), reviewedAt: new Date(), reviewedBy: null }).where(eq(incidentsTable.id, id(req.params.id))).returning())[0]));

router.post("/worker-rates", requireRole("owner", "manager"), async (req, res) => { const [rate] = await db.insert(workerRatesTable).values(body(req)).returning(); res.status(201).json(rate); });
router.get("/payouts", requireRole("owner", "manager"), async (req, res) => {
  const entries = await db.select().from(timeEntriesTable).where(and(gte(timeEntriesTable.clockIn, new Date(String(req.query.start))), lte(timeEntriesTable.clockIn, new Date(String(req.query.end)))));
  const employees = await db.select().from(employeesTable); const rates = await db.select().from(workerRatesTable);
  const result = entries.map(entry => { const minutes = entry.correctionStatus === "approved" && entry.clockOut ? calculateWorkedMinutes(entry) : 0; const rate = rates.find(r => r.employeeId === entry.employeeId); const worker = employees.find(e => e.id === entry.employeeId); return { ...entry, employee: worker, approvedMinutes: minutes, approvedHours: minutes / 60, hourlyRate: rate?.hourlyRate ?? null, amount: rate ? (minutes / 60) * Number(rate.hourlyRate) : null }; });
  if (req.query.format === "csv") { res.type("text/csv").send(["employee_id,employee,approved_minutes,approved_hours,hourly_rate,amount", ...result.map(r => `${r.employeeId},${JSON.stringify(r.employee?.name ?? "")},${r.approvedMinutes},${r.approvedHours},${r.hourlyRate ?? ""},${r.amount ?? ""}`)].join("\n")); return; }
  res.json(result);
});
router.get("/activity/history", async (_req, res) => res.json(await db.select().from(activityEventsTable).orderBy(asc(activityEventsTable.createdAt))));
router.get("/jobs/:jobId/messages", async (req, res) => res.json(await db.select().from(messagesTable).where(eq(messagesTable.jobId, id(req.params.jobId))).orderBy(asc(messagesTable.createdAt))));

export default router;