/**
 * Tests for venue booking event risk assessment utilities.
 */

type RiskCategory = "weather" | "crowd" | "fire" | "medical" | "security" | "technical" | "logistics";

interface RiskFactor {
  category: RiskCategory;
  likelihood: number;  // 0-1
  impact: number;      // 0-1
  mitigated: boolean;
}

interface EventRiskAssessment {
  eventId: string;
  venueId: string;
  guestCount: number;
  outdoorEvent: boolean;
  factors: RiskFactor[];
  emergencyPlanInPlace: boolean;
}

function riskScore(factor: RiskFactor): number {
  const raw = factor.likelihood * factor.impact;
  return factor.mitigated ? Math.round(raw * 0.4 * 100) / 100 : Math.round(raw * 100) / 100;
}

function overallRiskScore(assessment: EventRiskAssessment): number {
  if (assessment.factors.length === 0) return 0;
  const avg = assessment.factors.reduce((s, f) => s + riskScore(f), 0) / assessment.factors.length;
  const capacityAdjust = assessment.guestCount > 500 ? 1.2 : 1.0;
  const outdoorAdjust  = assessment.outdoorEvent ? 1.15 : 1.0;
  return Math.min(Math.round(avg * capacityAdjust * outdoorAdjust * 100) / 100, 1);
}

function riskLevel(score: number): "critical" | "high" | "medium" | "low" {
  if (score >= 0.7) return "critical";
  if (score >= 0.4) return "high";
  if (score >= 0.2) return "medium";
  return "low";
}

function highestRiskFactors(assessment: EventRiskAssessment, limit = 3): RiskFactor[] {
  return [...assessment.factors]
    .sort((a, b) => riskScore(b) - riskScore(a))
    .slice(0, limit);
}

function unmitigatedRisks(assessment: EventRiskAssessment): RiskFactor[] {
  return assessment.factors.filter((f) => !f.mitigated && riskScore(f) > 0.3);
}

const ASSESSMENT: EventRiskAssessment = {
  eventId: "e1", venueId: "v1", guestCount: 600, outdoorEvent: true,
  emergencyPlanInPlace: true,
  factors: [
    { category: "weather",   likelihood: 0.3, impact: 0.8, mitigated: false },
    { category: "medical",   likelihood: 0.1, impact: 0.9, mitigated: true },
    { category: "security",  likelihood: 0.2, impact: 0.7, mitigated: true },
    { category: "crowd",     likelihood: 0.6, impact: 0.6, mitigated: false },
    { category: "technical", likelihood: 0.4, impact: 0.3, mitigated: false },
  ],
};

describe("Event risk assessment", () => {
  it("riskScore: weather (0.3×0.8) = 0.24", () => {
    expect(riskScore(ASSESSMENT.factors[0])).toBe(0.24);
  });

  it("riskScore: mitigated medical (0.1×0.9×0.4) = 0.04", () => {
    expect(riskScore(ASSESSMENT.factors[1])).toBe(0.04);
  });

  it("overallRiskScore: returns 0-1 value", () => {
    const score = overallRiskScore(ASSESSMENT);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("riskLevel: 0.7+ → critical", () => {
    expect(riskLevel(0.75)).toBe("critical");
  });

  it("highestRiskFactors: crowd is highest unmitigated", () => {
    const top = highestRiskFactors(ASSESSMENT, 1);
    expect(top[0].category).toBe("crowd");
  });

  it("unmitigatedRisks: crowd risk above 0.3", () => {
    const unmitigated = unmitigatedRisks(ASSESSMENT);
    expect(unmitigated.map((f) => f.category)).toContain("crowd");
  });
});
