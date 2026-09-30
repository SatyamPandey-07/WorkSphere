/**
 * Tests for smart occupancy predictor using historical patterns.
 */

interface OccupancyHistoryEntry {
  dayOfWeek: number;  // 0-6
  hour: number;       // 0-23
  occupancyPct: number;
  count: number;      // number of data points
}

function weightedAvgOccupancy(
  history: OccupancyHistoryEntry[],
  dayOfWeek: number,
  hour: number
): number | null {
  const matching = history.filter((h) => h.dayOfWeek === dayOfWeek && h.hour === hour);
  if (matching.length === 0) return null;
  const totalWeight = matching.reduce((s, h) => s + h.count, 0);
  if (totalWeight === 0) return null;
  const weightedSum = matching.reduce((s, h) => s + h.occupancyPct * h.count, 0);
  return Math.round(weightedSum / totalWeight);
}

function predictBestVisitTime(
  history: OccupancyHistoryEntry[],
  dayOfWeek: number,
  maxOccupancyThreshold = 50
): number[] {
  const hourOccupancies = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    occupancy: weightedAvgOccupancy(history, dayOfWeek, h) ?? 100,
  }));

  return hourOccupancies
    .filter((ho) => ho.occupancy <= maxOccupancyThreshold)
    .sort((a, b) => a.occupancy - b.occupancy)
    .map((ho) => ho.hour);
}

function peakOccupancyTime(
  history: OccupancyHistoryEntry[],
  dayOfWeek: number
): number | null {
  let maxOccupancy = -1;
  let peakHour: number | null = null;

  for (let h = 0; h < 24; h++) {
    const occupancy = weightedAvgOccupancy(history, dayOfWeek, h);
    if (occupancy !== null && occupancy > maxOccupancy) {
      maxOccupancy = occupancy;
      peakHour = h;
    }
  }

  return peakHour;
}

const HISTORY: OccupancyHistoryEntry[] = [
  { dayOfWeek: 1, hour: 9,  occupancyPct: 80, count: 10 },
  { dayOfWeek: 1, hour: 10, occupancyPct: 90, count: 10 },
  { dayOfWeek: 1, hour: 14, occupancyPct: 40, count: 10 },
  { dayOfWeek: 1, hour: 8,  occupancyPct: 20, count: 10 },
];

describe("Smart occupancy predictor", () => {
  it("weightedAvgOccupancy: Mon 9am = 80%", () => {
    expect(weightedAvgOccupancy(HISTORY, 1, 9)).toBe(80);
  });

  it("weightedAvgOccupancy: no data → null", () => {
    expect(weightedAvgOccupancy(HISTORY, 2, 9)).toBeNull();
  });

  it("predictBestVisitTime: 8am (20%) and 2pm (40%) below 50% threshold", () => {
    const bestTimes = predictBestVisitTime(HISTORY, 1);
    expect(bestTimes).toContain(8);
    expect(bestTimes).toContain(14);
    expect(bestTimes).not.toContain(9); // 80% too busy
  });

  it("predictBestVisitTime: sorted by lowest occupancy first", () => {
    const bestTimes = predictBestVisitTime(HISTORY, 1);
    if (bestTimes.length >= 2) {
      const occ0 = weightedAvgOccupancy(HISTORY, 1, bestTimes[0]) ?? 100;
      const occ1 = weightedAvgOccupancy(HISTORY, 1, bestTimes[1]) ?? 100;
      expect(occ0).toBeLessThanOrEqual(occ1);
    }
  });

  it("peakOccupancyTime: Mon peak = 10am (90%)", () => {
    expect(peakOccupancyTime(HISTORY, 1)).toBe(10);
  });

  it("peakOccupancyTime: no history for day → null", () => {
    expect(peakOccupancyTime(HISTORY, 3)).toBeNull();
  });
});
