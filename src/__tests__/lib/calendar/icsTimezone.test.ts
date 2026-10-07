import {
  formatDateTimeForCalendar,
  generateICSContent,
  generateBulkICSContent,
} from "@/lib/calendar/ics";
import { getCalendarUrls } from "@/lib/calendar";

describe("timezone-aware calendar times", () => {
  it("converts a Kolkata booking (UTC+5:30) to the matching UTC time", () => {
    expect(
      formatDateTimeForCalendar("2026-07-20", "14:30", 60, "Asia/Kolkata"),
    ).toEqual({ start: "20260720T090000Z", end: "20260720T100000Z" });
  });

  it("handles daylight saving: New York summer (EDT) and winter (EST)", () => {
    expect(
      formatDateTimeForCalendar("2026-07-20", "10:00", 60, "America/New_York")
        .start,
    ).toBe("20260720T140000Z");
    expect(
      formatDateTimeForCalendar("2026-01-15", "10:00", 60, "America/New_York")
        .start,
    ).toBe("20260115T150000Z");
  });

  it("converts Tokyo (UTC+9)", () => {
    expect(
      formatDateTimeForCalendar("2026-03-10", "09:00", 30, "Asia/Tokyo"),
    ).toEqual({ start: "20260310T000000Z", end: "20260310T003000Z" });
  });

  it("falls back to a valid time for an unknown timezone name", () => {
    expect(
      formatDateTimeForCalendar("2026-07-20", "14:30", 60, "Not/AZone").start,
    ).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it("writes the converted UTC time into the .ics file", () => {
    const ics = generateICSContent(
      "Focus Space",
      "100 Tech Blvd",
      "2026-07-20",
      "14:30",
      {
        durationMinutes: 60,
        confirmationId: "WS-TZ-1",
        timezone: "Asia/Kolkata",
      },
    );
    expect(ics).toContain("DTSTART:20260720T090000Z");
    expect(ics).toContain("DTEND:20260720T100000Z");
  });

  it("uses each booking's own timezone in the bulk export", () => {
    const ics = generateBulkICSContent([
      {
        venueName: "A",
        venueAddress: "1 Main St",
        date: "2026-07-20",
        time: "14:30",
        duration: 60,
        confirmationId: "WS-A",
        timeZone: "Asia/Kolkata",
      },
      {
        venueName: "B",
        venueAddress: "2 Main St",
        date: "2026-07-20",
        time: "10:00",
        duration: 60,
        confirmationId: "WS-B",
        timeZone: "America/New_York",
      },
    ]);
    expect(ics).toContain("DTSTART:20260720T090000Z");
    expect(ics).toContain("DTSTART:20260720T140000Z");
  });

  it("builds the Google Calendar link from the booking's timezone", () => {
    const { googleUrl } = getCalendarUrls(
      "Hub",
      "1 Main St",
      "2026-07-20",
      "14:30",
      120,
      "Asia/Kolkata",
    );
    expect(googleUrl).toContain("dates=20260720T090000Z/20260720T110000Z");
  });
});
