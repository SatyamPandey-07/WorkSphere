/**
 * Tests for venue space utilization metrics and optimization.
 */

interface SpaceMetrics {
  venueId: string;
  totalSqm: number;
  rentedSqm: number;
  bookedHours: number;
  totalAvailableHours: number;
  peakHoursUtilized: number;
  peakHoursAvailable: number;
}

function spaceUtilizationRate(metrics: SpaceMetrics): number {
  if (metrics.totalSqm === 0) return 0;
  return Math.round((metrics.rentedSqm / metrics.totalSqm) * 100);
}

function timeUtilizationRate(metrics: SpaceMetrics): number {
  if (metrics.totalAvailableHours === 0) return 0;
  return Math.round((metrics.bookedHours / metrics.totalAvailableHours) * 100);
}

function peakUtilizationRate(metrics: SpaceMetrics): number {
  if (metrics.peakHoursAvailable === 0) return 0;
  return Math.round((metrics.peakHoursUtilized / metrics.peakHoursAvailable) * 100);
}

function overallUtilizationScore(metrics: SpaceMetrics): number {
  return Math.round(
    spaceUtilizationRate(metrics) * 0.4 +
    timeUtilizationRate(metrics) * 0.4 +
    peakUtilizationRate(metrics) * 0.2
  );
}

function unusedCapacityHours(metrics: SpaceMetrics): number {
  return Math.max(0, metrics.totalAvailableHours - metrics.bookedHours);
}

function revenuePerSqm(totalRevenue: number, metrics: SpaceMetrics): number {
  if (metrics.totalSqm === 0) return 0;
  return Math.round((totalRevenue / metrics.totalSqm) * 100) / 100;
}

const METRICS: SpaceMetrics = {
  venueId: "v1",
  totalSqm: 1000, rentedSqm: 750,
  bookedHours: 180, totalAvailableHours: 240,
  peakHoursUtilized: 45, peakHoursAvailable: 50,
};

describe("Space utilization metrics", () => {
  it("spaceUtilizationRate: 750/1000 = 75%", () => {
    expect(spaceUtilizationRate(METRICS)).toBe(75);
  });

  it("timeUtilizationRate: 180/240 = 75%", () => {
    expect(timeUtilizationRate(METRICS)).toBe(75);
  });

  it("peakUtilizationRate: 45/50 = 90%", () => {
    expect(peakUtilizationRate(METRICS)).toBe(90);
  });

  it("overallUtilizationScore: weighted average", () => {
    // 75*0.4 + 75*0.4 + 90*0.2 = 30 + 30 + 18 = 78
    expect(overallUtilizationScore(METRICS)).toBe(78);
  });

  it("unusedCapacityHours: 240 - 180 = 60h", () => {
    expect(unusedCapacityHours(METRICS)).toBe(60);
  });

  it("revenuePerSqm: $10000 / 1000sqm = $10/sqm", () => {
    expect(revenuePerSqm(10000, METRICS)).toBe(10);
  });
});
