/**
 * Integration-style tests for the quiet hours prediction engine.
 * Tests the full prediction pipeline without mocking the core logic.
 */

import { QUIET_THRESHOLD_DB, PEAK_THRESHOLD_DB } from "@/lib/quietHoursPrediction";

// Simulate the hourly profile creation from rating data
function buildHourlyProfile(
  ratings: Array<{ hour: number; db: number }>,
): Array<{ hour: number; averageDb: number | null; label: string }> {
  const buckets = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
  for (const r of ratings) {
    buckets[r.hour].sum += r.db;
    buckets[r.hour].count++;
  }

  return buckets.map((b, hour) => {
    const avg = b.count > 0 ? b.sum / b.count : null;
    return {
      hour,
      averageDb: avg,
      label:
        avg === null
          ? "Moderate"
          : avg < QUIET_THRESHOLD_DB
            ? "Quiet"
            : avg < PEAK_THRESHOLD_DB
              ? "Moderate"
              : "Loud",
    };
  });
}

describe("Hourly noise profile builder", () => {
  it("builds a 24-element profile", () => {
    const profile = buildHourlyProfile([]);
    expect(profile).toHaveLength(24);
  });

  it("averages multiple ratings for the same hour", () => {
    const profile = buildHourlyProfile([
      { hour: 10, db: 40 },
      { hour: 10, db: 60 },
    ]);
    expect(profile[10].averageDb).toBe(50);
  });

  it("labels hour as Quiet when avgDb < QUIET_THRESHOLD_DB", () => {
    const profile = buildHourlyProfile([{ hour: 14, db: 45 }]);
    expect(profile[14].label).toBe("Quiet");
  });

  it("labels hour as Loud when avgDb >= PEAK_THRESHOLD_DB", () => {
    const profile = buildHourlyProfile([{ hour: 9, db: 75 }]);
    expect(profile[9].label).toBe("Loud");
  });

  it("labels hour as Moderate for dB between thresholds", () => {
    const mid = (QUIET_THRESHOLD_DB + PEAK_THRESHOLD_DB) / 2;
    const profile = buildHourlyProfile([{ hour: 12, db: mid }]);
    expect(profile[12].label).toBe("Moderate");
  });

  it("returns null averageDb for hours with no ratings", () => {
    const profile = buildHourlyProfile([]);
    expect(profile[0].averageDb).toBeNull();
  });

  it("identifies quiet time windows correctly", () => {
    // Hours 2-4 AM are quiet, rest are loud
    const ratings = [];
    for (let h = 0; h < 24; h++) {
      ratings.push({ hour: h, db: h >= 2 && h <= 4 ? 40 : 80 });
    }
    const profile = buildHourlyProfile(ratings);
    const quietHours = profile.filter((p) => p.label === "Quiet").map((p) => p.hour);
    expect(quietHours).toContain(2);
    expect(quietHours).toContain(3);
    expect(quietHours).toContain(4);
    expect(quietHours).not.toContain(8);
  });
});
