/**
 * Tests for venue occupancy trend analysis over time.
 */

interface OccupancySnapshot {
  timestampMs: number;
  occupancyPct: number;
  venueId: string;
}

function occupancyVariance(snapshots: OccupancySnapshot[]): number {
  if (snapshots.length < 2) return 0;
  const values = snapshots.map((s) => s.occupancyPct);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.round(variance * 100) / 100;
}

function hourlyAverages(
  snapshots: OccupancySnapshot[],
  venueId: string
): Record<number, number> {
  const hourBuckets: Record<number, number[]> = {};
  for (const s of snapshots.filter((s) => s.venueId === venueId)) {
    const hour = new Date(s.timestampMs).getUTCHours();
    if (!hourBuckets[hour]) hourBuckets[hour] = [];
    hourBuckets[hour].push(s.occupancyPct);
  }
  const averages: Record<number, number> = {};
  for (const [hour, values] of Object.entries(hourBuckets)) {
    averages[Number(hour)] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }
  return averages;
}

function peakOccupancyHour(averages: Record<number, number>): number | null {
  const entries = Object.entries(averages);
  if (entries.length === 0) return null;
  return Number(entries.reduce((max, cur) => Number(cur[1]) > Number(max[1]) ? cur : max)[0]);
}

function trendSlope(snapshots: OccupancySnapshot[]): number {
  if (snapshots.length < 2) return 0;
  const n = snapshots.length;
  const sorted = [...snapshots].sort((a, b) => a.timestampMs - b.timestampMs);
  const xs = sorted.map((_, i) => i);
  const ys = sorted.map((s) => s.occupancyPct);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((sum, x, i) => sum + (x - xMean) * (ys[i] - yMean), 0);
  const den = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  return den === 0 ? 0 : Math.round((num / den) * 100) / 100;
}

const NOW = 1_700_000_000_000;
const SNAPSHOTS: OccupancySnapshot[] = [
  { timestampMs: NOW - 7200_000, occupancyPct: 20, venueId: "v1" },
  { timestampMs: NOW - 3600_000, occupancyPct: 50, venueId: "v1" },
  { timestampMs: NOW,            occupancyPct: 80, venueId: "v1" },
];

describe("Venue occupancy trend", () => {
  it("occupancyVariance: 3 different values", () => {
    expect(occupancyVariance(SNAPSHOTS)).toBeGreaterThan(0);
  });

  it("occupancyVariance: single snapshot → 0", () => {
    expect(occupancyVariance([SNAPSHOTS[0]])).toBe(0);
  });

  it("trendSlope: increasing occupancy → positive slope", () => {
    expect(trendSlope(SNAPSHOTS)).toBeGreaterThan(0);
  });

  it("trendSlope: single snapshot → 0", () => {
    expect(trendSlope([SNAPSHOTS[0]])).toBe(0);
  });

  it("trendSlope: flat → 0", () => {
    const flat = SNAPSHOTS.map((s) => ({ ...s, occupancyPct: 50 }));
    expect(trendSlope(flat)).toBe(0);
  });

  it("hourlyAverages: returns averages per hour", () => {
    const avgs = hourlyAverages(SNAPSHOTS, "v1");
    expect(Object.keys(avgs).length).toBeGreaterThan(0);
  });

  it("peakOccupancyHour: returns hour with max avg", () => {
    const avgs = { 9: 30, 12: 80, 17: 60 };
    expect(peakOccupancyHour(avgs)).toBe(12);
  });

  it("peakOccupancyHour: empty → null", () => {
    expect(peakOccupancyHour({})).toBeNull();
  });
});
