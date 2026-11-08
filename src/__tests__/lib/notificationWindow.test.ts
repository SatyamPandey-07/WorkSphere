/**
 * Tests for notification window time constraints (#6718).
 */

import { isWithinNotificationWindow } from "@/lib/notificationWindow";

describe("Notification window checking", () => {
  it("null window = always within window", () => {
    expect(isWithinNotificationWindow(new Date(), null, null, "UTC")).toBe(true);
    expect(isWithinNotificationWindow(new Date(), "09:00", null, "UTC")).toBe(true);
    expect(isWithinNotificationWindow(new Date(), null, "18:00", "UTC")).toBe(true);
    expect(isWithinNotificationWindow(new Date(), "", "", "UTC")).toBe(true);
  });

  it("within 9:00-18:00 window", () => {
    const noon = new Date("2026-09-30T12:00:00Z");
    expect(isWithinNotificationWindow(noon, "09:00", "18:00", "UTC")).toBe(true);
  });

  it("before 9:00-18:00 window", () => {
    const early = new Date("2026-09-30T07:00:00Z");
    expect(isWithinNotificationWindow(early, "09:00", "18:00", "UTC")).toBe(false);
  });

  it("after 9:00-18:00 window", () => {
    const late = new Date("2026-09-30T20:00:00Z");
    expect(isWithinNotificationWindow(late, "09:00", "18:00", "UTC")).toBe(false);
  });

  it("exactly at window start is within", () => {
    const startTime = new Date("2026-09-30T09:00:00Z");
    expect(isWithinNotificationWindow(startTime, "09:00", "18:00", "UTC")).toBe(true);
  });

  it("exactly at window end is within", () => {
    const endTime = new Date("2026-09-30T18:00:00Z");
    expect(isWithinNotificationWindow(endTime, "09:00", "18:00", "UTC")).toBe(true);
  });

  describe("extended notification window options (#6718)", () => {
    it("handles 12-hour AM/PM formats", () => {
      const morning = new Date("2026-09-30T10:00:00Z"); // 10:00 AM UTC
      const night = new Date("2026-09-30T21:00:00Z"); // 9:00 PM UTC

      expect(isWithinNotificationWindow(morning, "9:00 AM", "5:00 PM", "UTC")).toBe(true);
      expect(isWithinNotificationWindow(night, "9:00 AM", "5:00 PM", "UTC")).toBe(false);
      expect(isWithinNotificationWindow(morning, "09:00am", "05:00pm", "UTC")).toBe(true);
    });

    it("handles time strings with seconds (SQL/ISO formats)", () => {
      const afternoon = new Date("2026-09-30T14:30:00Z");
      expect(isWithinNotificationWindow(afternoon, "09:00:00", "18:00:00", "UTC")).toBe(true);
      expect(isWithinNotificationWindow(afternoon, "09:00:00 AM", "05:00:00 PM", "UTC")).toBe(true);

      const evening = new Date("2026-09-30T19:30:00Z");
      expect(isWithinNotificationWindow(evening, "09:00:00", "18:00:00", "UTC")).toBe(false);
    });

    it("evaluates overnight windows correctly across midnight", () => {
      // 22:00 to 06:00 window (10 PM to 6 AM)
      const lateNight = new Date("2026-09-30T23:30:00Z"); // 11:30 PM UTC
      const earlyMorning = new Date("2026-09-30T04:00:00Z"); // 4:00 AM UTC
      const afternoon = new Date("2026-09-30T15:00:00Z"); // 3:00 PM UTC

      expect(isWithinNotificationWindow(lateNight, "22:00", "06:00", "UTC")).toBe(true);
      expect(isWithinNotificationWindow(earlyMorning, "22:00", "06:00", "UTC")).toBe(true);
      expect(isWithinNotificationWindow(afternoon, "22:00", "06:00", "UTC")).toBe(false);

      // Same overnight window in 12-hour format
      expect(isWithinNotificationWindow(lateNight, "10:00 PM", "6:00 AM", "UTC")).toBe(true);
      expect(isWithinNotificationWindow(afternoon, "10:00 PM", "6:00 AM", "UTC")).toBe(false);
    });

    it("evaluates continuous 24-hour windows as always allowed", () => {
      const midday = new Date("2026-09-30T13:45:00Z");

      // 00:00 to 00:00 or 12:00 AM to 12:00 AM denotes continuous notifications
      expect(isWithinNotificationWindow(midday, "00:00", "00:00", "UTC")).toBe(true);
      expect(isWithinNotificationWindow(midday, "12:00 AM", "12:00 AM", "UTC")).toBe(true);
      expect(isWithinNotificationWindow(midday, "00:00", "24:00", "UTC")).toBe(true);
    });

    it("respects recipient timezone", () => {
      // 15:00 UTC = 11:00 AM EDT (America/New_York, UTC-4)
      const instant = new Date("2026-09-30T15:00:00Z");

      // In New York, local time is 11:00 AM -> within 09:00 - 17:00
      expect(isWithinNotificationWindow(instant, "09:00", "17:00", "America/New_York")).toBe(true);

      // In Tokyo (UTC+9), local time is 00:00 (midnight next day) -> outside 09:00 - 17:00
      expect(isWithinNotificationWindow(instant, "09:00", "17:00", "Asia/Tokyo")).toBe(false);
    });

    it("falls back to UTC on invalid timezone without throwing", () => {
      const noon = new Date("2026-09-30T12:00:00Z");
      expect(isWithinNotificationWindow(noon, "09:00", "18:00", "Invalid/Timezone")).toBe(true);
    });

    it("safely defaults to true when time string cannot be parsed", () => {
      const now = new Date("2026-09-30T12:00:00Z");
      expect(isWithinNotificationWindow(now, "invalid-time", "18:00", "UTC")).toBe(true);
      expect(isWithinNotificationWindow(now, "09:00", "not-a-time", "UTC")).toBe(true);
    });
  });
});
