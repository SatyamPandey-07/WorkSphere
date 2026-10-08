import {
  parseStructuredHours,
  formatTime12h,
  getOpeningHoursStatus,
  StructuredHours,
} from "../../lib/openingHours";

describe("Timezone-aware opening hours helper logic", () => {
  const sampleStructured: StructuredHours = {
    timezone: "America/New_York",
    periods: {
      monday: { open: "09:00", close: "17:00", closed: false },
      tuesday: { open: "09:00", close: "17:00", closed: false },
      wednesday: { open: "09:00", close: "17:00", closed: false },
      thursday: { open: "09:00", close: "17:00", closed: false },
      friday: { open: "09:00", close: "17:00", closed: false },
      saturday: { open: "10:00", close: "14:00", closed: false },
      sunday: { open: "00:00", close: "00:00", closed: true },
    },
  };

  const serialized = JSON.stringify(sampleStructured);

  it("parses valid structured hours JSON", () => {
    const parsed = parseStructuredHours(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed?.timezone).toBe("America/New_York");
    expect(parsed?.periods.monday.open).toBe("09:00");
  });

  it("returns null for invalid/legacy strings", () => {
    expect(parseStructuredHours("Mon-Fri: 9am - 5pm")).toBeNull();
    expect(parseStructuredHours(null)).toBeNull();
  });

  it("formats 24h time strings to 12h format", () => {
    expect(formatTime12h("09:00")).toBe("9:00 AM");
    expect(formatTime12h("13:30")).toBe("1:30 PM");
    expect(formatTime12h("23:59")).toBe("11:59 PM");
    expect(formatTime12h("00:05")).toBe("12:05 AM");
  });

  it("evaluates current open/close status in the target timezone", () => {
    // We override status check by providing UTC timezone to bypass server-dependent locale tests
    const utcStructured: StructuredHours = {
      timezone: "UTC",
      periods: {
        monday: { open: "00:00", close: "23:59", closed: false },
        tuesday: { open: "00:00", close: "23:59", closed: false },
        wednesday: { open: "00:00", close: "23:59", closed: false },
        thursday: { open: "00:00", close: "23:59", closed: false },
        friday: { open: "00:00", close: "23:59", closed: false },
        saturday: { open: "00:00", close: "23:59", closed: false },
        sunday: { open: "00:00", close: "23:59", closed: false },
      },
    };
    const status = getOpeningHoursStatus(JSON.stringify(utcStructured));
    expect(status.isStructured).toBe(true);
    expect(status.isOpen).toBe(true);
  });

  it("returns isOpen: true during Sunday early morning when Saturday overnight shift is active until 04:00 and Sunday is closed", () => {
    const overnightSchedule: StructuredHours = {
      timezone: "UTC",
      periods: {
        monday: { open: "09:00", close: "17:00", closed: false },
        tuesday: { open: "09:00", close: "17:00", closed: false },
        wednesday: { open: "09:00", close: "17:00", closed: false },
        thursday: { open: "09:00", close: "17:00", closed: false },
        friday: { open: "09:00", close: "17:00", closed: false },
        saturday: { open: "20:00", close: "04:00", closed: false },
        sunday: { open: "00:00", close: "00:00", closed: true },
      },
    };

    // Sunday, Oct 4, 2026 at 02:30 UTC (during the Saturday overnight shift until 04:00)
    const sundayEarlyMorning = new Date(Date.UTC(2026, 9, 4, 2, 30, 0));
    const statusOpen = getOpeningHoursStatus(
      JSON.stringify(overnightSchedule),
      "UTC",
      sundayEarlyMorning,
    );
    expect(statusOpen.isOpen).toBe(true);
    expect(statusOpen.displayString).toContain("Open until 4:00 AM");

    // Sunday, Oct 4, 2026 at 05:00 UTC (after the Saturday overnight shift ends)
    const sundayAfternoon = new Date(Date.UTC(2026, 9, 4, 5, 0, 0));
    const statusClosed = getOpeningHoursStatus(
      JSON.stringify(overnightSchedule),
      "UTC",
      sundayAfternoon,
    );
    expect(statusClosed.isOpen).toBe(false);
    expect(statusClosed.displayString).toContain("Closed Today");
  });

  it("prioritizes active overnight shift display string even when today also has open operating hours", () => {
    const overnightWithOpenToday: StructuredHours = {
      timezone: "UTC",
      periods: {
        monday: { open: "09:00", close: "17:00", closed: false },
        tuesday: { open: "09:00", close: "17:00", closed: false },
        wednesday: { open: "09:00", close: "17:00", closed: false },
        thursday: { open: "09:00", close: "17:00", closed: false },
        friday: { open: "09:00", close: "17:00", closed: false },
        saturday: { open: "20:00", close: "04:00", closed: false },
        sunday: { open: "09:00", close: "17:00", closed: false },
      },
    };

    // Sunday, Oct 4, 2026 at 02:30 UTC (during Saturday overnight shift until 04:00, before Sunday 09:00 opens)
    const sundayEarlyMorning = new Date(Date.UTC(2026, 9, 4, 2, 30, 0));
    const status = getOpeningHoursStatus(
      JSON.stringify(overnightWithOpenToday),
      "UTC",
      sundayEarlyMorning,
    );
    expect(status.isOpen).toBe(true);
    expect(status.displayString).toBe("Open until 4:00 AM (UTC)");
  });

  it("handles missing weekday from formatToParts gracefully without TypeError", () => {
    const originalFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;
    Intl.DateTimeFormat.prototype.formatToParts = jest.fn().mockReturnValue([
      { type: "hour", value: "10" },
      { type: "minute", value: "30" },
    ]);

    try {
      const status = getOpeningHoursStatus(serialized, "America/New_York");
      expect(status.isStructured).toBe(true);
      expect(status.isOpen).toBe(false);
      expect(status.displayString).toBe("Closed Today (America/New_York)");
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = originalFormatToParts;
    }
  });

  it("handles structured hours with missing days or partial periods gracefully", () => {
    const partialStructured = {
      timezone: "UTC",
      periods: {
        monday: { open: "09:00", close: "17:00", closed: false },
      },
    };
    // Tuesday date
    const tuesday = new Date(Date.UTC(2026, 9, 6, 12, 0, 0));
    const status = getOpeningHoursStatus(
      JSON.stringify(partialStructured),
      "UTC",
      tuesday,
    );
    expect(status.isStructured).toBe(true);
    expect(status.isOpen).toBe(false);
    expect(status.displayString).toBe("Closed Today (UTC)");
  });

  describe("Daylight Saving Time (DST) transition handling (#5039)", () => {
    it("correctly evaluates open/closed status for America/New_York during spring forward (23h day)", () => {
      const nySchedule = JSON.stringify({
        timezone: "America/New_York",
        periods: {
          sunday: { open: "09:00", close: "17:00", closed: false },
        },
      });

      // Sunday, March 8, 2026: clocks jump from 02:00 EST to 03:00 EDT (UTC-4)
      // 12:30 UTC = 08:30 EDT (before open)
      const beforeOpen = new Date("2026-03-08T12:30:00Z");
      expect(getOpeningHoursStatus(nySchedule, undefined, beforeOpen).isOpen).toBe(false);

      // 13:30 UTC = 09:30 EDT (after open)
      const afterOpen = new Date("2026-03-08T13:30:00Z");
      expect(getOpeningHoursStatus(nySchedule, undefined, afterOpen).isOpen).toBe(true);

      // 20:30 UTC = 16:30 EDT (before close)
      const beforeClose = new Date("2026-03-08T20:30:00Z");
      expect(getOpeningHoursStatus(nySchedule, undefined, beforeClose).isOpen).toBe(true);

      // 21:30 UTC = 17:30 EDT (after close)
      const afterClose = new Date("2026-03-08T21:30:00Z");
      expect(getOpeningHoursStatus(nySchedule, undefined, afterClose).isOpen).toBe(false);
    });

    it("correctly evaluates open/closed status for America/New_York during fall back (25h day)", () => {
      const nySchedule = JSON.stringify({
        timezone: "America/New_York",
        periods: {
          sunday: { open: "09:00", close: "17:00", closed: false },
        },
      });

      // Sunday, November 1, 2026: clocks repeat 01:00 EST (UTC-5)
      // 13:30 UTC = 08:30 EST (before open)
      const beforeOpen = new Date("2026-11-01T13:30:00Z");
      expect(getOpeningHoursStatus(nySchedule, undefined, beforeOpen).isOpen).toBe(false);

      // 14:30 UTC = 09:30 EST (after open)
      const afterOpen = new Date("2026-11-01T14:30:00Z");
      expect(getOpeningHoursStatus(nySchedule, undefined, afterOpen).isOpen).toBe(true);

      // 21:30 UTC = 16:30 EST (before close)
      const beforeClose = new Date("2026-11-01T21:30:00Z");
      expect(getOpeningHoursStatus(nySchedule, undefined, beforeClose).isOpen).toBe(true);

      // 22:30 UTC = 17:30 EST (after close)
      const afterClose = new Date("2026-11-01T22:30:00Z");
      expect(getOpeningHoursStatus(nySchedule, undefined, afterClose).isOpen).toBe(false);
    });

    it("correctly evaluates open/closed status for Europe/London during spring forward (23h day)", () => {
      const londonSchedule = JSON.stringify({
        timezone: "Europe/London",
        periods: {
          sunday: { open: "08:00", close: "18:00", closed: false },
        },
      });

      // Sunday, March 29, 2026: clocks jump from 01:00 GMT to 02:00 BST (UTC+1)
      // 06:30 UTC = 07:30 BST (before open)
      const beforeOpen = new Date("2026-03-29T06:30:00Z");
      expect(getOpeningHoursStatus(londonSchedule, undefined, beforeOpen).isOpen).toBe(false);

      // 07:30 UTC = 08:30 BST (after open)
      const afterOpen = new Date("2026-03-29T07:30:00Z");
      expect(getOpeningHoursStatus(londonSchedule, undefined, afterOpen).isOpen).toBe(true);

      // 16:30 UTC = 17:30 BST (before close)
      const beforeClose = new Date("2026-03-29T16:30:00Z");
      expect(getOpeningHoursStatus(londonSchedule, undefined, beforeClose).isOpen).toBe(true);

      // 17:30 UTC = 18:30 BST (after close)
      const afterClose = new Date("2026-03-29T17:30:00Z");
      expect(getOpeningHoursStatus(londonSchedule, undefined, afterClose).isOpen).toBe(false);
    });

    it("correctly evaluates open/closed status for Europe/London during fall back (25h day)", () => {
      const londonSchedule = JSON.stringify({
        timezone: "Europe/London",
        periods: {
          sunday: { open: "08:00", close: "18:00", closed: false },
        },
      });

      // Sunday, October 25, 2026: clocks fall back from 02:00 BST to 01:00 GMT (UTC+0)
      // 07:30 UTC = 07:30 GMT (before open)
      const beforeOpen = new Date("2026-10-25T07:30:00Z");
      expect(getOpeningHoursStatus(londonSchedule, undefined, beforeOpen).isOpen).toBe(false);

      // 08:30 UTC = 08:30 GMT (after open)
      const afterOpen = new Date("2026-10-25T08:30:00Z");
      expect(getOpeningHoursStatus(londonSchedule, undefined, afterOpen).isOpen).toBe(true);

      // 17:30 UTC = 17:30 GMT (before close)
      const beforeClose = new Date("2026-10-25T17:30:00Z");
      expect(getOpeningHoursStatus(londonSchedule, undefined, beforeClose).isOpen).toBe(true);

      // 18:30 UTC = 18:30 GMT (after close)
      const afterClose = new Date("2026-10-25T18:30:00Z");
      expect(getOpeningHoursStatus(londonSchedule, undefined, afterClose).isOpen).toBe(false);
    });

    it("handles overnight shifts spanning spring-forward DST shifts in America/New_York and Europe/London", () => {
      const nyOvernight = JSON.stringify({
        timezone: "America/New_York",
        periods: {
          saturday: { open: "22:00", close: "04:00", closed: false },
          sunday: { open: "00:00", close: "00:00", closed: true },
        },
      });

      // Sunday, March 8, 2026 at 06:30 UTC = 01:30 EST (open)
      expect(getOpeningHoursStatus(nyOvernight, undefined, new Date("2026-03-08T06:30:00Z")).isOpen).toBe(true);
      // Sunday, March 8, 2026 at 07:30 UTC = 03:30 EDT (open after 2->3 jump)
      expect(getOpeningHoursStatus(nyOvernight, undefined, new Date("2026-03-08T07:30:00Z")).isOpen).toBe(true);
      // Sunday, March 8, 2026 at 08:30 UTC = 04:30 EDT (closed after 04:00 close)
      expect(getOpeningHoursStatus(nyOvernight, undefined, new Date("2026-03-08T08:30:00Z")).isOpen).toBe(false);

      const londonOvernight = JSON.stringify({
        timezone: "Europe/London",
        periods: {
          saturday: { open: "21:00", close: "03:00", closed: false },
          sunday: { open: "00:00", close: "00:00", closed: true },
        },
      });

      // Sunday, March 29, 2026 at 00:30 UTC = 00:30 GMT (open)
      expect(getOpeningHoursStatus(londonOvernight, undefined, new Date("2026-03-29T00:30:00Z")).isOpen).toBe(true);
      // Sunday, March 29, 2026 at 01:30 UTC = 02:30 BST (open after 1->2 jump)
      expect(getOpeningHoursStatus(londonOvernight, undefined, new Date("2026-03-29T01:30:00Z")).isOpen).toBe(true);
      // Sunday, March 29, 2026 at 02:30 UTC = 03:30 BST (closed after 03:00 close)
      expect(getOpeningHoursStatus(londonOvernight, undefined, new Date("2026-03-29T02:30:00Z")).isOpen).toBe(false);
    });

    it("defaults to UTC when timezone is unspecified, avoiding server timezone leakage", () => {
      const scheduleWithoutTz = JSON.stringify({
        periods: {
          sunday: { open: "10:00", close: "18:00", closed: false },
        },
      });

      // Sunday, Oct 11, 2026 at 12:00 UTC (open)
      const openUtc = new Date("2026-10-11T12:00:00Z");
      const statusOpen = getOpeningHoursStatus(scheduleWithoutTz, undefined, openUtc);
      expect(statusOpen.isOpen).toBe(true);
      expect(statusOpen.displayString).toContain("(UTC)");

      // Sunday, Oct 11, 2026 at 08:00 UTC (closed)
      const closedUtc = new Date("2026-10-11T08:00:00Z");
      const statusClosed = getOpeningHoursStatus(scheduleWithoutTz, undefined, closedUtc);
      expect(statusClosed.isOpen).toBe(false);
      expect(statusClosed.displayString).toContain("(UTC)");
    });
  });
});
