/**
 * Tests for venue capacity planning for future growth.
 */

interface CapacityPlanScenario {
  name: string;
  currentCapacity: number;
  projectedDemandGrowthPct: number; // % growth per year
  years: number;
  targetUtilizationPct: number;
}

function projectedDemand(scenario: CapacityPlanScenario): number {
  return Math.round(scenario.currentCapacity * (1 + scenario.projectedDemandGrowthPct / 100) ** scenario.years);
}

function capacityGap(scenario: CapacityPlanScenario): number {
  const demand = projectedDemand(scenario);
  const requiredCapacity = Math.round(demand / (scenario.targetUtilizationPct / 100));
  return Math.max(0, requiredCapacity - scenario.currentCapacity);
}

function expansionPhases(totalGap: number, maxPerPhase: number): number {
  if (totalGap <= 0) return 0;
  return Math.ceil(totalGap / maxPerPhase);
}

function roi(
  expansionCostCents: number,
  additionalRevenueCentsPerYear: number,
  years: number
): number {
  const totalRevenue = additionalRevenueCentsPerYear * years;
  return Math.round(((totalRevenue - expansionCostCents) / expansionCostCents) * 100);
}

const SCENARIO: CapacityPlanScenario = {
  name: "3-year plan",
  currentCapacity: 50,
  projectedDemandGrowthPct: 20, // 20% YoY
  years: 3,
  targetUtilizationPct: 80,
};

describe("Venue capacity planning", () => {
  it("projectedDemand: 50 * 1.2^3 ≈ 86", () => {
    const demand = projectedDemand(SCENARIO);
    expect(demand).toBeGreaterThan(80);
    expect(demand).toBeLessThan(95);
  });

  it("capacityGap: needs expansion to meet demand", () => {
    expect(capacityGap(SCENARIO)).toBeGreaterThan(0);
  });

  it("capacityGap: 0 when no growth", () => {
    const flat = { ...SCENARIO, projectedDemandGrowthPct: 0 };
    expect(capacityGap(flat)).toBe(0);
  });

  it("expansionPhases: 100 gap / 50 per phase = 2 phases", () => {
    expect(expansionPhases(100, 50)).toBe(2);
  });

  it("expansionPhases: 0 gap → 0 phases", () => {
    expect(expansionPhases(0, 50)).toBe(0);
  });

  it("expansionPhases: remainder rounds up", () => {
    expect(expansionPhases(101, 50)).toBe(3);
  });

  it("roi: positive for profitable expansion", () => {
    expect(roi(1_000_000, 600_000, 3)).toBe(80); // (1800000-1000000)/1000000 = 80%
  });

  it("roi: negative for unprofitable expansion", () => {
    expect(roi(1_000_000, 100_000, 3)).toBeLessThan(0);
  });
});
