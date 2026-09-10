export type ChecklistState = { completed?: boolean };
export type ProofState = { kind: string };

export const incidentStatuses = ["open", "in_review", "resolved", "reclean"] as const;
export type IncidentStatus = (typeof incidentStatuses)[number];

export const payPeriodStatuses = ["draft", "approved", "paid"] as const;
export type PayPeriodStatus = (typeof payPeriodStatuses)[number];

export function canCompleteJob(checklist: ChecklistState[], photos: ProofState[]) {
  return checklist.every((item) => item.completed === true)
    && photos.some((photo) => photo.kind === "before")
    && photos.some((photo) => photo.kind === "after");
}

export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus) {
  if (from === to) return false;
  return (
    (from === "open" && to === "in_review") ||
    (from === "in_review" && (to === "resolved" || to === "reclean")) ||
    (from === "reclean" && (to === "in_review" || to === "resolved"))
  );
}

export function canTransitionPayPeriod(from: PayPeriodStatus, to: PayPeriodStatus) {
  return (from === "draft" && to === "approved") || (from === "approved" && to === "paid");
}

export function isChronologicalTimeEntry(clockIn: Date, clockOut: Date) {
  return clockOut.getTime() >= clockIn.getTime();
}

export function isValidBreakMinutes(clockIn: Date, clockOut: Date | null | undefined, breaksMinutes: number, now = new Date()) {
  if (!Number.isInteger(breaksMinutes) || breaksMinutes < 0) return false;
  const end = clockOut ?? now;
  if (!isChronologicalTimeEntry(clockIn, end)) return false;
  const workedMinutes = Math.floor((end.getTime() - clockIn.getTime()) / 60_000);
  return breaksMinutes <= workedMinutes;
}

export function isValidCorrectionMinutes(clockIn: Date, clockOut: Date | null | undefined, breaksMinutes: number, correctionMinutes: number) {
  if (!clockOut || !isChronologicalTimeEntry(clockIn, clockOut)) return false;
  if (!Number.isInteger(breaksMinutes) || breaksMinutes < 0) return false;
  if (!Number.isInteger(correctionMinutes)) return false;
  const elapsedMinutes = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60_000);
  return breaksMinutes <= elapsedMinutes && elapsedMinutes - breaksMinutes + correctionMinutes >= 0;
}