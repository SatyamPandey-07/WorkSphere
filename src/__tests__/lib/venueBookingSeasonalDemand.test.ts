/**
 * Tests for venue seasonal demand modeling.
 */

interface SeasonalDemandData {
  month: number;     // 1-12
  historicalAvgBookings: number;
  historicalAvgRevenueCents: number;
  isHolidaySeason: boolean;
}

function overallSeasonalityIndex(data: SeasonalDemandData[]): Record<number, number> {
  if (data.length === 0) return {};
  const avgBookings = data.reduce((s, d) => s + d.historicalAvgBookings, 0) / data.length;
  const result: Record<number, number> = {};
  data.forEach((d) => {
    result[d.month] = Math.round((d.historicalAvgBookings / Math.max(1, avgBookings)) * 100) / 100;
  });
  return result;
}

function peakMonths(data: SeasonalDemandData[], thresholdIndex = 1.1): number[] {
  const indices = overallSeasonalityIndex(data);
  return Object.entries(indices)
    .filter(([, idx]) => idx >= thresholdIndex)
    .map(([month]) => Number(month));
}

function offPeakMonths(data: SeasonalDemandData[], thresholdIndex = 0.9): number[] {
  const indices = overallSeasonalityIndex(data);
  return Object.entries(indices)
    .filter(([, idx]) => idx <= thresholdIndex)
    .map(([month]) => Number(month));
}

function revenueSeasonalityScore(data: SeasonalDemandData[]): number {
  if (data.length < 2) return 0;
  const revenues = data.map((d) => d.historicalAvgRevenueCents);
  const avg = revenues.reduce((s, r) => s + r, 0) / revenues.length;
  const cv = Math.sqrt(revenues.reduce((s, r) => s + (r - avg) ** 2, 0) / revenues.length) / avg;
  return Math.round(cv * 100); // coefficient of variation as %
}

const SEASONAL_DATA: SeasonalDemandData[] = [
  { month: 1,  historicalAvgBookings: 80,  historicalAvgRevenueCents: 40_000, isHolidaySeason: false },
  { month: 6,  historicalAvgBookings: 120, historicalAvgRevenueCents: 60_000, isHolidaySeason: false },
  { month: 7,  historicalAvgBookings: 130, historicalAvgRevenueCents: 65_000, isHolidaySeason: true  },
  { month: 12, historicalAvgBookings: 70,  historicalAvgRevenueCents: 35_000, isHolidaySeason: true  },
];

describe("Venue seasonal demand modeling", () => {
  it("overallSeasonalityIndex: high months > 1.0", () => {
    const indices = overallSeasonalityIndex(SEASONAL_DATA);
    expect(indices[7]).toBeGreaterThan(1.0);
  });

  it("overallSeasonalityIndex: low months < 1.0", () => {
    const indices = overallSeasonalityIndex(SEASONAL_DATA);
    expect(indices[12]).toBeLessThan(1.0);
  });

  it("peakMonths: returns months above threshold", () => {
    const peaks = peakMonths(SEASONAL_DATA);
    expect(peaks).toContain(7); // 130 avg = high
  });

  it("offPeakMonths: returns months below threshold", () => {
    const offPeak = offPeakMonths(SEASONAL_DATA);
    expect(offPeak).toContain(12); // 70 avg = low
  });

  it("revenueSeasonalityScore: higher for more volatile revenue", () => {
    const score = revenueSeasonalityScore(SEASONAL_DATA);
    expect(score).toBeGreaterThan(0);
  });

  it("revenueSeasonalityScore: single data point → 0", () => {
    expect(revenueSeasonalityScore([SEASONAL_DATA[0]])).toBe(0);
  });
});
