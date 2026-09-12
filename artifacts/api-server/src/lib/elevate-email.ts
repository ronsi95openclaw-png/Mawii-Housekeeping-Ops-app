/**
 * Parses the daily schedule emails ElevateOS sends to the office mailbox.
 *
 * The format is a greeting, a date line, then one block per appointment. Everything here
 * is deliberately forgiving: this is someone else's template and it will change without
 * warning, so a block that cannot be read is reported rather than silently dropped.
 */

export type ParsedAppointment = {
  scheduledDate: string;
  startTime: string;
  endTime: string;
  clientName: string;
  clientPhone: string | null;
  address: string;
  serviceType: string;
  serviceVariant: string | null;
  addOns: string[];
};

export type ParseResult = {
  appointments: ParsedAppointment[];
  problems: string[];
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Saturday, September 12th, 2026" -> "2026-09-12" */
export function parseScheduleDate(line: string): string | null {
  const match = /([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(line);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]!.toLowerCase());
  if (month < 0) return null;
  const day = Number(match[2]);
  if (!day || day > 31) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "11:00 AM" -> "11:00", "4:30 PM" -> "16:30" */
export function parseClockTime(value: string): string | null {
  const match = /(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?/.exec(value);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 12 || minute > 59) return null;
  const isAfternoon = match[3]!.toLowerCase() === "p";
  if (hour === 12) hour = 0;
  if (isAfternoon) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const SERVICE_PATTERNS: Array<[RegExp, string]> = [
  [/move\s*[-/]?\s*(in|out)/i, "Move In/Out cleaning"],
  [/deep/i, "Deep cleaning"],
  [/standard|regular|maintenance/i, "Standard cleaning"],
];

export function normalizeServiceType(text: string): string {
  for (const [pattern, serviceType] of SERVICE_PATTERNS) {
    if (pattern.test(text)) return serviceType;
  }
  return "Standard cleaning";
}

/** Elevate writes "Inside Kitchen Cabinets" where Mawii says "Inside Cabinets". */
const ADD_ON_ALIASES: Array<[RegExp, string]> = [
  [/laundry/i, "Laundry"],
  [/oven/i, "Inside Oven"],
  [/fridge|refrigerator/i, "Inside Fridge"],
  [/cabinet/i, "Inside Cabinets"],
];

export function normalizeAddOns(text: string): string[] {
  const found = new Set<string>();
  for (const part of text.split(/[,•·|]/)) {
    for (const [pattern, addOn] of ADD_ON_ALIASES) {
      if (pattern.test(part)) found.add(addOn);
    }
  }
  return [...found];
}

const NEXT_LABEL = /^\s*(Location|Client|Appointment|Notes)\s*:?\s*$/i;

function labelled(block: string, label: string): string | null {
  const pattern = new RegExp(`^\\s*${label}\\s*:?\\s*$`, "im");
  const lines = block.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index >= 0) {
    // Elevate's HTML is a table, so a multi-line address gets a blank line between each
    // row once converted to text — that must not end the section early, only skip it.
    const collected: string[] = [];
    for (const line of lines.slice(index + 1)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (NEXT_LABEL.test(trimmed)) break;
      collected.push(trimmed);
    }
    return collected.join(", ") || null;
  }
  const inline = new RegExp(`${label}\\s*:\\s*(.+)`, "i").exec(block);
  return inline ? inline[1]!.trim() : null;
}

export function parseScheduleEmail(body: string, subject = ""): ParseResult {
  const text = body.replace(/ /g, " ");
  const problems: string[] = [];

  // The subject carries the same date ("Your schedule for Saturday, September 12th, 2026"),
  // so it rescues a body whose markup hid the greeting line.
  const scheduledDate = parseScheduleDate(text) ?? parseScheduleDate(subject);
  if (!scheduledDate) {
    return { appointments: [], problems: ["No schedule date found in the email or its subject"] };
  }

  // Each appointment starts with its own time window line.
  const windowPattern = /(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)\s*[–—-]\s*(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)/g;
  const starts: Array<{ index: number; start: string; end: string }> = [];
  for (const match of text.matchAll(windowPattern)) {
    const start = parseClockTime(match[1]!);
    const end = parseClockTime(match[2]!);
    if (start && end) starts.push({ index: match.index ?? 0, start, end });
  }

  if (!starts.length) {
    return { appointments: [], problems: [`No appointment time windows found for ${scheduledDate}`] };
  }

  const appointments: ParsedAppointment[] = [];
  starts.forEach((entry, position) => {
    const block = text.slice(entry.index, starts[position + 1]?.index ?? text.length);
    const location = labelled(block, "Location");
    const client = labelled(block, "Client");
    const appointment = labelled(block, "Appointment");

    if (!location || !client) {
      problems.push(`Appointment at ${entry.start} on ${scheduledDate} was missing its ${!location ? "location" : "client"}`);
      return;
    }

    const [clientName, ...phoneParts] = client.split(/[•·|]/);
    const phoneDigits = phoneParts.join(" ").replace(/[^\d+]/g, "");

    appointments.push({
      scheduledDate,
      startTime: entry.start,
      endTime: entry.end,
      clientName: clientName!.trim(),
      clientPhone: phoneDigits || null,
      // Elevate puts the contact name first, then the street address.
      address: location.replace(/^[^,]+,\s*/, "").trim() || location.trim(),
      serviceType: normalizeServiceType(appointment ?? ""),
      serviceVariant: appointment?.split(/[•·|]/)[0]?.trim() || null,
      addOns: appointment ? normalizeAddOns(appointment.split(/[•·|]/).slice(1).join(",")) : [],
    });
  });

  return { appointments, problems };
}
