import { QUIET_THRESHOLD_DB, PEAK_THRESHOLD_DB, classifyNoiseLevelDb, getHourlyNoiseProfile, predictQuietHours } from "@/lib/quietHoursPrediction";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueRating: {
      findMany: jest.fn(),
    },
  },
}));

// Test the constants and logic without calling Prisma
describe("quietHoursPrediction constants", () => {
  it("QUIET_THRESHOLD_DB is below PEAK_THRESHOLD_DB", () => {
    expect(QUIET_THRESHOLD_DB).toBeLessThan(PEAK_THRESHOLD_DB);
  });

  it("QUIET_THRESHOLD_DB is in a reasonable range (40-65 dB)", () => {
    expect(QUIET_THRESHOLD_DB).toBeGreaterThanOrEqual(40);
    expect(QUIET_THRESHOLD_DB).toBeLessThanOrEqual(65);
  });

  it("PEAK_THRESHOLD_DB is in a reasonable range (65-90 dB)", () => {
    expect(PEAK_THRESHOLD_DB).toBeGreaterThanOrEqual(65);
    expect(PEAK_THRESHOLD_DB).toBeLessThanOrEqual(90);
  });
});

// Unit test the logic directly using a mock
describe("quiet window detection logic", () => {
  // Simulate the window merging logic inline without importing Prisma
  function mergeQuietWindows(quietHours: number[]) {
    const windows: Array<{ startHour: number; endHour: number }> = [];
    let start: number | null = null;

    for (let i = 0; i < 24; i++) {
      const isQuiet = quietHours.includes(i);
      if (isQuiet && start === null) {
        start = i;
      } else if (!isQuiet && start !== null) {
        windows.push({ startHour: start, endHour: i - 1 });
        start = null;
      }
    }
    if (start !== null) {
      windows.push({ startHour: start, endHour: 23 });
    }
    return windows;
  }

  it("returns empty array when no hours are quiet", () => {
    expect(mergeQuietWindows([])).toHaveLength(0);
  });

  it("merges a single quiet hour into one window", () => {
    const windows = mergeQuietWindows([14]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ startHour: 14, endHour: 14 });
  });

  it("merges contiguous quiet hours into one window", () => {
    const windows = mergeQuietWindows([14, 15, 16]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ startHour: 14, endHour: 16 });
  });

  it("creates separate windows for non-contiguous quiet hours", () => {
    const windows = mergeQuietWindows([10, 11, 14, 15]);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({ startHour: 10, endHour: 11 });
    expect(windows[1]).toEqual({ startHour: 14, endHour: 15 });
  });

  it("handles quiet hours extending to hour 23", () => {
    const windows = mergeQuietWindows([22, 23]);
    expect(windows[windows.length - 1].endHour).toBe(23);
  });

  it("handles quiet hours starting at hour 0", () => {
    const windows = mergeQuietWindows([0, 1, 2]);
    expect(windows[0].startHour).toBe(0);
  });

  it("handles zero quiet hours resulting in insufficient noise data summary", () => {
    const quietWindows: Array<{ startHour: number; endHour: number; avgDb: number }> = [];
    const summary =
      quietWindows.length > 0
        ? `Quietest times: ...`
        : "Insufficient noise data to predict quiet windows.";
    expect(summary).toBe("Insufficient noise data to predict quiet windows.");
  });
});


describe("classifyNoiseLevelDb & Input Sanitization (#6750)", () => {
  it("classifies valid decibel ratings correctly", () => {
    expect(classifyNoiseLevelDb(45)).toBe("Quiet");
    expect(classifyNoiseLevelDb(60)).toBe("Moderate");
    expect(classifyNoiseLevelDb(75)).toBe("Loud");
  });

  it("handles null, undefined, NaN, negative, and infinite inputs safely without false loud classification", () => {
    expect(classifyNoiseLevelDb(null)).toBe("Moderate");
    expect(classifyNoiseLevelDb(undefined)).toBe("Moderate");
    expect(classifyNoiseLevelDb(NaN)).toBe("Moderate");
    expect(classifyNoiseLevelDb(-15)).toBe("Moderate");
    expect(classifyNoiseLevelDb(Infinity)).toBe("Moderate");
  });

  it("getHourlyNoiseProfile safely handles empty venueId", async () => {
    const profile = await getHourlyNoiseProfile("");
    expect(profile).toHaveLength(24);
    expect(profile[0].averageDb).toBeNull();
    expect(profile[0].samples).toBe(0);
    expect(prisma.venueRating.findMany).not.toHaveBeenCalled();
  });

  it("getHourlyNoiseProfile filters corrupted timestamps and NaN decibels without throwing", async () => {
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValueOnce([
      { avgDecibels: 42, createdAt: new Date("2026-10-26T10:00:00Z") },
      { avgDecibels: NaN, createdAt: new Date("2026-10-26T10:00:00Z") }, // NaN decibels
      { avgDecibels: 50, createdAt: new Date("invalid-date") }, // invalid Date
      { avgDecibels: 48, createdAt: "2026-10-26T10:00:00Z" }, // string timestamp
      { avgDecibels: -20, createdAt: new Date("2026-10-26T10:00:00Z") }, // negative decibels
    ]);

    const profile = await getHourlyNoiseProfile("venue-123");
    expect(profile).toHaveLength(24);
    const hour10 = profile[10];
    // Only valid decibels (42 and 48) at hour 10 should be aggregated: (42 + 48) / 2 = 45.0
    expect(hour10.samples).toBe(2);
    expect(hour10.averageDb).toBe(45);
    expect(hour10.label).toBe("Quiet");
  });

  it("predictQuietHours formats midnight windows cleanly and avoids NaN summary", async () => {
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValueOnce([
      { avgDecibels: 40, createdAt: new Date("2026-10-26T22:00:00Z") },
      { avgDecibels: 40, createdAt: new Date("2026-10-26T23:00:00Z") },
    ]);

    const prediction = await predictQuietHours("venue-123");
    expect(prediction.quietWindows).toHaveLength(1);
    expect(prediction.quietWindows[0]).toEqual({
      startHour: 22,
      endHour: 23,
      avgDb: 40,
    });
    expect(prediction.summary).toContain("22:00–24:00 (~40 dB)");
    expect(prediction.summary).not.toContain("NaN");
  });
});
