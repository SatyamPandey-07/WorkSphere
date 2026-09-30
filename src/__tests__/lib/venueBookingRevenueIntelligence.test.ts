/**
 * Tests for venue booking revenue intelligence metrics.
 */

interface RevenueMetric {
  venueId: string;
  period: string;
  grossRevenueCents: number;
  netRevenueCents: number;
  bookingCount: number;
  avgOrderValueCents: number;
  refundsCents: number;
  discountsCents: number;
  revenuePotentialCents: number; // unused capacity × price
}

function realizedRevenuePct(metric: RevenueMetric): number {
  if (metric.revenuePotentialCents === 0) return 0;
  return Math.round((metric.grossRevenueCents / metric.revenuePotentialCents) * 100);
}

function revenueLeakage(metric: RevenueMetric): number {
  return metric.grossRevenueCents - metric.netRevenueCents;
}

function revenuePerBooking(metric: RevenueMetric): number {
  if (metric.bookingCount === 0) return 0;
  return Math.round(metric.netRevenueCents / metric.bookingCount);
}

function revenueHealth(metric: RevenueMetric): "excellent" | "good" | "concerning" | "critical" {
  const realized = realizedRevenuePct(metric);
  const leakagePct = (revenueLeakage(metric) / Math.max(1, metric.grossRevenueCents)) * 100;

  if (realized >= 70 && leakagePct < 10) return "excellent";
  if (realized >= 50 && leakagePct < 20) return "good";
  if (realized >= 30) return "concerning";
  return "critical";
}

function comparePerformance(current: RevenueMetric, previous: RevenueMetric): {
  revenueGrowthPct: number;
  bookingGrowthPct: number;
  avgOrderGrowthPct: number;
} {
  return {
    revenueGrowthPct: previous.netRevenueCents > 0
      ? Math.round(((current.netRevenueCents - previous.netRevenueCents) / previous.netRevenueCents) * 100)
      : 0,
    bookingGrowthPct: previous.bookingCount > 0
      ? Math.round(((current.bookingCount - previous.bookingCount) / previous.bookingCount) * 100)
      : 0,
    avgOrderGrowthPct: previous.avgOrderValueCents > 0
      ? Math.round(((current.avgOrderValueCents - previous.avgOrderValueCents) / previous.avgOrderValueCents) * 100)
      : 0,
  };
}

const CURRENT: RevenueMetric = {
  venueId: "v1", period: "2026-10",
  grossRevenueCents: 500_000, netRevenueCents: 460_000,
  bookingCount: 100, avgOrderValueCents: 5000,
  refundsCents: 25_000, discountsCents: 15_000,
  revenuePotentialCents: 700_000,
};

const PREVIOUS: RevenueMetric = { ...CURRENT, period: "2026-09", grossRevenueCents: 450_000, netRevenueCents: 410_000, bookingCount: 90 };

describe("Venue booking revenue intelligence", () => {
  it("realizedRevenuePct: 500000/700000 = 71%", () => {
    expect(realizedRevenuePct(CURRENT)).toBe(71);
  });

  it("revenueLeakage: 500000-460000 = 40000 cents", () => {
    expect(revenueLeakage(CURRENT)).toBe(40_000);
  });

  it("revenuePerBooking: 460000/100 = 4600", () => {
    expect(revenuePerBooking(CURRENT)).toBe(4600);
  });

  it("revenueHealth: 71% realized, <10% leakage → excellent", () => {
    expect(revenueHealth(CURRENT)).toBe("excellent");
  });

  it("comparePerformance: 12% revenue growth", () => {
    const comparison = comparePerformance(CURRENT, PREVIOUS);
    expect(comparison.revenueGrowthPct).toBeCloseTo(12, 0);
  });

  it("comparePerformance: booking growth 10 bookings = ~11%", () => {
    const comparison = comparePerformance(CURRENT, PREVIOUS);
    expect(comparison.bookingGrowthPct).toBe(11);
  });
});
