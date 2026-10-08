import {
  formatTimeBadge,
  getVenueHoursStatus,
  is24HoursString,
  resolveTimezone,
} from "@/lib/venueHours";

describe("venueHours utility", () => {
  describe("formatTimeBadge", () => {
    it("formats 24-hour time strings to badge friendly 12-hour strings", () => {
      expect(formatTimeBadge("08:00")).toBe("8 AM");
      expect(formatTimeBadge("20:00")).toBe("8 PM");
      expect(formatTimeBadge("12:00")).toBe("12 PM");
      expect(formatTimeBadge("00:00")).toBe("12 AM");
      expect(formatTimeBadge("24:00")).toBe("12 AM");
      expect(formatTimeBadge("09:30")).toBe("9:30 AM");
      expect(formatTimeBadge("17:45")).toBe("5:45 PM");
      expect(formatTimeBadge("02:00")).toBe("2 AM");
    });

    it("handles invalid or empty inputs gracefully", () => {
      expect(formatTimeBadge("")).toBe("");
      expect(formatTimeBadge("invalid")).toBe("invalid");
    });
  });

  describe("is24HoursString", () => {
    it("recognizes various 24/7 string patterns", () => {
      expect(is24HoursString("Open 24 Hours")).toBe(true);
      expect(is24HoursString("open 24 hours")).toBe(true);
      expect(is24HoursString("24/7")).toBe(true);
      expect(is24HoursString("Open 24/7")).toBe(true);
      expect(is24HoursString("00:00 - 24:00")).toBe(true);
      expect(is24HoursString("00:00-00:00")).toBe(true);
      expect(is24HoursString("All Day")).toBe(true);
    });

    it("returns false for non-24-hour ranges", () => {
      expect(is24HoursString("08:00 - 20:00")).toBe(false);
      expect(is24HoursString("10:00 - 18:00")).toBe(false);
    });
  });

  describe("Daylight hours calculations (e.g. 08:00 - 20:00)", () => {
    const hours = "08:00 - 20:00";

    it("returns 'Open Now · Closes 8 PM' during operating hours", () => {
      // 14:30 (2:30 PM)
      const testDate = new Date(2026, 9, 8, 14, 30);
      const status = getVenueHoursStatus(hours, testDate);
      expect(status.isOpen).toBe(true);
      expect(status.badgeText).toBe("Open Now · Closes 8 PM");
      expect(status.closesAt).toBe("8 PM");
      expect(status.status).toBe("open");
    });

    it("returns 'Closed · Opens 8 AM' before morning opening time", () => {
      // 06:15 (6:15 AM)
      const testDate = new Date(2026, 9, 8, 6, 15);
      const status = getVenueHoursStatus(hours, testDate);
      expect(status.isOpen).toBe(false);
      expect(status.badgeText).toBe("Closed · Opens 8 AM");
      expect(status.opensAt).toBe("8 AM");
      expect(status.status).toBe("closed");
    });

    it("returns 'Closed · Opens 8 AM tomorrow' after evening closing time", () => {
      // 21:00 (9:00 PM)
      const testDate = new Date(2026, 9, 8, 21, 0);
      const status = getVenueHoursStatus(hours, testDate);
      expect(status.isOpen).toBe(false);
      expect(status.badgeText).toBe("Closed · Opens 8 AM tomorrow");
      expect(status.opensAt).toBe("8 AM");
      expect(status.status).toBe("closed");
    });
  });

  describe("Late-night / Overnight hours calculations (e.g. 18:00 - 02:00)", () => {
    const hours = "18:00 - 02:00";

    it("returns 'Open Now · Closes 2 AM' before midnight", () => {
      // 22:45 (10:45 PM)
      const testDate = new Date(2026, 9, 8, 22, 45);
      const status = getVenueHoursStatus(hours, testDate);
      expect(status.isOpen).toBe(true);
      expect(status.badgeText).toBe("Open Now · Closes 2 AM");
      expect(status.closesAt).toBe("2 AM");
      expect(status.status).toBe("open");
    });

    it("returns 'Open Now · Closes 2 AM' past midnight before closing", () => {
      // 01:15 (1:15 AM)
      const testDate = new Date(2026, 9, 8, 1, 15);
      const status = getVenueHoursStatus(hours, testDate);
      expect(status.isOpen).toBe(true);
      expect(status.badgeText).toBe("Open Now · Closes 2 AM");
      expect(status.closesAt).toBe("2 AM");
      expect(status.status).toBe("open");
    });

    it("returns 'Closed · Opens 6 PM' in the morning after late-night close", () => {
      // 04:30 (4:30 AM)
      const testDate = new Date(2026, 9, 8, 4, 30);
      const status = getVenueHoursStatus(hours, testDate);
      expect(status.isOpen).toBe(false);
      expect(status.badgeText).toBe("Closed · Opens 6 PM");
      expect(status.opensAt).toBe("6 PM");
      expect(status.status).toBe("closed");
    });
  });

  describe("24/7 venues", () => {
    it("returns 'Open 24 Hours' and isOpen: true for 24/7 venues at any hour", () => {
      const times = [
        new Date(2026, 9, 8, 3, 0),
        new Date(2026, 9, 8, 12, 0),
        new Date(2026, 9, 8, 23, 59),
      ];

      for (const time of times) {
        const status = getVenueHoursStatus("Open 24 Hours", time);
        expect(status.isOpen).toBe(true);
        expect(status.badgeText).toBe("Open 24 Hours");
        expect(status.is24Hours).toBe(true);
        expect(status.status).toBe("24/7");
      }
    });

    it("evaluates identical start and end times as 24-hour open span", () => {
      const times = [
        new Date(2026, 9, 8, 4, 15),
        new Date(2026, 9, 8, 8, 0),
        new Date(2026, 9, 8, 14, 30),
        new Date(2026, 9, 8, 23, 0),
      ];

      for (const time of times) {
        const status1 = getVenueHoursStatus("08:00 - 08:00", time);
        expect(status1.isOpen).toBe(true);
        expect(status1.status).toBe("24/7");
        expect(status1.badgeText).toBe("Open 24 Hours");

        const status2 = getVenueHoursStatus("09:30 - 09:30", time);
        expect(status2.isOpen).toBe(true);
        expect(status2.status).toBe("24/7");
        expect(status2.badgeText).toBe("Open 24 Hours");
      }
    });
  });

  describe("Weekend & Structured weekly schedule", () => {
    const weeklySchedule = JSON.stringify({
      periods: {
        monday: { open: "08:00", close: "18:00", closed: false },
        tuesday: { open: "08:00", close: "18:00", closed: false },
        wednesday: { open: "08:00", close: "18:00", closed: false },
        thursday: { open: "08:00", close: "18:00", closed: false },
        friday: { open: "08:00", close: "18:00", closed: false },
        saturday: { open: "10:00", close: "16:00", closed: false },
        sunday: { open: "00:00", close: "00:00", closed: true },
      },
    });

    it("shows Saturday hours correctly when open on Saturday", () => {
      // Saturday Oct 10, 2026 at 11:30 AM
      const saturdayNoon = new Date(2026, 9, 10, 11, 30);
      const status = getVenueHoursStatus(weeklySchedule, saturdayNoon);
      expect(status.isOpen).toBe(true);
      expect(status.badgeText).toBe("Open Now · Closes 4 PM");
    });

    it("shows opening on Monday when closed on Sunday", () => {
      // Sunday Oct 11, 2026 at 14:00
      const sundayAfternoon = new Date(2026, 9, 11, 14, 0);
      const status = getVenueHoursStatus(weeklySchedule, sundayAfternoon);
      expect(status.isOpen).toBe(false);
      expect(status.badgeText).toBe("Closed · Opens 8 AM Monday");
    });

    it("shows opening on Saturday tomorrow when closed Friday evening", () => {
      // Friday Oct 9, 2026 at 20:00
      const fridayEvening = new Date(2026, 9, 9, 20, 0);
      const status = getVenueHoursStatus(weeklySchedule, fridayEvening);
      expect(status.isOpen).toBe(false);
      expect(status.badgeText).toBe("Closed · Opens 10 AM tomorrow");
    });
  });

  describe("Missing or malformed metadata edge cases", () => {
    it("handles null, undefined, and empty string without breaking", () => {
      expect(getVenueHoursStatus(null)).toEqual({
        isOpen: false,
        badgeText: "",
        status: "unknown",
        isAvailable: false,
      });

      expect(getVenueHoursStatus(undefined)).toEqual({
        isOpen: false,
        badgeText: "",
        status: "unknown",
        isAvailable: false,
      });

      expect(getVenueHoursStatus("")).toEqual({
        isOpen: false,
        badgeText: "",
        status: "unknown",
        isAvailable: false,
      });
    });

    it("falls back gracefully for unstructured custom text", () => {
      const status = getVenueHoursStatus("By appointment only");
      expect(status.isAvailable).toBe(true);
      expect(status.badgeText).toBe("By appointment only");
      expect(status.status).toBe("unknown");
    });

    it("handles null, undefined, empty, or invalid timezone without throwing RangeError", () => {
      const testDate = new Date(2026, 9, 8, 14, 30);
      const hours = "08:00 - 20:00";

      // Null, undefined, empty string timezone
      expect(() => getVenueHoursStatus(hours, testDate, null)).not.toThrow();
      expect(() => getVenueHoursStatus(hours, testDate, undefined)).not.toThrow();
      expect(() => getVenueHoursStatus(hours, testDate, "")).not.toThrow();
      expect(() => getVenueHoursStatus(hours, testDate, "   ")).not.toThrow();

      // Invalid timezone string
      expect(() => getVenueHoursStatus(hours, testDate, "Invalid/Timezone_Name")).not.toThrow();
      expect(() => getVenueHoursStatus(hours, testDate, "XYZ/123")).not.toThrow();

      const statusWithInvalidTz = getVenueHoursStatus(hours, testDate, "Invalid/Timezone_Name");
      expect(statusWithInvalidTz).toBeDefined();
      expect(typeof statusWithInvalidTz.isOpen).toBe("boolean");
    });

    it("handles structured JSON with invalid or missing timezone", () => {
      const testDate = new Date(2026, 9, 8, 14, 30);
      const invalidTzJson = JSON.stringify({
        timezone: "Invalid/Zone",
        periods: {
          thursday: { open: "08:00", close: "20:00", closed: false },
        },
      });

      expect(() => getVenueHoursStatus(invalidTzJson, testDate)).not.toThrow();
      const status = getVenueHoursStatus(invalidTzJson, testDate);
      expect(status.isAvailable).toBe(true);
    });
  });

  describe("resolveTimezone helper", () => {
    it("returns valid IANA timezones intact", () => {
      expect(resolveTimezone("America/New_York")).toBe("America/New_York");
      expect(resolveTimezone("Europe/London")).toBe("Europe/London");
      expect(resolveTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
      expect(resolveTimezone("UTC")).toBe("UTC");
    });

    it("falls back to UTC for null, undefined, empty, or invalid timezones", () => {
      expect(resolveTimezone(null)).toBe("UTC");
      expect(resolveTimezone(undefined)).toBe("UTC");
      expect(resolveTimezone("")).toBe("UTC");
      expect(resolveTimezone("   ")).toBe("UTC");
      expect(resolveTimezone("Mars/Curiosity")).toBe("UTC");
      expect(resolveTimezone("Fake/Timezone")).toBe("UTC");
    });

    it("supports custom fallback timezone", () => {
      expect(resolveTimezone(null, "America/New_York")).toBe("America/New_York");
      expect(resolveTimezone("Invalid/Tz", "Europe/Paris")).toBe("Europe/Paris");
    });
  });
});
