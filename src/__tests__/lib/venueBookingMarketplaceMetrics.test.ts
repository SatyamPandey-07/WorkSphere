/**
 * Tests for venue marketplace health and liquidity metrics.
 */

interface MarketplaceMetrics {
  totalSupply: number;        // total venues available
  totalDemand: number;        // total booking requests
  matchRate: number;          // 0-1 bookings matched/requests
  avgTimeToMatchMs: number;
  cancelledByVenue: number;
  cancelledByGuest: number;
  totalTransactions: number;
  grossMerchandiseValue: number;
}

function liquidityScore(metrics: MarketplaceMetrics): number {
  // High match rate + low cancel rate = liquid market
  const matchScore = metrics.matchRate * 60;
  const cancelRate = (metrics.cancelledByVenue + metrics.cancelledByGuest) / Math.max(1, metrics.totalTransactions);
  const cancelScore = (1 - cancelRate) * 40;
  return Math.round(matchScore + cancelScore);
}

function supplyDemandRatio(metrics: MarketplaceMetrics): number {
  if (metrics.totalDemand === 0) return 0;
  return Math.round((metrics.totalSupply / metrics.totalDemand) * 100) / 100;
}

function isBalanced(metrics: MarketplaceMetrics, tolerance = 0.2): boolean {
  const ratio = supplyDemandRatio(metrics);
  return ratio >= (1 - tolerance) && ratio <= (1 + tolerance);
}

function cancellationRate(metrics: MarketplaceMetrics): number {
  if (metrics.totalTransactions === 0) return 0;
  return Math.round((metrics.cancelledByVenue + metrics.cancelledByGuest) / metrics.totalTransactions * 100);
}

function avgTransactionValue(metrics: MarketplaceMetrics): number {
  if (metrics.totalTransactions === 0) return 0;
  return Math.round((metrics.grossMerchandiseValue / metrics.totalTransactions) * 100) / 100;
}

const METRICS: MarketplaceMetrics = {
  totalSupply: 520, totalDemand: 480, matchRate: 0.85,
  avgTimeToMatchMs: 3_600_000, cancelledByVenue: 15, cancelledByGuest: 25,
  totalTransactions: 400, grossMerchandiseValue: 2_000_000,
};

describe("Marketplace health metrics", () => {
  it("liquidityScore: high match, low cancel → high score", () => {
    expect(liquidityScore(METRICS)).toBeGreaterThan(70);
  });

  it("supplyDemandRatio: 520/480 ≈ 1.08", () => {
    expect(supplyDemandRatio(METRICS)).toBe(1.08);
  });

  it("isBalanced: ratio 1.08 within 20% tolerance → true", () => {
    expect(isBalanced(METRICS)).toBe(true);
  });

  it("cancellationRate: (15+25)/400 = 10%", () => {
    expect(cancellationRate(METRICS)).toBe(10);
  });

  it("avgTransactionValue: $2M / 400 = $5000", () => {
    expect(avgTransactionValue(METRICS)).toBe(5000);
  });
});
