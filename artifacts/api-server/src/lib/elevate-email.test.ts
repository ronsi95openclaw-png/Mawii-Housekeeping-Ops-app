import { describe, expect, it } from "vitest";
import { parseClockTime, parseScheduleDate, normalizeAddOns, normalizeServiceType, parseScheduleEmail } from "./elevate-email";

const SINGLE_JOB_EMAIL = `Hi Ronnie!

Here is your schedule for Saturday, September 12th, 2026:

11:00 AM – 4:30 PM (CDT)

Location:
Cadia Sherman, 3800 W Lamberth Rd
Sherman, TX
Apt 7703

Client:
Terese Jordan • +16264870205

Appointment:
2 bed/2 bath Deep Clean • Inside Oven, Inside Fridge, Inside Kitchen Cabinets
`;

const TWO_JOB_EMAIL = `${SINGLE_JOB_EMAIL}
5:00 PM – 7:00 PM (CDT)

Location:
Mint Flats, 88 Oak St
Dallas, TX

Client:
Andre Cole • +12145550101

Appointment:
1 bed/1 bath Standard Clean • Laundry
`;

describe("elevate schedule email", () => {
  it("reads the date, ordinal suffix and all", () => {
    expect(parseScheduleDate("Here is your schedule for Saturday, September 12th, 2026:")).toBe("2026-09-12");
    expect(parseScheduleDate("Monday, March 3rd, 2026")).toBe("2026-03-03");
    expect(parseScheduleDate("no date here")).toBeNull();
  });

  it("converts clock times to 24 hour", () => {
    expect(parseClockTime("11:00 AM")).toBe("11:00");
    expect(parseClockTime("4:30 PM")).toBe("16:30");
    expect(parseClockTime("12:15 AM")).toBe("00:15");
    expect(parseClockTime("12:15 PM")).toBe("12:15");
  });

  it("maps Elevate's service and add-on wording onto Mawii's", () => {
    expect(normalizeServiceType("2 bed/2 bath Deep Clean")).toBe("Deep cleaning");
    expect(normalizeServiceType("Move-Out Clean")).toBe("Move In/Out cleaning");
    // "Inside Kitchen Cabinets" is Elevate's name for what Mawii calls "Inside Cabinets".
    expect(normalizeAddOns("Inside Oven, Inside Fridge, Inside Kitchen Cabinets")).toEqual([
      "Inside Oven",
      "Inside Fridge",
      "Inside Cabinets",
    ]);
  });

  it("parses a single appointment", () => {
    const { appointments, problems } = parseScheduleEmail(SINGLE_JOB_EMAIL);
    expect(problems).toEqual([]);
    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({
      scheduledDate: "2026-09-12",
      startTime: "11:00",
      endTime: "16:30",
      clientName: "Terese Jordan",
      clientPhone: "+16264870205",
      serviceType: "Deep cleaning",
    });
    expect(appointments[0]!.address).toContain("3800 W Lamberth Rd");
    expect(appointments[0]!.address).toContain("Apt 7703");
    expect(appointments[0]!.addOns).toEqual(["Inside Oven", "Inside Fridge", "Inside Cabinets"]);
  });

  it("parses every appointment when a day carries more than one", () => {
    const { appointments, problems } = parseScheduleEmail(TWO_JOB_EMAIL);
    expect(problems).toEqual([]);
    expect(appointments).toHaveLength(2);
    expect(appointments[1]).toMatchObject({
      startTime: "17:00",
      endTime: "19:00",
      clientName: "Andre Cole",
      serviceType: "Standard cleaning",
    });
    expect(appointments[1]!.addOns).toEqual(["Laundry"]);
  });

  it("keeps a multi-line address intact across the blank lines a real table produces", () => {
    // Elevate's mail is an HTML table; converting </td></tr><tr><td> boundaries to text
    // leaves a blank line between each address row. A real import once truncated the
    // address to just its first line because of this.
    const emailWithTableGaps = `Here is your schedule for Saturday, September 12th, 2026:

11:00 AM – 4:30 PM (CDT)

Location:

Cadia Sherman, 3800 W Lamberth Rd

Sherman, TX

Apt 7703

Client:

Terese Jordan • +16264870205

Appointment:

2 bed/2 bath Deep Clean • Inside Oven, Inside Fridge, Inside Kitchen Cabinets
`;
    const { appointments, problems } = parseScheduleEmail(emailWithTableGaps);
    expect(problems).toEqual([]);
    expect(appointments[0]!.address).toBe("3800 W Lamberth Rd, Sherman, TX, Apt 7703");
  });

  it("reports an unreadable email instead of dropping it quietly", () => {
    expect(parseScheduleEmail("Hello, nothing useful here").problems).toHaveLength(1);
    expect(parseScheduleEmail("Saturday, September 12th, 2026").problems[0]).toContain("No appointment time windows");
  });
});
