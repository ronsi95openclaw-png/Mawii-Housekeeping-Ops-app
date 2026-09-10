import { calculatePayoutCents, calculateWorkedMinutes, type TimeEntryInput } from "./time-entries";

export interface ApprovedTimeEntry extends TimeEntryInput {
  approved: boolean;
  employeeId: number;
}

export interface PayoutSummary {
  employeeId: number;
  approvedMinutes: number;
  payoutCents: number;
}

/** Summarize only manager-approved entries, grouped deterministically by worker. */
export function summarizeApprovedPayouts(
  entries: readonly ApprovedTimeEntry[],
  rates: ReadonlyMap<number, number>,
): PayoutSummary[] {
  const totals = new Map<number, { minutes: number; cents: number }>();
  for (const entry of entries) {
    if (!entry.approved) continue;
    const rate = rates.get(entry.employeeId);
    if (rate == null) continue;
    const minutes = calculateWorkedMinutes(entry);
    const current = totals.get(entry.employeeId) ?? { minutes: 0, cents: 0 };
    current.minutes += minutes;
    current.cents += calculatePayoutCents(minutes, rate);
    totals.set(entry.employeeId, current);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([employeeId, total]) => ({ employeeId, approvedMinutes: total.minutes, payoutCents: total.cents }));
}

export function payoutCsv(summaries: readonly PayoutSummary[]): string {
  return [
    "employee_id,approved_minutes,payout_cents",
    ...summaries.map((summary) => `${summary.employeeId},${summary.approvedMinutes},${summary.payoutCents}`),
  ].join("\n") + "\n";
}