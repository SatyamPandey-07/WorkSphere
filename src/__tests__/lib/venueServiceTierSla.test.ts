/**
 * Tests for venue service tier SLA and response time targets.
 */

type ServiceTier = "basic" | "standard" | "premium" | "enterprise";

interface SlaTier {
  tier: ServiceTier;
  responseTimeHours: number;     // max response to inquiries
  uptimeSla: number;             // target uptime percentage
  incidentResolutionHours: number;
  dedicatedSupport: boolean;
}

const SLA_TIERS: Record<ServiceTier, SlaTier> = {
  basic:      { tier: "basic",      responseTimeHours: 48, uptimeSla: 99.0, incidentResolutionHours: 72, dedicatedSupport: false },
  standard:   { tier: "standard",   responseTimeHours: 24, uptimeSla: 99.5, incidentResolutionHours: 48, dedicatedSupport: false },
  premium:    { tier: "premium",    responseTimeHours: 4,  uptimeSla: 99.9, incidentResolutionHours: 8,  dedicatedSupport: true  },
  enterprise: { tier: "enterprise", responseTimeHours: 1,  uptimeSla: 99.99,incidentResolutionHours: 2,  dedicatedSupport: true  },
};

function getSla(tier: ServiceTier): SlaTier {
  return SLA_TIERS[tier];
}

function meetsResponseTarget(
  actualResponseHours: number,
  tier: ServiceTier
): boolean {
  return actualResponseHours <= SLA_TIERS[tier].responseTimeHours;
}

function slaViolation(
  actualResponseHours: number,
  tier: ServiceTier
): boolean {
  return !meetsResponseTarget(actualResponseHours, tier);
}

function maxDowntimeMinutesPerMonth(uptimePct: number): number {
  const totalMinutes = 30 * 24 * 60; // 30-day month
  return Math.round(totalMinutes * (1 - uptimePct / 100));
}

describe("Venue service tier SLA", () => {
  it("getSla: enterprise has 1h response time", () => {
    expect(getSla("enterprise").responseTimeHours).toBe(1);
  });

  it("getSla: premium has dedicated support", () => {
    expect(getSla("premium").dedicatedSupport).toBe(true);
  });

  it("meetsResponseTarget: 2h response on standard (24h) → true", () => {
    expect(meetsResponseTarget(2, "standard")).toBe(true);
  });

  it("meetsResponseTarget: 50h response on basic (48h) → false", () => {
    expect(meetsResponseTarget(50, "basic")).toBe(false);
  });

  it("slaViolation: 5h on premium (4h max) → true", () => {
    expect(slaViolation(5, "premium")).toBe(true);
  });

  it("slaViolation: within target → false", () => {
    expect(slaViolation(1, "enterprise")).toBe(false);
  });

  it("maxDowntimeMinutesPerMonth: 99.9% uptime", () => {
    const downtime = maxDowntimeMinutesPerMonth(99.9);
    expect(downtime).toBeGreaterThan(0);
    expect(downtime).toBeLessThan(100); // about 43 minutes
  });

  it("maxDowntimeMinutesPerMonth: 100% uptime → 0", () => {
    expect(maxDowntimeMinutesPerMonth(100)).toBe(0);
  });
});
