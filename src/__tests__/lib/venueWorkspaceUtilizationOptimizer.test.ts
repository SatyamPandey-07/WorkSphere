/**
 * Tests for workspace utilization optimizer recommendations.
 */

interface SpaceUsagePattern {
  spaceId: string;
  venueId: string;
  avgOccupancyPct: number;
  peakOccupancyPct: number;
  offPeakOccupancyPct: number;
  costPerHourCents: number;
  revenuePerHourCents: number;
}

function profitMargin(space: SpaceUsagePattern): number {
  if (space.revenuePerHourCents === 0) return -100;
  return Math.round(((space.revenuePerHourCents - space.costPerHourCents) / space.revenuePerHourCents) * 100);
}

function utilizationGap(space: SpaceUsagePattern): number {
  return space.peakOccupancyPct - space.offPeakOccupancyPct;
}

function optimizationPriority(space: SpaceUsagePattern): "expand" | "repurpose" | "optimize" | "maintain" {
  const margin = profitMargin(space);
  const utilization = space.avgOccupancyPct;

  if (utilization >= 80 && margin > 30) return "expand";
  if (utilization < 40 && margin < 10) return "repurpose";
  if (utilizationGap(space) > 50) return "optimize"; // smooth out peaks/troughs
  return "maintain";
}

function portfolioOptimizationScore(spaces: SpaceUsagePattern[]): number {
  if (spaces.length === 0) return 0;
  const avgMargin = spaces.reduce((s, sp) => s + profitMargin(sp), 0) / spaces.length;
  const avgUtilization = spaces.reduce((s, sp) => s + sp.avgOccupancyPct, 0) / spaces.length;
  return Math.round((avgMargin + avgUtilization) / 2);
}

const SPACES: SpaceUsagePattern[] = [
  { spaceId: "sp1", venueId: "v1", avgOccupancyPct: 85, peakOccupancyPct: 98, offPeakOccupancyPct: 60, costPerHourCents: 500, revenuePerHourCents: 1000 },
  { spaceId: "sp2", venueId: "v1", avgOccupancyPct: 30, peakOccupancyPct: 45, offPeakOccupancyPct: 15, costPerHourCents: 800, revenuePerHourCents: 600  },
  { spaceId: "sp3", venueId: "v1", avgOccupancyPct: 65, peakOccupancyPct: 95, offPeakOccupancyPct: 20, costPerHourCents: 300, revenuePerHourCents: 700  },
];

describe("Workspace utilization optimizer", () => {
  it("profitMargin: sp1 50% margin", () => {
    expect(profitMargin(SPACES[0])).toBe(50);
  });

  it("profitMargin: sp2 negative margin", () => {
    expect(profitMargin(SPACES[1])).toBeLessThan(0);
  });

  it("utilizationGap: sp3 large gap (95-20=75)", () => {
    expect(utilizationGap(SPACES[2])).toBe(75);
  });

  it("optimizationPriority: sp1 (high util + good margin) → expand", () => {
    expect(optimizationPriority(SPACES[0])).toBe("expand");
  });

  it("optimizationPriority: sp2 (low util + negative margin) → repurpose", () => {
    expect(optimizationPriority(SPACES[1])).toBe("repurpose");
  });

  it("optimizationPriority: sp3 (large utilization gap) → optimize", () => {
    expect(optimizationPriority(SPACES[2])).toBe("optimize");
  });

  it("portfolioOptimizationScore: positive for mixed portfolio", () => {
    expect(portfolioOptimizationScore(SPACES)).toBeGreaterThan(0);
  });

  it("portfolioOptimizationScore: empty → 0", () => {
    expect(portfolioOptimizationScore([])).toBe(0);
  });
});
