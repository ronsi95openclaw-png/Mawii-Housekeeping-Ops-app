import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, employeesTable, jobsTable, jobImportEventsTable } from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { notifyEmployees } from "../lib/notifications";
import { parseScheduleEmail, type ParsedAppointment } from "../lib/elevate-email";

const router: IRouter = Router();

// ElevateOS sends the schedule from hello@elevatedliving.com; matching the sender is far
// steadier than matching a subject line they may reword.
const GMAIL_QUERY = 'from:hello@elevatedliving.com newer_than:30d';
const SOURCE = "elevate_email";

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

/** Gmail returns the body base64url encoded, nested wherever the sender felt like putting it. */
function extractPlainText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
  if (payload.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data);
  for (const part of payload.parts ?? []) {
    const found = extractPlainText(part);
    if (found) return found;
  }
  // Fall back to the HTML body with tags stripped, since some senders skip the text part.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decode(payload.body.data)
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&");
  }
  return "";
}

async function gmail(path: string): Promise<any> {
  const { ReplitConnectors } = await import("@replit/connectors-sdk");
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("google-mail", path);
  if (typeof response?.json === "function") return response.json();
  return response;
}

function checklistPlaceholder() {
  return [] as unknown[];
}

/**
 * Pulls the ElevateOS schedule emails and turns them into jobs. Deduplication is by Gmail
 * message id plus the appointment's position in it, so re-running is always safe.
 */
router.post("/integrations/elevate/gmail-sync", requireRole("owner", "manager"), async (req, res) => {
  try {
    const list = await gmail(`/gmail/v1/users/me/messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=25`);
    const messages: Array<{ id: string }> = list?.messages ?? [];
    if (!messages.length) {
      res.json({ scanned: 0, created: 0, alreadyImported: 0, problems: [] });
      return;
    }

    const created: number[] = [];
    const problems: string[] = [];
    let alreadyImported = 0;

    for (const summary of messages) {
      const message = await gmail(`/gmail/v1/users/me/messages/${summary.id}?format=full`);
      const body = extractPlainText(message?.payload);
      if (!body.trim()) {
        problems.push(`Message ${summary.id} had no readable body`);
        continue;
      }

      const { appointments, problems: parseProblems } = parseScheduleEmail(body);
      problems.push(...parseProblems);

      for (const [index, appointment] of appointments.entries()) {
        const externalId = `${summary.id}:${index}`;
        const [existing] = await db.select({ id: jobsTable.id }).from(jobsTable)
          .where(and(eq(jobsTable.externalSource, SOURCE), eq(jobsTable.externalId, externalId)));
        if (existing) { alreadyImported += 1; continue; }

        const [job] = await db.insert(jobsTable).values({
          clientName: appointment.clientName,
          clientPhone: appointment.clientPhone,
          address: appointment.address,
          scheduledDate: appointment.scheduledDate,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          serviceType: appointment.serviceType,
          serviceVariant: appointment.serviceVariant,
          addOns: appointment.addOns,
          status: "scheduled",
          externalSource: SOURCE,
          externalId,
          teamMemberIds: [],
          checklist: checklistPlaceholder() as never,
          photos: [],
        }).onConflictDoNothing({ target: [jobsTable.externalSource, jobsTable.externalId] }).returning();

        if (!job) { alreadyImported += 1; continue; }
        created.push(job.id);

        await db.insert(jobImportEventsTable).values({
          source: SOURCE,
          externalId,
          success: true,
          message: "Imported from the ElevateOS schedule email",
          jobId: job.id,
        });
      }
    }

    for (const problem of problems) {
      await db.insert(jobImportEventsTable).values({ source: SOURCE, externalId: null, success: false, message: problem });
    }

    if (created.length) {
      const desk = await db.select({ id: employeesTable.id }).from(employeesTable).where(inArray(employeesTable.role, ["owner", "manager"]));
      await notifyEmployees(desk.flatMap(({ id }) => created.map((jobId) => ({
        employeeId: id,
        jobId,
        kind: "import",
        title: "New job from Elevate OS",
        body: "Imported from the schedule email — assign a cleaner.",
      }))));
    }

    res.json({ scanned: messages.length, created: created.length, alreadyImported, problems });
  } catch (error) {
    req.log?.error({ err: error }, "Elevate Gmail sync failed");
    res.status(502).json({ error: "Mawii could not read the Elevate schedule mailbox. Check the Gmail connection in Replit." });
  }
});

export default router;
