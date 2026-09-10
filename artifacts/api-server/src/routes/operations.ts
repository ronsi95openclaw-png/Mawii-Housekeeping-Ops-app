import { Router, type IRouter } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { normalizeMessageIntent } from "../lib/messages";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  jobsTable,
  activityEventsTable,
  messagesTable,
  teamMembersTable,
  type Job,
  type TeamMember,
} from "@workspace/db";
import {
  CreateJobBody,
  CreateTeamMemberBody,
  ListJobsQueryParams,
  SendJobMessageBody,
  SendJobMessageParams,
  UpdateJobBody,
  UpdateJobChecklistBody,
  UpdateJobChecklistParams,
  UpdateJobParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth);
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

async function mapJob(job: Job) {
  const allMembers = uniqueMembers(await db
    .select()
    .from(teamMembersTable)
    .orderBy(asc(teamMembersTable.id)));
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
    clientPhone: job.clientPhone,
    team: allMembers.filter((member) => job.teamMemberIds.includes(member.id)).map(mapMember),
    checklist: (job.checklist ?? []) as ChecklistItem[],
    photos: (job.photos ?? []) as Photo[],
    createdAt: job.createdAt.toISOString(),
  };
}

router.get("/dashboard/summary", async (_req, res) => {
  await ensureSeedData();
  const jobs = uniqueJobs(await db.select().from(jobsTable).orderBy(asc(jobsTable.scheduledDate), asc(jobsTable.startTime)));
  const today = dateOffset(0);
  const upcoming = jobs.filter((job) => job.scheduledDate >= today && job.status !== "completed");
  const next = upcoming[0] ? await mapJob(upcoming[0]) : null;
  res.json({
    todayJobs: jobs.filter((job) => job.scheduledDate === today).length,
    openJobs: jobs.filter((job) => job.status !== "completed").length,
    completedThisWeek: jobs.filter((job) => job.status === "completed").length,
    attentionNeeded: jobs.filter((job) => job.status === "attention").length,
    nextJob: next,
  });
});

router.get("/activity", async (_req, res) => {
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
  res.json(await Promise.all(jobs.map(mapJob)));
});

router.post("/jobs", requireRole("owner", "manager"), async (req, res) => {
  await ensureSeedData();
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid job payload" });
    return;
  }
  const [job] = await db
    .insert(jobsTable)
    .values({
      ...parsed.data,
      scheduledDate: parsed.data.scheduledDate.toISOString().slice(0, 10),
      status: "scheduled",
      teamMemberIds: parsed.data.teamMemberIds ?? [],
      checklist: checklistForService(parsed.data.serviceType),
      photos: [],
    })
    .returning();
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
  res.json(await mapJob(job));
});

router.patch("/jobs/:id", requireRole("owner", "manager"), async (req, res) => {
  await ensureSeedData();
  const params = UpdateJobParams.safeParse(req.params);
  const body = UpdateJobBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid job update" });
    return;
  }
  const { scheduledDate, ...rest } = body.data;
  const updateData = scheduledDate
    ? { ...rest, scheduledDate: scheduledDate.toISOString().slice(0, 10) }
    : rest;
  const [job] = await db
    .update(jobsTable)
    .set(updateData)
    .where(eq(jobsTable.id, params.data.id))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(await mapJob(job));
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
  res.json(await mapJob(job));
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

router.get("/team", async (_req, res) => {
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

export default router;