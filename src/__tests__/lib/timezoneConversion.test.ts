/**
 * Tests for timezone offset calculation for booking display.
 */

function getUtcOffset(timezone: string): number {
  // Use a known epoch time to get the offset in minutes
  const date = new Date(1_700_000_000_000);
  const localTime = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
  const utcTime = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((localTime.getTime() - utcTime.getTime()) / 60_000);
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60).toString().padStart(2, "0");
  const m = (abs % 60).toString().padStart(2, "0");
  return `UTC${sign}${h}:${m}`;
}

function convertToTimezone(utcMs: number, timezone: string): string {
  return new Date(utcMs).toLocaleString("en-US", { timeZone: timezone });
}

describe("Timezone offset display", () => {
  it("UTC offset is 0 for UTC", () => {
    expect(getUtcOffset("UTC")).toBe(0);
  });

  it("formatOffset: +330 → UTC+05:30", () => {
    expect(formatOffset(330)).toBe("UTC+05:30");
  });

  it("formatOffset: -300 → UTC-05:00", () => {
    expect(formatOffset(-300)).toBe("UTC-05:00");
  });

  it("formatOffset: 0 → UTC+00:00", () => {
    expect(formatOffset(0)).toBe("UTC+00:00");
  });

  it("formatOffset: 60 → UTC+01:00", () => {
    expect(formatOffset(60)).toBe("UTC+01:00");
  });

  it("convertToTimezone returns non-empty string", () => {
    const result = convertToTimezone(1_700_000_000_000, "UTC");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("UTC offset for America/New_York is negative in November", () => {
    // America/New_York is UTC-5 in winter (EST) - just check it's negative
    const offset = getUtcOffset("America/New_York");
    expect(offset).toBeLessThan(0);
  });

  it("UTC offset for Asia/Kolkata is +330", () => {
    expect(getUtcOffset("Asia/Kolkata")).toBe(330);
  });
});
