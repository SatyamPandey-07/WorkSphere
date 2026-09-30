/**
 * Tests for smart overbooking management with no-show predictions.
 */

interface OverbookingConfig {
  venueId: string;
  maxCapacity: number;
  noShowRatePct: number;        // historical no-show %
  overbookingFactor: number;    // how much above capacity to allow
  compensationPolicyCents: number; // per bumped customer
}

function calculateOverbookingLimit(config: OverbookingConfig): number {
  const expectedNoShows = Math.floor(config.maxCapacity * (config.noShowRatePct / 100));
  return Math.round(config.maxCapacity * config.overbookingFactor + expectedNoShows * 0.5);
}

function expectedActualAttendees(
  reservations: number,
  noShowRatePct: number
): number {
  return Math.round(reservations * (1 - noShowRatePct / 100));
}

function overbookingRisk(
  reservations: number,
  config: OverbookingConfig
): "safe" | "risk" | "critical" {
  const expected = expectedActualAttendees(reservations, config.noShowRatePct);
  const diff = expected - config.maxCapacity;
  if (diff > config.maxCapacity * 0.1) return "critical";
  if (diff > 0) return "risk";
  return "safe";
}

function compensationExposure(
  reservations: number,
  config: OverbookingConfig
): number {
  const expected = expectedActualAttendees(reservations, config.noShowRatePct);
  const bumped = Math.max(0, expected - config.maxCapacity);
  return bumped * config.compensationPolicyCents;
}

const CONFIG: OverbookingConfig = {
  venueId: "v1", maxCapacity: 100, noShowRatePct: 15,
  overbookingFactor: 1.05, compensationPolicyCents: 5000,
};

describe("Smart overbooking management", () => {
  it("calculateOverbookingLimit: 100 × 1.05 + 15×0.5 = 112", () => {
    const limit = calculateOverbookingLimit(CONFIG);
    expect(limit).toBeCloseTo(112, 0);
  });

  it("expectedActualAttendees: 120 reservations × 85% show = 102", () => {
    expect(expectedActualAttendees(120, 15)).toBe(102);
  });

  it("overbookingRisk: 120 reservations with 15% no-show = 102 expected > 100 → risk", () => {
    expect(overbookingRisk(120, CONFIG)).toBe("risk");
  });

  it("overbookingRisk: 115 reservations = ~98 expected < 100 → safe", () => {
    expect(overbookingRisk(115, CONFIG)).toBe("safe");
  });

  it("overbookingRisk: critical if many over capacity", () => {
    expect(overbookingRisk(130, CONFIG)).toBe("critical"); // ~110 expected > 100+10
  });

  it("compensationExposure: 2 bumped × 5000 = 10000", () => {
    // 120 × 0.85 = 102, 102 - 100 = 2 bumped
    expect(compensationExposure(120, CONFIG)).toBe(10_000);
  });

  it("compensationExposure: safe level → 0", () => {
    expect(compensationExposure(100, CONFIG)).toBe(0);
  });
});
