import {
  formatDateTimeForCalendar,
  generateICSContent,
} from "@/lib/calendar";

describe("formatDateTimeForCalendar", () => {
  it("returns empty strings when date or time is missing", () => {
    expect(formatDateTimeForCalendar("", "10:00")).toEqual({
      start: "",
      end: "",
    });
    expect(formatDateTimeForCalendar("2026-07-20", "")).toEqual({
      start: "",
      end: "",
    });
  });

  it("uses the given duration in minutes for DTEND", () => {
    const oneHour = formatDateTimeForCalendar("2026-07-20", "09:00", 60);
    const twoHours = formatDateTimeForCalendar("2026-07-20", "09:00", 120);

    expect(oneHour.start).toBeTruthy();
    expect(oneHour.end).toBeTruthy();
    expect(twoHours.start).toBe(oneHour.start);
    expect(twoHours.end).not.toBe(oneHour.end);
  });
});

describe("generateICSContent", () => {
  const ics = generateICSContent(
    "Indie Desk Hub",
    "42 Market Street, Austin",
    "2026-07-20",
    "14:30",
    90,
    "WS-#482910",
  );

  it("uses CRLF line endings", () => {
    expect(ics.includes("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("includes required VCALENDAR / VEVENT markers", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("puts venue address, duration, and confirmation id in SUMMARY", () => {
    expect(ics).toContain("SUMMARY:");
    expect(ics).toContain("Indie Desk Hub");
    expect(ics).toContain("90 min");
    expect(ics).toContain("WS-#482910");
    expect(ics).toContain("42 Market Street");
  });

  it("sets LOCATION to the venue address", () => {
    expect(ics).toContain("LOCATION:42 Market Street\\, Austin");
  });

  it("returns empty string for invalid date/time", () => {
    expect(generateICSContent("X", "Y", "", "10:00")).toBe("");
  });
});
