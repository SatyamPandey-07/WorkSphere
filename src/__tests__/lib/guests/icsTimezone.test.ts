import {
  buildIcsEventData,
  generateIcsContent,
  wallClockToUtcDate,
  formatIcsUtc,
} from "@/lib/guests/ics-generator";

describe("Preserve Booking Timezones in Guest Calendar Invitations (Issue #10074)", () => {
  describe("wallClockToUtcDate", () => {
    it("should correctly convert Asia/Kolkata (+05:30) booking to UTC instant", () => {
      // 10:00 IST = 04:30 UTC
      const date = wallClockToUtcDate("2026-10-15", "10:00", "Asia/Kolkata");
      const formatted = formatIcsUtc(date);
      expect(formatted).toBe("20261015T043000Z");
    });

    it("should handle America/New_York daylight saving time (EDT, UTC-4 in summer)", () => {
      // 14:00 EDT = 18:00 UTC
      const date = wallClockToUtcDate(
        "2026-07-20",
        "14:00",
        "America/New_York",
      );
      const formatted = formatIcsUtc(date);
      expect(formatted).toBe("20260720T180000Z");
    });

    it("should handle America/New_York standard time (EST, UTC-5 in winter)", () => {
      // 14:00 EST = 19:00 UTC
      const date = wallClockToUtcDate(
        "2026-12-21",
        "14:00",
        "America/New_York",
      );
      const formatted = formatIcsUtc(date);
      expect(formatted).toBe("20261221T190000Z");
    });

    it("should handle Europe/London British Summer Time (BST, UTC+1 in summer)", () => {
      // 10:00 BST = 09:00 UTC
      const date = wallClockToUtcDate("2026-06-15", "10:00", "Europe/London");
      const formatted = formatIcsUtc(date);
      expect(formatted).toBe("20260615T090000Z");
    });

    it("should fall back to UTC when timeZone is omitted or null", () => {
      const date = wallClockToUtcDate("2026-10-15", "10:00", null);
      const formatted = formatIcsUtc(date);
      expect(formatted).toBe("20261015T100000Z");
    });

    it("should fall back to UTC when timeZone is invalid", () => {
      const date = wallClockToUtcDate(
        "2026-10-15",
        "10:00",
        "Invalid/NonExistent_Zone",
      );
      const formatted = formatIcsUtc(date);
      expect(formatted).toBe("20261015T100000Z");
    });
  });

  describe("buildIcsEventData with timeZone", () => {
    const baseParams = {
      bookingId: "booking_kolkata",
      confirmationId: "CONF-KOL-1",
      venueName: "Kolkata Tech Hub",
      venueAddress: "Park Street, Kolkata, India",
      venueLatitude: 22.55,
      venueLongitude: 88.35,
      hostName: "Raj Sharma",
      hostEmail: "raj@example.com",
      guestEmail: "guest@example.com",
      date: "2026-10-15",
      time: "10:00",
      durationMinutes: 90,
      timeZone: "Asia/Kolkata",
    };

    it("should generate UTC timestamps with Z suffix for DTSTART and DTEND", () => {
      const eventData = buildIcsEventData(baseParams);

      // Start: 10:00 IST -> 04:30 UTC
      expect(eventData.startDate).toBe("20261015T043000Z");
      // End: 90 min later -> 11:30 IST -> 06:00 UTC
      expect(eventData.endDate).toBe("20261015T060000Z");
      expect(eventData.timeZone).toBe("Asia/Kolkata");
    });

    it("should produce valid ICS content with UTC DTSTART and DTEND", () => {
      const eventData = buildIcsEventData(baseParams);
      const ics = generateIcsContent(eventData);

      expect(ics).toContain("DTSTART:20261015T043000Z\r\n");
      expect(ics).toContain("DTEND:20261015T060000Z\r\n");
      expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/);
      expect(ics).toContain("Time Zone: Asia/Kolkata");
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("END:VCALENDAR");
    });
  });
});
