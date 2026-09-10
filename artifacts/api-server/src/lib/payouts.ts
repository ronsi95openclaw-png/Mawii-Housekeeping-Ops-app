import { calculatePayoutCents, calculateWorkedMinutes, type TimeEntryInput } from "./time-entries";

export function parsePayoutAmountCents(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  const match = text.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;
  const cents = whole * 100 + fraction;
  return match[1] === "-" ? -cents : cents;
}

export function formatPayoutAmountCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

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