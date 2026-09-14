import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { requireActiveEmployee, requireRole } from "../middlewares/auth";
import { normalizeMessageIntent } from "../lib/messages";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  jobImportEventsTable,
  jobsTable,
  activityEventsTable,
  messagesTable,
  teamMembersTable,
  employeesTable,
  jobAssignmentsTable,
  remindersTable,
  incidentsTable,
  timeEntriesTable,
  notificationsTable,
  type Job,
  type TeamMember,
} from "@workspace/db";
import {
  CreateJobBody,
  CreateTeamMemberBody,
  ImportElevateJobBody,
  ListJobsQueryParams,
  SendJobMessageBody,
  SendJobMessageParams,
  UpdateJobBody,
  UpdateJobChecklistBody,
  UpdateJobChecklistParams,
  UpdateJobParams,
} from "@workspace/api-zod";
import { canCleanerAccessJob } from "../lib/job-access";
import { checkAssignmentEligibility } from "../lib/job-assignments";
import { employeeForClerkUser, notifyAssignedCleaners, notifyEmployees } from "../lib/notifications";

const router: IRouter = Router();
router.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/integrations/elevate/jobs") {
    next();
    return;
  }
  requireActiveEmployee(req, res, next);
});
let seedPromise: Promise<void> | null = null;

type ChecklistItem = { id: number; label: string; completed: boolean };
type Photo = { id: number; url: string; label: string; createdAt: string };

const PLACEHOLDER_TEAM = ["Maya Chen", "Jordan Ellis", "Avery Brooks"];

function checklistForService(serviceType: string): ChecklistItem[] {
  const common = [
    "Confirm access notes and client requests",
    "Kitchen surfaces, sink, and appliance exteriors",
    "Bathrooms cleaned and sanitized",
    "Dust and wipe reachable surfaces",
    "Vacuum and mop floors",
    "Remove trash and reset rooms",
    "Final walkthrough photos",
  ];
  const normalized = serviceType.toLowerCase();
  const labels = normalized.includes("move")
    ? [
        "Empty all cabinets, drawers, and closets",
        "Clean inside cabinets and drawers",
        "Clean inside oven and refrigerator",
        "Kitchen and bathrooms deep cleaned",
        "Baseboards, doors, trim, and fixtures",
        "Vacuum and mop all floors",
        "Remove all trash and debris",
        "Final walkthrough photos",
      ]
    : normalized.includes("deep")
      ? [
          ...common.slice(0, -1),
          "Detail baseboards, doors, and trim",
          "Clean buildup around fixtures and appliances",
          "Complete selected add-ons",
          "Final walkthrough photos",
        ]
      : [...common.slice(0, -1), "Complete selected add-ons", "Final walkthrough photos"];
  return labels.map((label, index) => ({ id: index + 1, label, completed: false }));
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function dateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mapMember(member: TeamMember) {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    phone: member.phone,
    status: member.status,
    initials: member.initials,
  };
}

async function ensureSeedData() {
  if (process.env.MAWII_DEV_SEED !== "true") return;
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const existingMembers = await db.select().from(teamMembersTable).orderBy(asc(teamMembersTable.id));
    const placeholderMembers = existingMembers.filter((member) => PLACEHOLDER_TEAM.includes(member.name));
    if (placeholderMembers.length) {
      for (const maya of placeholderMembers.filter((member) => member.name === "Maya Chen")) {
        await db.update(teamMembersTable).set({
          name: "Danna Donjuan",
          role: "Owner",
          phone: "+1 (214) 650-4326",
          status: "available",
          initials: "DD",
        }).where(eq(teamMembersTable.id, maya.id));
      }
      for (const jordan of placeholderMembers.filter((member) => member.name === "Jordan Ellis")) {
        await db.update(teamMembersTable).set({
          name: "Ronnie Irizarry",
          role: "Owner",
          phone: "(972) 854-2542",
          status: "available",
          initials: "RI",
        }).where(eq(teamMembersTable.id, jordan.id));
      }
      for (const member of placeholderMembers.filter((item) => item.name === "Avery Brooks")) {
        await db.delete(teamMembersTable).where(eq(teamMembersTable.id, member.id));
      }
    }

    const oldServices = [
      { from: "Deep clean", to: "Deep cleaning" },
      { from: "Move-out clean", to: "Move In/Out cleaning" },
      { from: "Maintenance clean", to: "Standard cleaning" },
    ];
    for (const service of oldServices) {
      await db.update(jobsTable).set({
        serviceType: service.to,
        checklist: checklistForService(service.to),
      }).where(eq(jobsTable.serviceType, service.from));
    }

    const members = await db.select().from(teamMembersTable).limit(1);
    if (members.length === 0) {
      await db.insert(teamMembersTable).values([
        {
          name: "Danna Donjuan",
          role: "Owner",
          phone: "+1 (214) 650-4326",
          status: "available",
          initials: "DD",
        },
        {
          name: "Ronnie Irizarry",
          role: "Owner",
          phone: "(972) 854-2542",
          status: "available",
          initials: "RI",
        },
      ]);
    }

    const jobs = await db.select().from(jobsTable).limit(1);
    if (jobs.length === 0) {
      const seededMembers = await db
        .select()
        .from(teamMembersTable)
        .orderBy(asc(teamMembersTable.id));
      await db.insert(jobsTable).values([
      {
        clientName: "The Ramirez family",
        address: "1842 N Damen Ave, Chicago",
        scheduledDate: dateOffset(0),
        startTime: "09:00",
        endTime: "11:30",
        status: "in_progress",
        serviceType: "Deep cleaning",
        notes: "Please prioritize the kitchen and main floor windows.",
        clientPhone: "(312) 555-0124",
        teamMemberIds: seededMembers.slice(0, 2).map((member) => member.id),
        checklist: checklistForService("Deep cleaning"),
        photos: [],
      },
      {
        clientName: "Northstar Realty",
        address: "701 W Fulton Market, Chicago",
        scheduledDate: dateOffset(1),
        startTime: "08:30",
        endTime: "12:00",
        status: "scheduled",
        serviceType: "Move In/Out cleaning",
        notes: "Lockbox code is in the client thread.",
        clientPhone: "(312) 555-0188",
        teamMemberIds: seededMembers.slice(1, 3).map((member) => member.id),
        checklist: checklistForService("Move In/Out cleaning"),
        photos: [],
      },
      {
        clientName: "Elena Rodriguez",
        address: "940 W Webster Ave, Chicago",
        scheduledDate: dateOffset(2),
        startTime: "13:00",
        endTime: "15:00",
        status: "attention",
        serviceType: "Standard cleaning",
        notes: "Client requested a text when the team is 20 minutes away.",
        clientPhone: "(312) 555-0116",
        teamMemberIds: [seededMembers[2]?.id ?? 3],
        checklist: checklistForService("Standard cleaning"),
        photos: [],
      },
      ]);
    }
  })();
  try {
    await seedPromise;
  } finally {
    seedPromise = null;
  }
}

function uniqueJobs(jobs: Job[]) {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = `${job.clientName}|${job.scheduledDate}|${job.startTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueMembers(members: TeamMember[]) {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = `${member.name}|${member.phone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The crew needs the client's name and address to do the work; they do not need a way to
 * contact the client directly, and customer communication stays with the desk. Hiding the
 * number in the interface alone would still ship it in the response.
 */
function forViewer<T extends { clientPhone: string | null }>(req: { authContext?: { role?: string } }, job: T): T {
  const role = (req.authContext?.role ?? "").toLowerCase();
  return role === "owner" || role === "manager" ? job : { ...job, clientPhone: null };
}

async function mapJob(job: Job) {
  const allMembers = uniqueMembers(await db
    .select()
    .from(teamMembersTable)
    .orderBy(asc(teamMembersTable.id)));
  const assignments = await db.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, job.id));
  const employeeIds = assignments.map((assignment) => assignment.employeeId);
  const assignedEmployees = employeeIds.length
    ? await db.select().from(employeesTable).where(inArray(employeesTable.id, employeeIds))
    : [];
  return {
    id: job.id,
    clientName: job.clientName,
    address: job.address,
    scheduledDate: job.scheduledDate,
    startTime: job.startTime,
    endTime: job.endTime,
    status: job.status as "scheduled" | "in_progress" | "completed" | "attention",
    serviceType: job.serviceType,
    serviceVariant: job.serviceVariant,
    addOns: job.addOns,
    durationMinutes: job.durationMinutes,
    frequency: job.frequency,
    notes: job.notes,
    accessInstructions: job.accessInstructions,
    clientPhone: job.clientPhone,
    externalSource: job.externalSource,
    externalId: job.externalId,
    team: allMembers.filter((member) => job.teamMemberIds.includes(member.id)).map(mapMember),
    assignedEmployees,
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      employeeId: assignment.employeeId,
      status: assignment.status,
    })),
    checklist: (job.checklist ?? []) as ChecklistItem[],
    photos: (job.photos ?? []) as Photo[],
    createdAt: job.createdAt.toISOString(),
  };
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePersonName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function timeParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

function hashBindingToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

router.get("/dashboard/summary", requireRole("owner", "manager"), async (_req, res) => {
  await ensureSeedData();
  const jobs = uniqueJobs(await db.select().from(jobsTable).orderBy(asc(jobsTable.scheduledDate), asc(jobsTable.startTime)));
  const today = dateOffset(0);
  const weekStart = dateOffset(-new Date().getDay());
  const upcoming = jobs.filter((job) => job.scheduledDate >= today && job.status !== "completed");
  const next = upcoming[0] ? await mapJob(upcoming[0]) : null;
  const todayRows = await Promise.all(jobs.filter((job) => job.scheduledDate === today).map(async (job) => {
    const mapped = await mapJob(job);
    const [incidents, corrections, notifications] = await Promise.all([
      db.select({ id: incidentsTable.id }).from(incidentsTable).where(and(eq(incidentsTable.jobId, job.id), inArray(incidentsTable.status, ["open", "in_review", "reclean"]))),
      db.select({ id: timeEntriesTable.id }).from(timeEntriesTable).where(and(eq(timeEntriesTable.jobId, job.id), eq(timeEntriesTable.correctionStatus, "pending"))),
      db.select({ id: notificationsTable.id }).from(notificationsTable).where(eq(notificationsTable.jobId, job.id)),
    ]);
    return {
      ...mapped,
      pendingIncidents: incidents.length,
      pendingCorrections: corrections.length,
      notificationCount: notifications.length,
    };
  }));
  const ownerEmployees = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(inArray(employeesTable.role, ["owner", "manager"]));
  const unreadNotifications = ownerEmployees.length
    ? await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(inArray(notificationsTable.employeeId, ownerEmployees.map(({ id }) => id)), isNull(notificationsTable.readAt)))
    : [];
  res.json({
    todayJobs: jobs.filter((job) => job.scheduledDate === today).length,
    openJobs: jobs.filter((job) => job.status !== "completed").length,
    completedThisWeek: jobs.filter((job) => job.status === "completed" && job.scheduledDate >= weekStart && job.scheduledDate <= today).length,
    attentionNeeded: jobs.filter((job) => job.status === "attention").length,
    operations: todayRows,
    pendingIncidents: todayRows.reduce((sum, row) => sum + row.pendingIncidents, 0),
    pendingCorrections: todayRows.reduce((sum, row) => sum + row.pendingCorrections, 0),
    unreadNotifications: unreadNotifications.length,
    ownerCount: ownerEmployees.length,
    nextJob: next,
  });
});

router.post("/dashboard/daily-summary", requireRole("owner", "manager"), async (req, res): Promise<void> => {
  const jobs = uniqueJobs(await db.select().from(jobsTable).orderBy(asc(jobsTable.scheduledDate), asc(jobsTable.startTime)));
  const today = dateOffset(0);
  const todayJobs = jobs.filter((job) => job.scheduledDate === today);
  const openToday = todayJobs.filter((job) => job.status !== "completed").length;
  const attentionToday = todayJobs.filter((job) => job.status === "attention").length;
  const summary = `${todayJobs.length} job(s) today · ${openToday} open · ${attentionToday} need attention`;
  const owners = await db.select({ id: employeesTable.id }).from(employeesTable).where(inArray(employeesTable.role, ["owner", "manager"]));
  await notifyEmployees(owners.map(({ id: employeeId }) => ({
    employeeId,
    kind: "daily_summary",
    title: "Daily operations summary",
    body: summary,
  })));
  await db.insert(activityEventsTable).values({
    actorClerkUserId: req.authContext?.clerkUserId,
    type: "summary",
    title: "Daily operations summary triggered",
    detail: summary,
  });
  res.status(201).json({ summaryDate: today, notifiedCount: owners.length, summary });
});

router.get("/activity", requireRole("owner", "manager"), async (_req, res) => {
  await ensureSeedData();
  const events = await db.select().from(activityEventsTable).orderBy(desc(activityEventsTable.createdAt)).limit(50);
  res.json(events.map((event) => ({
    id: event.id,
    type: event.type,
    title: event.title,
    detail: event.detail ?? "",
    createdAt: event.createdAt.toISOString(),
    jobId: event.jobId,
  })));
});

router.get("/jobs", async (req, res) => {
  await ensureSeedData();
  const parsed = ListJobsQueryParams.safeParse({
    ...req.query,
    startDate: req.query.startDate
      ? new Date(String(req.query.startDate))
      : undefined,
    endDate: req.query.endDate
      ? new Date(String(req.query.endDate))
      : undefined,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid job filters" });
    return;
  }
  const filters = [];
  if (parsed.data.startDate) {
    filters.push(gte(jobsTable.scheduledDate, parsed.data.startDate.toISOString().slice(0, 10)));
  }
  if (parsed.data.endDate) {
    filters.push(lte(jobsTable.scheduledDate, parsed.data.endDate.toISOString().slice(0, 10)));
  }
  if (parsed.data.status) filters.push(eq(jobsTable.status, parsed.data.status));
  const jobs = uniqueJobs(await db
    .select()
    .from(jobsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(jobsTable.scheduledDate), asc(jobsTable.startTime)));
  const role = (req.authContext?.role ?? "").toLowerCase();
  if (role === "cleaner") {
    const clerkUserId = req.authContext?.clerkUserId;
    const employee = clerkUserId
      ? (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, clerkUserId)))[0]
      : undefined;
    if (!employee) {
      res.status(403).json({ error: "No employee profile is linked to this Clerk user" });
      return;
    }
    const assignments = await db.select().from(jobAssignmentsTable).where(and(
      eq(jobAssignmentsTable.employeeId, employee.id),
      inArray(jobAssignmentsTable.status, ["assigned", "accepted"]),
    ));
    const assignedJobIds = new Set(assignments.map((assignment) => assignment.jobId));
    const assignedJobs = await Promise.all(jobs.filter((job) => assignedJobIds.has(job.id)).map(mapJob));
    res.json(assignedJobs.map((job) => forViewer(req, job)));
    return;
  }
  const allJobs = await Promise.all(jobs.map(mapJob));
  res.json(allJobs.map((job) => forViewer(req, job)));
});

router.post("/jobs", requireRole("owner", "manager"), async (req, res) => {
  await ensureSeedData();
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid job payload" });
    return;
  }
  const { employeeIds, ...jobInput } = parsed.data;
  const requestedEmployeeIds = employeeIds === undefined ? undefined : [...new Set(employeeIds)];
  if (requestedEmployeeIds?.length) {
    const eligibility = await checkAssignmentEligibility(requestedEmployeeIds);
    if (!eligibility.valid) {
      res.status(422).json({ error: "Only active cleaner employees can be assigned" });
      return;
    }
  }
  const [job] = await db
    .insert(jobsTable)
    .values({
      ...jobInput,
      scheduledDate: jobInput.scheduledDate.toISOString().slice(0, 10),
      status: "scheduled",
      teamMemberIds: jobInput.teamMemberIds ?? [],
      checklist: checklistForService(jobInput.serviceType),
      photos: [],
    })
    .returning();
  if (requestedEmployeeIds?.length) {
    await db.insert(jobAssignmentsTable).values(
      requestedEmployeeIds.map((employeeId) => ({ jobId: job.id, employeeId, status: "assigned" })),
    );
    await notifyEmployees(requestedEmployeeIds.map((employeeId) => ({
      employeeId,
      jobId: job.id,
      kind: "assignment",
      title: "New job assignment",
      body: `${job.clientName} is scheduled for ${job.scheduledDate} at ${job.startTime}. Accept the assignment to begin field work.`,
    })));
  }
  await db.insert(activityEventsTable).values({
    type: "job",
    title: "Job scheduled",
    detail: `Job created for ${job.clientName}`,
    jobId: job.id,
  });
  res.status(201).json(await mapJob(job));
});

router.get("/jobs/:id", async (req, res) => {
  await ensureSeedData();
  const parsed = Number(req.params.id);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, parsed));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (!(await canCleanerAccessJob(req, job.id))) {
    res.status(403).json({ error: "Job is not assigned to this cleaner" });
    return;
  }
  res.json(forViewer(req, await mapJob(job)));
});

router.patch("/jobs/:id", requireRole("owner", "manager"), async (req, res) => {
  await ensureSeedData();
  const params = UpdateJobParams.safeParse(req.params);
  const body = UpdateJobBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid job update" });
    return;
  }
  const { scheduledDate, employeeIds, ...rest } = body.data;
  if (employeeIds) {
    const eligibility = await checkAssignmentEligibility(employeeIds);
    if (!eligibility.valid) {
      res.status(422).json({ error: "Only active cleaner employees can be assigned" });
      return;
    }
  }
  const updateData = scheduledDate
    ? { ...rest, scheduledDate: scheduledDate.toISOString().slice(0, 10) }
    : rest;
  // Assigning a crew sends employeeIds and nothing else, which leaves no column to write.
  // Drizzle throws "No values to set" on an empty update, so the whole request failed and
  // a crew could never be assigned from the job screen.
  const [job] = Object.keys(updateData).length
    ? await db
        .update(jobsTable)
        .set(updateData)
        .where(eq(jobsTable.id, params.data.id))
        .returning()
    : await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (employeeIds) {
    const requestedIds = new Set(employeeIds);
    const newAssignmentEmployeeIds = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mawii:job-assignments:${job.id}`}))`);
      const existingAssignments = await tx.select().from(jobAssignmentsTable).where(eq(jobAssignmentsTable.jobId, job.id));
      for (const assignment of existingAssignments) {
        if (!requestedIds.has(assignment.employeeId)) {
          await tx.delete(jobAssignmentsTable).where(eq(jobAssignmentsTable.id, assignment.id));
        }
      }
      const insertedEmployeeIds: number[] = [];
      for (const employeeId of requestedIds) {
        const existing = existingAssignments.find((assignment) => assignment.employeeId === employeeId);
        if (existing) {
          if (existing.status === "declined") {
            await tx.update(jobAssignmentsTable).set({ status: "assigned" }).where(eq(jobAssignmentsTable.id, existing.id));
          }
        } else {
          await tx.insert(jobAssignmentsTable).values({ jobId: job.id, employeeId, status: "assigned" });
          insertedEmployeeIds.push(employeeId);
        }
      }
      return insertedEmployeeIds;
    });
    await notifyEmployees(newAssignmentEmployeeIds.map((employeeId) => ({
      employeeId,
      jobId: job.id,
      kind: "assignment",
      title: "New job assignment",
      body: `${job.clientName} is scheduled for ${job.scheduledDate} at ${job.startTime}. Accept the assignment to begin field work.`,
    })));
  }
  res.json(await mapJob(job));
});

router.post("/jobs/:jobId/assignments", requireRole("owner", "manager"), async (req, res) => {
  const jobId = Number(req.params.jobId);
  const employeeId = Number(req.body?.employeeId);
  if (!Number.isInteger(jobId) || !Number.isInteger(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: "employeeId is required" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  const eligibility = await checkAssignmentEligibility([employeeId]);
  const employee = eligibility.employees[0];
  if (!job || eligibility.missingEmployeeIds.length) {
    res.status(404).json({ error: "Job or active employee not found" });
    return;
  }
  if (!eligibility.valid) {
    res.status(422).json({ error: "Only cleaner employees can be assigned to jobs" });
    return;
  }
  const { assignment, created } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mawii:job-assignments:${jobId}`}))`);
    const existing = (await tx.select().from(jobAssignmentsTable).where(and(
      eq(jobAssignmentsTable.jobId, jobId),
      eq(jobAssignmentsTable.employeeId, employeeId),
    )))[0];
    if (existing) {
      const [updated] = await tx.update(jobAssignmentsTable).set({ status: "assigned" }).where(eq(jobAssignmentsTable.id, existing.id)).returning();
      return { assignment: updated, created: false };
    }
    const [createdAssignment] = await tx.insert(jobAssignmentsTable).values({ jobId, employeeId, status: "assigned" }).returning();
    return { assignment: createdAssignment, created: true };
  });
  if (created) {
    await notifyEmployees([{
      employeeId,
      jobId,
      kind: "assignment",
      title: "New job assignment",
      body: `${job.clientName} is scheduled for ${job.scheduledDate} at ${job.startTime}. Accept the assignment to begin field work.`,
    }]);
  }
  await db.insert(activityEventsTable).values({ type: "assignment", title: "Employee assigned", detail: `${employee.name} assigned to ${job.clientName}`, jobId });
  res.status(201).json(assignment);
});

router.post("/jobs/:jobId/reminders", requireRole("owner", "manager"), async (req, res): Promise<void> => {
  const jobId = Number(req.params.jobId);
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!Number.isInteger(jobId) || !title || !body) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const actor = await employeeForClerkUser(req.authContext!.clerkUserId);
  const [reminder] = await db.insert(remindersTable).values({
    jobId,
    createdByEmployeeId: actor?.id ?? null,
    title,
    body,
  }).returning();
  await notifyAssignedCleaners(jobId, { kind: "reminder", title, body });
  await db.insert(activityEventsTable).values({
    actorClerkUserId: req.authContext?.clerkUserId,
    type: "reminder",
    title: "Internal reminder sent",
    detail: `${title} · ${body}`,
    jobId,
  });
  res.status(201).json(reminder);
});

router.get("/jobs/:jobId/reminders", async (req, res): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!(await canCleanerAccessJob(req, jobId))) {
    res.status(403).json({ error: "Job is not assigned to this cleaner" });
    return;
  }
  res.json(await db.select().from(remindersTable).where(eq(remindersTable.jobId, jobId)).orderBy(desc(remindersTable.createdAt)));
});

router.patch("/jobs/:id/checklist", requireRole("owner", "manager", "cleaner"), async (req, res) => {
  await ensureSeedData();
  const params = UpdateJobChecklistParams.safeParse(req.params);
  const body = UpdateJobChecklistBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid checklist update" });
    return;
  }
  const [existing] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (!(await canCleanerAccessJob(req, existing.id))) {
    res.status(403).json({ error: "Job is not assigned to this cleaner" });
    return;
  }
  const checklist = ((existing.checklist ?? []) as ChecklistItem[]).map((item) =>
    item.id === body.data.itemId ? { ...item, completed: body.data.completed } : item,
  );
  const [job] = await db
    .update(jobsTable)
    .set({ checklist })
    .where(eq(jobsTable.id, params.data.id))
    .returning();
  await db.insert(activityEventsTable).values({
    type: "checklist",
    title: "Checklist updated",
    detail: `Checklist item ${body.data.itemId} updated`,
    jobId: params.data.id,
  });
  res.json(forViewer(req, await mapJob(job)));
});

router.post("/jobs/:id/messages", requireRole("owner", "manager"), async (req, res) => {
  const params = SendJobMessageParams.safeParse(req.params);
  const body = SendJobMessageBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid message" });
    return;
  }
  const intent = normalizeMessageIntent(body.data);
  const [message] = await db.insert(messagesTable).values({
    jobId: params.data.id,
    recipient: intent.recipient,
    body: intent.body,
    channel: intent.channel,
    audience: intent.audience,
    recipientPhone: typeof req.body.recipientPhone === "string" ? req.body.recipientPhone : null,
    recipientName: typeof req.body.recipientName === "string" ? req.body.recipientName : null,
    status: "queued",
    provider: "internal",
    actorClerkUserId: req.authContext?.clerkUserId,
    metadata: typeof req.body.metadata === "object" && req.body.metadata ? req.body.metadata : {},
  }).returning();
  await db.insert(activityEventsTable).values({
    actorClerkUserId: req.authContext?.clerkUserId,
    type: "message",
    title: "Message queued",
    detail: `${intent.channel}/${intent.audience} message queued`,
    jobId: params.data.id,
  });
  res.status(201).json({
    id: message.id,
    recipient: message.recipient,
    body: message.body,
    channel: message.channel,
    audience: message.audience,
    provider: message.provider,
    recipientPhone: message.recipientPhone,
    recipientName: message.recipientName,
    providerMessageId: message.providerMessageId,
    sentAt: message.sentAt?.toISOString() ?? null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    failedAt: message.failedAt?.toISOString() ?? null,
    failureReason: message.failureReason,
    metadata: message.metadata,
    actorClerkUserId: message.actorClerkUserId,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
  });
});

router.get("/team", requireRole("owner", "manager"), async (_req, res) => {
  await ensureSeedData();
  const members = uniqueMembers(await db.select().from(teamMembersTable).orderBy(asc(teamMembersTable.name)));
  res.json(members.map(mapMember));
});

router.post("/team", requireRole("owner", "manager"), async (req, res) => {
  const parsed = CreateTeamMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid team member" });
    return;
  }
  const [member] = await db
    .insert(teamMembersTable)
    .values({ ...parsed.data, status: "available", initials: initials(parsed.data.name) })
    .returning();
  res.status(201).json(mapMember(member));
});

router.post("/integrations/elevate/jobs", async (req, res): Promise<void> => {
  const configuredSecret = process.env.SESSION_SECRET;
  const signature = req.header("X-Mawii-Signature") ?? "";
  if (!configuredSecret || !secureEqual(signature, configuredSecret)) {
    req.log.warn("Rejected Elevate OS webhook with an invalid signature");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const parsed = ImportElevateJobBody.safeParse(req.body);
  if (!parsed.success) {
    const externalId =
      typeof req.body === "object" && req.body !== null && typeof req.body.appointmentId === "string"
        ? req.body.appointmentId
        : null;
    await db.insert(jobImportEventsTable).values({
      source: "elevate_os",
      externalId,
      success: false,
      message: "Appointment payload was missing or contained invalid fields",
    });
    req.log.warn({ externalId, errors: parsed.error.issues }, "Elevate OS import validation failed");
    res.status(400).json({ error: "Invalid appointment payload" });
    return;
  }

  const appointment = parsed.data;
  const calculatedEnd =
    appointment.endDateTime
      ?? new Date(appointment.dateTime.getTime() + (appointment.durationMinutes ?? 60) * 60_000);
  if (calculatedEnd.getTime() <= appointment.dateTime.getTime()) {
    req.log.warn(
      { externalId: appointment.appointmentId },
      "Rejected Elevate OS appointment with a non-positive duration",
    );
    res.status(422).json({ error: "Appointment end must be later than appointment start" });
    return;
  }

  const members = uniqueMembers(await db.select().from(teamMembersTable));
  const workerName = appointment.assignedWorker?.trim();
  const matchedWorker = workerName
    ? members.find((member) => normalizePersonName(member.name) === normalizePersonName(workerName))
    : undefined;
  const warnings =
    workerName && !matchedWorker
      ? [`Assigned worker "${workerName}" does not match anyone in the Mawii team roster`]
      : [];
  const startsAt = timeParts(appointment.dateTime);
  const endsAt = timeParts(calculatedEnd);
  const importedStatus =
    appointment.status === "completed"
      ? "completed"
      : appointment.status === "in_progress"
        ? "in_progress"
        : appointment.status === "attention" || appointment.status === "cancelled"
          ? "attention"
          : "scheduled";
  const jobValues = {
    clientName: appointment.clientName,
    clientPhone: appointment.clientPhone,
    address: appointment.address,
    scheduledDate: startsAt.date,
    startTime: startsAt.time,
    endTime: endsAt.time,
    serviceType: appointment.appointment,
    serviceVariant: appointment.variant,
    addOns: appointment.addOns ?? [],
    durationMinutes: appointment.durationMinutes,
    frequency: appointment.frequency,
    notes: appointment.notes,
  };
  const updateExisting = async (existing: Job) => {
    const workerUpdate = workerName
      ? { teamMemberIds: matchedWorker ? [matchedWorker.id] : existing.teamMemberIds }
      : {};
    const statusUpdate = appointment.status ? { status: importedStatus } : {};
    const checklistUpdate =
      appointment.appointment !== existing.serviceType
        ? { checklist: checklistForService(appointment.appointment) }
        : {};
    const [updated] = await db
      .update(jobsTable)
      .set({ ...jobValues, ...workerUpdate, ...statusUpdate, ...checklistUpdate })
      .where(eq(jobsTable.id, existing.id))
      .returning();
    const message = warnings.length
      ? "Existing appointment updated with a worker-matching warning"
      : "Existing appointment updated without creating a duplicate";
    await db.insert(jobImportEventsTable).values({
      source: "elevate_os",
      externalId: appointment.appointmentId,
      success: true,
      duplicate: true,
      message,
      jobId: updated.id,
    });
    res.json({
      success: true,
      duplicate: true,
      message,
      job: await mapJob(updated),
      warnings,
    });
    return updated;
  };

  try {
    const [existing] = await db
      .select()
      .from(jobsTable)
      .where(and(
        eq(jobsTable.externalSource, "elevate_os"),
        eq(jobsTable.externalId, appointment.appointmentId),
      ));
    if (existing) {
      await updateExisting(existing);
      return;
    }

    const [inserted] = await db
      .insert(jobsTable)
      .values({
        ...jobValues,
        status: importedStatus,
        externalSource: "elevate_os",
        externalId: appointment.appointmentId,
        teamMemberIds: matchedWorker ? [matchedWorker.id] : [],
        checklist: checklistForService(appointment.appointment),
        photos: [],
      })
      .onConflictDoNothing({
        target: [jobsTable.externalSource, jobsTable.externalId],
      })
      .returning();
    if (!inserted) {
      const [concurrent] = await db
        .select()
        .from(jobsTable)
        .where(and(
          eq(jobsTable.externalSource, "elevate_os"),
          eq(jobsTable.externalId, appointment.appointmentId),
        ));
      if (!concurrent) throw new Error("Conflicting Elevate job was not found after insert");
      await updateExisting(concurrent);
      return;
    }
    const message = warnings.length
      ? "Appointment imported with a worker-matching warning"
      : "Appointment imported successfully";
    await db.insert(jobImportEventsTable).values({
      source: "elevate_os",
      externalId: appointment.appointmentId,
      success: true,
      message,
      jobId: inserted.id,
    });
    // An imported job arrives with nobody on it, so the desk has to learn it exists.
    await notifyEmployees(
      (await db.select({ id: employeesTable.id }).from(employeesTable).where(inArray(employeesTable.role, ["owner", "manager"]))).map(({ id }) => ({
        employeeId: id,
        jobId: inserted.id,
        kind: "import",
        title: "New job from Elevate OS",
        body: `${inserted.clientName} · ${inserted.serviceType} · ${inserted.scheduledDate} ${inserted.startTime} — assign a cleaner.`,
      })),
    );
    res.status(201).json({
      success: true,
      duplicate: false,
      message,
      job: await mapJob(inserted),
      warnings,
    });
  } catch (error) {
    req.log.error({ error, externalId: appointment.appointmentId }, "Elevate OS import failed");
    await db.insert(jobImportEventsTable).values({
      source: "elevate_os",
      externalId: appointment.appointmentId,
      success: false,
      message: "Mawii could not save this appointment",
    });
    res.status(422).json({ error: "Appointment could not be imported" });
  }
});

router.get("/integrations/elevate/status", requireRole("owner", "manager"), async (_req, res): Promise<void> => {
  const events = await db
    .select()
    .from(jobImportEventsTable)
    .where(eq(jobImportEventsTable.source, "elevate_os"))
    .orderBy(desc(jobImportEventsTable.receivedAt));
  res.json({
    method: "gohighlevel_webhook",
    configured: Boolean(process.env.SESSION_SECRET),
    totalReceived: events.length,
    failedCount: events.filter((event) => !event.success).length,
    lastReceivedAt: events[0]?.receivedAt.toISOString() ?? null,
    recentEvents: events.slice(0, 8).map((event) => ({
      id: event.id,
      externalId: event.externalId,
      success: event.success,
      duplicate: event.duplicate,
      message: event.message,
      jobId: event.jobId,
      receivedAt: event.receivedAt.toISOString(),
    })),
  });
});

export default router;
