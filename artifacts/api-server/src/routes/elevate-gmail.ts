import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, employeesTable, jobsTable, jobImportEventsTable } from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { notifyEmployees } from "../lib/notifications";
import { parseScheduleEmail, type ParsedAppointment } from "../lib/elevate-email";

const router: IRouter = Router();

// That sender also mails marketing and notices, so the subject narrows it to schedules.
// Recent mail only, and past dates are skipped, so a first run cannot backfill the board
// with jobs that already happened.
const SENDER = "hello@elevatedliving.com";
const buildQuery = (days: number) => `from:${SENDER} subject:schedule newer_than:${days}d`;
const SOURCE = "elevate_email";
// When this server started. A stale bundle is the most common cause of a "fix" not landing,
// and this makes that visible from the phone instead of guessable.
const SERVER_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: Array<{ name?: string; value?: string }> };

/**
 * Picks the part of the message that actually holds the schedule. Elevate's plain text part
 * contains only the preview line ("Bookings for tomorrow"), with the real content in HTML,
 * so preferring text/plain returned something useless.
 */
function decodeBody(data?: string): string {
  return data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "";
}

function collectCandidates(payload: GmailPart | undefined, found: string[] = []): string[] {
  if (!payload) return found;
  if (payload.mimeType === "text/plain" && payload.body?.data) found.push(decodeBody(payload.body.data));
  if (payload.mimeType === "text/html" && payload.body?.data) found.push(htmlToText(decodeBody(payload.body.data)));
  for (const part of payload.parts ?? []) collectCandidates(part, found);
  return found;
}

/** A schedule mentions its labels and a time window; a preheader mentions neither. */
function scheduleScore(text: string): number {
  let score = 0;
  if (/location\s*:/i.test(text)) score += 2;
  if (/client\s*:/i.test(text)) score += 2;
  if (/appointment\s*:/i.test(text)) score += 2;
  if (/\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]/.test(text)) score += 3;
  return score;
}

function extractPlainText(payload: GmailPart | undefined): string {
  const candidates = collectCandidates(payload).filter((text) => text.trim());
  if (!candidates.length) return "";
  return candidates
    .map((text) => ({ text, score: scheduleScore(text), length: text.length }))
    .sort((a, b) => b.score - a.score || b.length - a.length)[0]!.text;
}

/** Elevate's mail is table-based HTML, so every block boundary has to become a newline. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|h[1-6]|li|table|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, index, lines) => line !== "" || (lines[index - 1] ?? "") !== "")
    .join("\n");
}

async function gmail(path: string): Promise<any> {
  const sdk: any = await import("@replit/connectors-sdk");
  const Connectors = sdk.ReplitConnectors ?? sdk.default?.ReplitConnectors ?? sdk.Connectors;
  if (typeof Connectors !== "function") {
    throw new Error(`Connector SDK exports ${Object.keys(sdk).join(", ") || "nothing usable"}`);
  }
  const connectors = new Connectors();
  const response = await connectors.proxy("google-mail", path);
  if (response && typeof response.json === "function") {
    if (typeof response.ok === "boolean" && !response.ok) {
      throw new Error(`Gmail returned ${response.status} for ${path}: ${(await response.text()).slice(0, 300)}`);
    }
    return response.json();
  }
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
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 60);
    const includePast = req.query.includePast === "true";
    // The crew works Central time; a UTC "today" rolls over at 7pm and would skip the very
    // jobs this sync exists to import.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const list = await gmail(`/gmail/v1/users/me/messages?q=${encodeURIComponent(buildQuery(days))}&maxResults=25`);
    const messages: Array<{ id: string }> = list?.messages ?? [];
    if (!messages.length) {
      res.json({ scanned: 0, created: 0, alreadyImported: 0, skippedPast: 0, problems: [], serverStartedAt: SERVER_STARTED_AT });
      return;
    }

    const created: number[] = [];
    const problems: string[] = [];
    let alreadyImported = 0;
    let skippedPast = 0;

    for (const summary of messages) {
      const message = await gmail(`/gmail/v1/users/me/messages/${summary.id}?format=full`);
      const body = extractPlainText(message?.payload);
      if (!body.trim()) {
        problems.push(`Message ${summary.id} had no readable body`);
        continue;
      }

      const subject = (message?.payload?.headers ?? []).find((header: any) => header?.name?.toLowerCase() === "subject")?.value ?? "";
      const { appointments, problems: parseProblems } = parseScheduleEmail(body, subject);
      // Include a little of what was actually read, otherwise a parse failure is a guessing game.
      problems.push(...parseProblems.map((problem) => `${problem} (read: ${body.replace(/\s+/g, " ").slice(0, 160)}…)`));

      for (const [index, appointment] of appointments.entries()) {
        if (!includePast && appointment.scheduledDate < today) { skippedPast += 1; continue; }
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

    res.json({ scanned: messages.length, created: created.length, alreadyImported, skippedPast, problems, serverStartedAt: SERVER_STARTED_AT });
  } catch (error) {
    req.log?.error({ err: error }, "Elevate Gmail sync failed");
    // This route is owner/manager only and the detail is what makes a connector failure
    // diagnosable from the phone rather than the server log.
    res.status(502).json({
      error: "Mawii could not read the Elevate schedule mailbox. Check the Gmail connection in Replit.",
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});

export default router;
