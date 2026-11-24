import {
  getLocalHourInTimeZone,
  isNightOwlReview,
} from "@/app/api/analytics/route";

describe("Night Owl Badge Timezone Calculation", () => {
  describe("isNightOwlReview Boundary Conditions", () => {
    const timeZone = "Asia/Kolkata"; // UTC+05:30

    it("does not qualify reviews at 20:59 local time", () => {
      // 20:59 IST is 15:29 UTC
      const date = new Date("2026-08-10T15:29:00.000Z");
      expect(getLocalHourInTimeZone(date, timeZone)).toBe(20);
      expect(isNightOwlReview(date, timeZone)).toBe(false);
    });

    it("qualifies reviews at exactly 21:00 local time (threshold)", () => {
      // 21:00 IST is 15:30 UTC
      const date = new Date("2026-08-10T15:30:00.000Z");
      expect(getLocalHourInTimeZone(date, timeZone)).toBe(21);
      expect(isNightOwlReview(date, timeZone)).toBe(true);
    });

    it("qualifies reviews in the middle of the night (e.g. 02:00)", () => {
      // 02:00 IST is 20:30 UTC (previous calendar day)
      const date = new Date("2026-08-10T20:30:00.000Z");
      expect(getLocalHourInTimeZone(date, timeZone)).toBe(2);
      expect(isNightOwlReview(date, timeZone)).toBe(true);
    });

    it("qualifies reviews at 04:59 local time", () => {
      // 04:59 IST is 23:29 UTC (previous day)
      const date = new Date("2026-08-10T23:29:00.000Z");
      expect(getLocalHourInTimeZone(date, timeZone)).toBe(4);
      expect(isNightOwlReview(date, timeZone)).toBe(true);
    });

    it("does not qualify reviews at 05:00 local time", () => {
      // 05:00 IST is 23:30 UTC (previous day)
      const date = new Date("2026-08-10T23:30:00.000Z");
      expect(getLocalHourInTimeZone(date, timeZone)).toBe(5);
      expect(isNightOwlReview(date, timeZone)).toBe(false);
    });

    it("does not qualify reviews during standard working daytime hours (e.g. 14:00)", () => {
      // 14:00 IST is 08:30 UTC
      const date = new Date("2026-08-10T08:30:00.000Z");
      expect(getLocalHourInTimeZone(date, timeZone)).toBe(14);
      expect(isNightOwlReview(date, timeZone)).toBe(false);
    });
  });

  describe("Multi-Timezone and Daylight Saving Time Robustness", () => {
    it("differentiates night vs day across opposite timezones for the same instant", () => {
      // Instant: 2026-08-10T16:00:00.000Z
      // In Asia/Kolkata (+5:30): 21:30 (Night Owl! >= 21)
      // In America/New_York (-4:00 EDT): 12:00 noon (Daytime! NOT Night Owl)
      const instant = new Date("2026-08-10T16:00:00.000Z");

      expect(isNightOwlReview(instant, "Asia/Kolkata")).toBe(true);
      expect(isNightOwlReview(instant, "America/New_York")).toBe(false);
    });

    it("evaluates correctly during New York Daylight Saving Time (EDT, UTC-4)", () => {
      // Summer EDT: 21:15 EDT is 2026-07-15T01:15:00.000Z (next day UTC)
      const summerReview = new Date("2026-07-15T01:15:00.000Z");
      expect(getLocalHourInTimeZone(summerReview, "America/New_York")).toBe(21);
      expect(isNightOwlReview(summerReview, "America/New_York")).toBe(true);
    });

    it("evaluates correctly during New York Standard Time (EST, UTC-5)", () => {
      // Winter EST: 21:15 EST is 2026-12-15T02:15:00.000Z (next day UTC)
      const winterReview = new Date("2026-12-15T02:15:00.000Z");
      expect(getLocalHourInTimeZone(winterReview, "America/New_York")).toBe(21);
      expect(isNightOwlReview(winterReview, "America/New_York")).toBe(true);
    });
  });

  describe("Fallback Behavior for Missing or Invalid Timezones", () => {
    it("falls back cleanly to UTC when timezone is null, undefined or empty", () => {
      // 22:00 UTC
      const date = new Date("2026-08-10T22:00:00.000Z");
      expect(isNightOwlReview(date, null)).toBe(true);
      expect(isNightOwlReview(date, undefined)).toBe(true);
      expect(isNightOwlReview(date, "")).toBe(true);
    });

    it("falls back cleanly to UTC when timezone string is malformed or invalid", () => {
      const date = new Date("2026-08-10T22:00:00.000Z");
      expect(isNightOwlReview(date, "Invalid/Timezone_Name")).toBe(true);
    });

    it("returns safe non-night-owl default for invalid Date objects", () => {
      expect(isNightOwlReview(new Date("invalid-date"), "Asia/Kolkata")).toBe(
        false,
      );
    });
  });
});
