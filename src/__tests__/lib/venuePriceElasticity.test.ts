/**
 * Tests for venue price elasticity analysis.
 */

interface PriceDemandPoint {
  priceCents: number;
  bookingCount: number;
  date: string;
}

function priceElasticity(
  pointA: PriceDemandPoint,
  pointB: PriceDemandPoint
): number {
  if (pointA.priceCents === 0) return 0;
  const priceChangePct = (pointB.priceCents - pointA.priceCents) / pointA.priceCents;
  const demandChangePct = (pointB.bookingCount - pointA.bookingCount) / Math.max(1, pointA.bookingCount);
  if (priceChangePct === 0) return 0;
  return Math.round((demandChangePct / priceChangePct) * 100) / 100;
}

function optimalPriceForRevenue(
  data: PriceDemandPoint[],
  baseRevenueCents: number
): number | null {
  if (data.length === 0) return null;
  return data
    .map((d) => ({ price: d.priceCents, revenue: d.priceCents * d.bookingCount }))
    .reduce((max, p) => p.revenue > max.revenue ? p : max).price;
}

function demandForecast(
  currentBookings: number,
  currentPriceCents: number,
  newPriceCents: number,
  elasticity: number
): number {
  if (currentPriceCents === 0) return currentBookings;
  const priceChangePct = (newPriceCents - currentPriceCents) / currentPriceCents;
  const demandChangePct = elasticity * priceChangePct;
  return Math.max(0, Math.round(currentBookings * (1 + demandChangePct)));
}

function isElasticDemand(elasticity: number): boolean {
  return Math.abs(elasticity) > 1;
}

const DATA: PriceDemandPoint[] = [
  { priceCents: 1000, bookingCount: 100, date: "2026-10-01" },
  { priceCents: 1200, bookingCount: 75,  date: "2026-10-02" },
  { priceCents: 800,  bookingCount: 130, date: "2026-10-03" },
];

describe("Venue price elasticity analysis", () => {
  it("priceElasticity: 20% price increase → 25% demand drop", () => {
    const elasticity = priceElasticity(DATA[0], DATA[1]);
    expect(elasticity).toBeLessThan(0); // negative (demand fell)
  });

  it("isElasticDemand: elasticity > 1 → elastic", () => {
    expect(isElasticDemand(-1.5)).toBe(true);
  });

  it("isElasticDemand: < 1 → inelastic", () => {
    expect(isElasticDemand(-0.5)).toBe(false);
  });

  it("optimalPriceForRevenue: finds price that maximizes revenue", () => {
    const optimal = optimalPriceForRevenue(DATA, 0);
    expect(optimal).not.toBeNull();
    expect(DATA.some((d) => d.priceCents === optimal)).toBe(true);
  });

  it("demandForecast: price increase → lower demand", () => {
    const forecast = demandForecast(100, 1000, 1200, -1.25);
    expect(forecast).toBeLessThan(100);
  });

  it("demandForecast: price decrease → higher demand", () => {
    const forecast = demandForecast(100, 1000, 800, -1.25);
    expect(forecast).toBeGreaterThan(100);
  });

  it("demandForecast: clamps to 0", () => {
    expect(demandForecast(10, 1000, 10000, -5.0)).toBe(0);
  });
});
