export type RecurrenceFrequency = "weekly" | "biweekly" | "monthly" | "every_n_weeks";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  intervalWeeks?: number;
}

/** Generate calendar dates without mutating the input date or depending on local timezone. */
export function generateOccurrences(start: string, rule: RecurrenceRule, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) throw new Error("count must be a non-negative integer");
  const step = rule.frequency === "weekly" ? 7 : rule.frequency === "biweekly" ? 14 : rule.frequency === "every_n_weeks" ? (rule.intervalWeeks ?? 0) * 7 : 0;
  if (rule.frequency === "every_n_weeks" && (!Number.isInteger(rule.intervalWeeks) || rule.intervalWeeks! < 1)) {
    throw new Error("intervalWeeks must be at least 1");
  }
  const [year, month, day] = start.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(current.getTime())) throw new Error("start must be YYYY-MM-DD");
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(current);
    if (rule.frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + index);
    else date.setUTCDate(date.getUTCDate() + step * index);
    return date.toISOString().slice(0, 10);
  });
}

export function nextOccurrence(after: string, rule: RecurrenceRule): string {
  return generateOccurrences(after, rule, 2)[1]!;
}