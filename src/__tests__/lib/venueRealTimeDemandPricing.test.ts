/**
 * Tests for venue real-time demand-responsive pricing.
 */

interface DemandPricingConfig {
  venueId: string;
  baseRateCents: number;
  minRateCents: number;
  maxRateCents: number;
  demandThresholds: { occupancyPct: number; multiplier: number }[];
}

interface DemandSnapshot {
  venueId: string;
  timestamp: number;
  currentOccupancyPct: number;
  viewersCount: number;
  pendingBookings: number;
}

function getDemandMultiplier(config: DemandPricingConfig, occupancyPct: number): number {
  const sorted = [...config.demandThresholds].sort((a, b) => b.occupancyPct - a.occupancyPct);
  for (const threshold of sorted) {
    if (occupancyPct >= threshold.occupancyPct) return threshold.multiplier;
  }
  return 1.0;
}

function calculateDynamicRate(
  config: DemandPricingConfig,
  snapshot: DemandSnapshot
): number {
  const demandMultiplier = getDemandMultiplier(config, snapshot.currentOccupancyPct);
  const viewerMultiplier = 1 + Math.min(snapshot.viewersCount * 0.01, 0.2);
  const pendingMultiplier = 1 + Math.min(snapshot.pendingBookings * 0.05, 0.3);
  const raw = Math.round(config.baseRateCents * demandMultiplier * viewerMultiplier * pendingMultiplier);
  return Math.max(config.minRateCents, Math.min(config.maxRateCents, raw));
}

function pricingAlert(
  config: DemandPricingConfig,
  snapshot: DemandSnapshot
): string | null {
  const rate = calculateDynamicRate(config, snapshot);
  if (rate >= config.maxRateCents) return "Peak pricing: Maximum rate applied";
  if (rate <= config.minRateCents) return "Off-peak: Discounted rate applied";
  const pctOfMax = Math.round((rate / config.maxRateCents) * 100);
  if (pctOfMax >= 80) return `High demand: ${pctOfMax}% of peak rate`;
  return null;
}

const CONFIG: DemandPricingConfig = {
  venueId: "v1",
  baseRateCents: 1000,
  minRateCents: 600,
  maxRateCents: 2000,
  demandThresholds: [
    { occupancyPct: 90, multiplier: 1.8 },
    { occupancyPct: 70, multiplier: 1.3 },
    { occupancyPct: 40, multiplier: 1.0 },
    { occupancyPct: 0,  multiplier: 0.8 },
  ],
};

const NOW = 1_700_000_000_000;

describe("Venue real-time demand-responsive pricing", () => {
  it("getDemandMultiplier: 95% occupancy → 1.8x", () => {
    expect(getDemandMultiplier(CONFIG, 95)).toBe(1.8);
  });

  it("getDemandMultiplier: 20% occupancy → 0.8x", () => {
    expect(getDemandMultiplier(CONFIG, 20)).toBe(0.8);
  });

  it("calculateDynamicRate: low occupancy → below base", () => {
    const snapshot = { venueId: "v1", timestamp: NOW, currentOccupancyPct: 10, viewersCount: 2, pendingBookings: 0 };
    expect(calculateDynamicRate(CONFIG, snapshot)).toBeLessThan(1000);
  });

  it("calculateDynamicRate: high demand → above base", () => {
    const snapshot = { venueId: "v1", timestamp: NOW, currentOccupancyPct: 95, viewersCount: 20, pendingBookings: 5 };
    expect(calculateDynamicRate(CONFIG, snapshot)).toBeGreaterThan(1000);
  });

  it("calculateDynamicRate: capped at maxRate", () => {
    const snapshot = { venueId: "v1", timestamp: NOW, currentOccupancyPct: 100, viewersCount: 100, pendingBookings: 10 };
    expect(calculateDynamicRate(CONFIG, snapshot)).toBeLessThanOrEqual(2000);
  });

  it("pricingAlert: peak pricing when at max rate", () => {
    const snapshot = { venueId: "v1", timestamp: NOW, currentOccupancyPct: 100, viewersCount: 100, pendingBookings: 10 };
    expect(pricingAlert(CONFIG, snapshot)).toContain("Peak pricing");
  });

  it("pricingAlert: null for normal demand", () => {
    const snapshot = { venueId: "v1", timestamp: NOW, currentOccupancyPct: 50, viewersCount: 5, pendingBookings: 1 };
    expect(pricingAlert(CONFIG, snapshot)).toBeNull();
  });
});
