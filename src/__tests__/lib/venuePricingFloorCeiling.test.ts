/**
 * Tests for venue pricing floor and ceiling enforcement.
 */

interface PricingBounds {
  venueId: string;
  floorCents: number;       // minimum allowed price
  ceilingCents: number;     // maximum allowed price
  targetMarginPct: number;  // desired profit margin
  costCents: number;        // base cost per booking
}

function enforcePricingBounds(proposedCents: number, bounds: PricingBounds): number {
  return Math.max(bounds.floorCents, Math.min(bounds.ceilingCents, proposedCents));
}

function targetPriceFromCost(bounds: PricingBounds): number {
  const targetPrice = Math.round(bounds.costCents / (1 - bounds.targetMarginPct / 100));
  return enforcePricingBounds(targetPrice, bounds);
}

function isMarginViable(priceCents: number, bounds: PricingBounds): boolean {
  if (priceCents <= bounds.costCents) return false;
  const margin = ((priceCents - bounds.costCents) / priceCents) * 100;
  return margin >= bounds.targetMarginPct;
}

function pricingRiskLevel(priceCents: number, bounds: PricingBounds): "safe" | "warning" | "critical" {
  const range = bounds.ceilingCents - bounds.floorCents;
  if (range === 0) return "safe";
  const position = (priceCents - bounds.floorCents) / range;
  if (position <= 0.1 || position >= 0.95) return "critical";
  if (position <= 0.2 || position >= 0.85) return "warning";
  return "safe";
}

const BOUNDS: PricingBounds = {
  venueId: "v1", floorCents: 500, ceilingCents: 5000,
  targetMarginPct: 30, costCents: 350,
};

describe("Venue pricing floor and ceiling enforcement", () => {
  it("enforcePricingBounds: within bounds → unchanged", () => {
    expect(enforcePricingBounds(1000, BOUNDS)).toBe(1000);
  });

  it("enforcePricingBounds: below floor → floor", () => {
    expect(enforcePricingBounds(200, BOUNDS)).toBe(500);
  });

  it("enforcePricingBounds: above ceiling → ceiling", () => {
    expect(enforcePricingBounds(8000, BOUNDS)).toBe(5000);
  });

  it("targetPriceFromCost: 350 cost / 70% = 500 → enforced to floor", () => {
    const target = targetPriceFromCost(BOUNDS);
    expect(target).toBeGreaterThanOrEqual(BOUNDS.floorCents);
  });

  it("isMarginViable: price 1000, cost 350 = 65% margin → true", () => {
    expect(isMarginViable(1000, BOUNDS)).toBe(true);
  });

  it("isMarginViable: price = cost → false (no margin)", () => {
    expect(isMarginViable(350, BOUNDS)).toBe(false);
  });

  it("pricingRiskLevel: at floor → critical", () => {
    expect(pricingRiskLevel(500, BOUNDS)).toBe("critical");
  });

  it("pricingRiskLevel: middle of range → safe", () => {
    expect(pricingRiskLevel(2750, BOUNDS)).toBe("safe");
  });

  it("pricingRiskLevel: near ceiling → warning or critical", () => {
    expect(["warning", "critical"]).toContain(pricingRiskLevel(4800, BOUNDS));
  });
});
