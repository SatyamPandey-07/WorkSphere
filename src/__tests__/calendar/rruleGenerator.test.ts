import {
  generateICS,
  buildRRule,
  formatDateToICS,
  IcsEventOptions,
} from "@/lib/calendar/icsGenerator";

describe("iCalendar (RFC 5545) RRULE Series Generator", () => {
  const baseStart = new Date("2026-12-01T09:00:00Z");
  const baseEnd = new Date("2026-12-01T17:00:00Z");

  it("formats dates to UTC YYYYMMDDTHHMMSSZ correctly", () => {
    const formatted = formatDateToICS(baseStart);
    expect(formatted).toBe("20261201T090000Z");
  });

  it("generates WEEKLY RRULE with BYDAY and UNTIL parameters", () => {
    const rrule = buildRRule({
      freq: "WEEKLY",
      byDay: ["MO", "WE", "FR"],
      until: new Date("2026-12-31T23:59:59Z"),
    });

    expect(rrule).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231T235959Z",
    );
  });

  it("generates complete .ics string with RRULE and EXDATE for cancelled dates", () => {
    const eventOptions: IcsEventOptions = {
      uid: "booking-series-10294@worksphere.com",
      summary: "Sprint Pod Desk - Hot Desk 4B",
      location: "WorkSphere Mumbai Hub",
      start: baseStart,
      end: baseEnd,
      recurrence: {
        freq: "WEEKLY",
        interval: 1,
        byDay: ["MO", "WE", "FR"],
        until: new Date("2026-12-31T23:59:59Z"),
        exdates: [new Date("2026-12-25T09:00:00Z")],
      },
    };

    const icsContent = generateICS(eventOptions);

    expect(icsContent).toContain("BEGIN:VCALENDAR");
    expect(icsContent).toContain("VERSION:2.0");
    expect(icsContent).toContain("UID:booking-series-10294@worksphere.com");
    expect(icsContent).toContain("DTSTART:20261201T090000Z");
    expect(icsContent).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231T235959Z",
    );
    expect(icsContent).toContain("EXDATE:20261225T090000Z");
    expect(icsContent).toContain("END:VCALENDAR");
  });
});
