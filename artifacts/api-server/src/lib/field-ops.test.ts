import { describe, expect, it } from "vitest";
import { generateOccurrences } from "./recurrence";
import { calculateWorkedMinutes, calculatePayoutCents } from "./time-entries";
import { canManageOperations, canAccessAssignedJob } from "./authorization";
import { payoutCsv, summarizeApprovedPayouts } from "./payouts";
import { normalizeMessageIntent } from "./messages";
import { hasRole } from "./authorization";
import { canCompleteJob, canTransitionIncident, canTransitionPayPeriod, isChronologicalTimeEntry } from "./operations-rules";

describe("field operations services", () => {
  it("generates weekly and monthly occurrences", () => {
    expect(generateOccurrences("2026-01-05", { frequency: "weekly" }, 3)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
    expect(generateOccurrences("2026-01-15", { frequency: "monthly" }, 2)).toEqual(["2026-01-15", "2026-02-15"]);
  });
  it("supports biweekly and every-N recurrence without duplicate dates", () => {
    expect(generateOccurrences("2026-01-01", { frequency: "biweekly" }, 3)).toEqual(["2026-01-01", "2026-01-15", "2026-01-29"]);
    const dates = generateOccurrences("2026-01-01", { frequency: "every_n_weeks", intervalWeeks: 3 }, 4);
    expect(new Set(dates).size).toBe(4);
    expect(dates[3]).toBe("2026-03-05");
  });
  it("subtracts breaks and applies approved correction", () => {
    expect(calculateWorkedMinutes({ clockIn: new Date("2026-01-01T09:00Z"), clockOut: new Date("2026-01-01T12:00Z"), breaksMinutes: 15, correctionMinutes: 10 })).toBe(175);
    expect(calculatePayoutCents(120, 20)).toBe(4000);
  });
  it("enforces role and assignment boundaries", () => {
    expect(canManageOperations("manager")).toBe(true);
    expect(canAccessAssignedJob("cleaner", [3], 3)).toBe(true);
    expect(canAccessAssignedJob("cleaner", [3], 4)).toBe(false);
    expect(hasRole("unknown", ["owner", "manager"])).toBe(false);
  });
  it("summarizes approved payout and exports CSV", () => {
    const summaries = summarizeApprovedPayouts([{ employeeId: 2, approved: true, clockIn: new Date("2026-01-01T09:00Z"), clockOut: new Date("2026-01-01T10:00Z") }], new Map([[2, 15]]));
    expect(summaries[0]?.payoutCents).toBe(1500);
    expect(payoutCsv(summaries)).toContain("2,60,1500");
  });
  it("normalizes legacy messages to honest provider-neutral defaults", () => {
    expect(normalizeMessageIntent({ recipient: "client", body: "Hello" })).toMatchObject({
      channel: "sms", audience: "customer", recipient: "client", body: "Hello",
    });
    expect(normalizeMessageIntent({ recipient: "team", body: "Shift changed", channel: "whatsapp", audience: "employee" })).toMatchObject({
      channel: "whatsapp", audience: "employee", recipient: "team",
    });
  });
  it("blocks completion until checklist and both proof stages exist", () => {
    expect(canCompleteJob([{ completed: true }], [{ kind: "before" }, { kind: "after" }])).toBe(true);
    expect(canCompleteJob([{ completed: false }], [{ kind: "before" }, { kind: "after" }])).toBe(false);
    expect(canCompleteJob([{ completed: true }], [{ kind: "before" }])).toBe(false);
  });
  it("allows only forward incident review transitions", () => {
    expect(canTransitionIncident("open", "in_review")).toBe(true);
    expect(canTransitionIncident("in_review", "resolved")).toBe(true);
    expect(canTransitionIncident("open", "resolved")).toBe(false);
    expect(canTransitionIncident("resolved", "open")).toBe(false);
  });
  it("enforces pay-period lifecycle and chronological clocks", () => {
    expect(canTransitionPayPeriod("draft", "approved")).toBe(true);
    expect(canTransitionPayPeriod("approved", "paid")).toBe(true);
    expect(canTransitionPayPeriod("draft", "paid")).toBe(false);
    expect(isChronologicalTimeEntry(new Date("2026-01-01T09:00Z"), new Date("2026-01-01T10:00Z"))).toBe(true);
    expect(isChronologicalTimeEntry(new Date("2026-01-01T10:00Z"), new Date("2026-01-01T09:00Z"))).toBe(false);
  });
});