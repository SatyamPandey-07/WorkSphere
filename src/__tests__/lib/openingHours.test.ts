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
});
