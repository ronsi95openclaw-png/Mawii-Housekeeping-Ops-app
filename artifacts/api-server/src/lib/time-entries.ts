export interface TimeEntryInput {
  clockIn: Date;
  clockOut?: Date | null;
  breaksMinutes?: number;
  correctionMinutes?: number;
}

/** Billable minutes are never negative, and corrections are explicit signed minutes. */
export function calculateWorkedMinutes(entry: TimeEntryInput): number {
  const end = entry.clockOut ?? new Date();
  const elapsed = Math.floor((end.getTime() - entry.clockIn.getTime()) / 60_000);
  const breaks = entry.breaksMinutes ?? 0;
  const correction = entry.correctionMinutes ?? 0;
  if (elapsed < 0 || breaks < 0) throw new Error("invalid time entry");
  return Math.max(0, elapsed - breaks + correction);
}

export function calculatePayoutCents(minutes: number, hourlyRate: number): number {
  if (minutes < 0 || hourlyRate < 0) throw new Error("minutes and hourlyRate must be non-negative");
  return Math.round((minutes / 60) * hourlyRate * 100);
}