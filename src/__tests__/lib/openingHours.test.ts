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
});
