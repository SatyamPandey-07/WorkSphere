/**
 * Tests for venue booking price sensitivity and elasticity modeling.
 */

interface PricePoint {
  price: number;
  observedBookings: number;
  period: string;
}

function priceElasticity(p1: PricePoint, p2: PricePoint): number {
  if (p1.price === 0 || p1.observedBookings === 0) return 0;
  const pctPriceChange = (p2.price - p1.price) / p1.price;
  const pctDemandChange = (p2.observedBookings - p1.observedBookings) / p1.observedBookings;
  if (pctPriceChange === 0) return 0;
  return Math.round((pctDemandChange / pctPriceChange) * 100) / 100;
}

function isElastic(elasticity: number): boolean {
  return Math.abs(elasticity) > 1;
}

function revenueMaximizingPrice(points: PricePoint[]): PricePoint | null {
  if (points.length === 0) return null;
  return points.reduce((max, p) => {
    const rev = p.price * p.observedBookings;
    const maxRev = max.price * max.observedBookings;
    return rev > maxRev ? p : max;
  }, points[0]);
}

function demandCurveSlope(points: PricePoint[]): number {
  if (points.length < 2) return 0;
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const first = sorted[0];
  const last  = sorted[sorted.length - 1];
  const priceDiff = last.price - first.price;
  if (priceDiff === 0) return 0;
  return Math.round(((last.observedBookings - first.observedBookings) / priceDiff) * 100) / 100;
}

function revenueAtPrice(price: number, baseline: PricePoint, elasticity: number): number {
  const pctChange = (price - baseline.price) / baseline.price;
  const adjustedDemand = baseline.observedBookings * (1 + elasticity * pctChange);
  return Math.round(Math.max(0, price * adjustedDemand) * 100) / 100;
}

const POINTS: PricePoint[] = [
  { price: 100, observedBookings: 50, period: "2026-07" },
  { price: 120, observedBookings: 40, period: "2026-08" },
  { price: 150, observedBookings: 28, period: "2026-09" },
  { price: 80,  observedBookings: 65, period: "2026-10" },
];

describe("Price sensitivity and elasticity", () => {
  it("priceElasticity: 20% price increase, 20% demand drop = -1", () => {
    expect(priceElasticity(POINTS[0], POINTS[1])).toBe(-1);
  });

  it("isElastic: elasticity -1.5 → elastic", () => {
    expect(isElastic(-1.5)).toBe(true);
  });

  it("isElastic: elasticity -0.5 → inelastic", () => {
    expect(isElastic(-0.5)).toBe(false);
  });

  it("revenueMaximizingPrice: finds highest revenue point", () => {
    const best = revenueMaximizingPrice(POINTS);
    expect(best).not.toBeNull();
    // Verify it has highest revenue
    const bestRevenue = best!.price * best!.observedBookings;
    for (const p of POINTS) {
      expect(p.price * p.observedBookings).toBeLessThanOrEqual(bestRevenue + 1); // +1 for floating point
    }
  });

  it("demandCurveSlope: negative (higher price = fewer bookings)", () => {
    expect(demandCurveSlope(POINTS)).toBeLessThan(0);
  });
});
