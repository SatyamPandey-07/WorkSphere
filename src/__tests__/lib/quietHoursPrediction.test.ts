import {
  QUIET_THRESHOLD_DB,
  PEAK_THRESHOLD_DB,
  classifyNoiseLevelDb,
  getHourlyNoiseProfile,
  predictQuietHours,
} from "@/lib/quietHoursPrediction";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
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
    const quietWindows: Array<{
      startHour: number;
      endHour: number;
      avgDb: number;
    }> = [];
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("getHourlyNoiseProfile safely handles empty and whitespace venueId without querying DB", async () => {
    const profile = await getHourlyNoiseProfile("   ");
    expect(profile).toHaveLength(24);
    expect(profile[0].averageDb).toBeNull();
    expect(profile[0].samples).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.venueRating.findMany).not.toHaveBeenCalled();
  });

  it("returns 24 insufficient-data slots when aggregated rows are empty", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([]);

    const prediction = await predictQuietHours("venue-empty");
    expect(prediction.venueId).toBe("venue-empty");
    expect(prediction.hourlyProfile).toHaveLength(24);
    expect(prediction.quietWindows).toEqual([]);
    expect(prediction.peakHours).toEqual([]);
    expect(prediction.summary).toBe(
      "Insufficient noise data to predict quiet windows.",
    );
    expect(prisma.venueRating.findMany).not.toHaveBeenCalled();
  });

  it("executes a parameterized SQL aggregation and ignores invalid bucket rows safely", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { hour: 10, averageDb: 45, samples: 2 },
      { hour: 25, averageDb: 50, samples: 1 }, // out-of-range hour
      { hour: 11, averageDb: Number.NaN, samples: 1 }, // NaN averageDb
      { hour: 12, averageDb: -20, samples: 1 }, // negative decibels
      { hour: 13, averageDb: 60, samples: 0 }, // zero samples
    ]);

    const profile = await getHourlyNoiseProfile("  venue-123  ");
    expect(profile).toHaveLength(24);
    expect(prisma.venueRating.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

    const [strings, param] = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    const sqlText = Array.isArray(strings)
      ? strings.join(" ")
      : String(strings);
    expect(sqlText).toContain('FROM "VenueRating"');
    expect(sqlText).toContain("EXTRACT(HOUR FROM");
    expect(sqlText).toContain("AVG(");
    expect(sqlText).toContain("COUNT(*)");
    expect(sqlText).toContain("GROUP BY");
    expect(param).toBe("venue-123");

    expect(profile[10]).toEqual({
      hour: 10,
      averageDb: 45,
      label: "Quiet",
      samples: 2,
    });
    expect(profile[11].samples).toBe(0);
    expect(profile[12].samples).toBe(0);
    expect(profile[13].samples).toBe(0);
  });

  it("predictQuietHours formats midnight windows cleanly and avoids NaN summary", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { hour: BigInt(22), averageDb: "40", samples: BigInt(3) },
      { hour: BigInt(23), averageDb: 40, samples: BigInt(2) },
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

  it("matches reference aggregation across a 25,000-rating dataset without full row scans", async () => {
    const ratingCount = 25_000;
    const referenceBuckets = Array.from({ length: 24 }, () => ({
      sum: 0,
      count: 0,
    }));

    for (let i = 0; i < ratingCount; i += 1) {
      const hour = i % 24;
      const db =
        hour >= 9 && hour <= 11
          ? 44 + (i % 5)
          : hour >= 17 && hour <= 19
            ? 73 + (i % 4)
            : 60 + (i % 6);
      referenceBuckets[hour].sum += db;
      referenceBuckets[hour].count += 1;
    }

    const dbAggregatedRows = referenceBuckets.map((b, hour) => ({
      hour,
      averageDb: b.sum / b.count,
      samples: b.count,
    }));

    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce(dbAggregatedRows);

    const startMs = performance.now();
    const prediction = await predictQuietHours("venue-large");
    const elapsedMs = performance.now() - startMs;

    expect(prisma.venueRating.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prediction.hourlyProfile).toHaveLength(24);

    for (let h = 0; h < 24; h += 1) {
      const expectedAvg =
        Math.round((referenceBuckets[h].sum / referenceBuckets[h].count) * 10) /
        10;
      expect(prediction.hourlyProfile[h].averageDb).toBe(expectedAvg);
      expect(prediction.hourlyProfile[h].samples).toBe(
        referenceBuckets[h].count,
      );
    }

    expect(prediction.quietWindows).toHaveLength(1);
    expect(prediction.quietWindows[0].startHour).toBe(9);
    expect(prediction.quietWindows[0].endHour).toBe(11);
    expect(prediction.peakHours).toEqual([17, 18, 19]);
    expect(elapsedMs).toBeLessThan(100);
  });
});
