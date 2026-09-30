/**
 * Tests for venue membership churn prediction.
 */

interface MembershipUsageStats {
  memberId: string;
  venueId: string;
  activeMonths: number;
  avgVisitsPerMonth: number;
  lastVisitMs: number;
  totalSpentCents: number;
  supportTickets: number;
  hasUsedMobileApp: boolean;
  featureAdoptionPct: number; // 0-100%
}

function churnProbabilityScore(stats: MembershipUsageStats, nowMs: number): number {
  let score = 0;
  const daysSinceVisit = (nowMs - stats.lastVisitMs) / 86_400_000;

  // Inactivity signals
  if (daysSinceVisit > 30) score += 30;
  else if (daysSinceVisit > 14) score += 15;

  // Engagement signals
  if (stats.avgVisitsPerMonth < 1) score += 20;
  else if (stats.avgVisitsPerMonth < 2) score += 10;

  // Frustration signals
  if (stats.supportTickets > 3) score += 15;
  else if (stats.supportTickets > 1) score += 5;

  // Positive engagement reduces risk
  if (stats.hasUsedMobileApp) score -= 5;
  if (stats.featureAdoptionPct > 70) score -= 10;
  if (stats.activeMonths > 12) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function churnRiskCategory(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function preventionAction(score: number): string | null {
  if (score >= 75) return "Personal outreach + special offer";
  if (score >= 50) return "Targeted email + features walkthrough";
  if (score >= 25) return "Check-in survey + loyalty bonus";
  return null;
}

const NOW = 1_700_000_000_000;

const ENGAGED_MEMBER: MembershipUsageStats = {
  memberId: "m1", venueId: "v1", activeMonths: 18, avgVisitsPerMonth: 4,
  lastVisitMs: NOW - 5 * 86_400_000, totalSpentCents: 200_000,
  supportTickets: 0, hasUsedMobileApp: true, featureAdoptionPct: 85,
};

const AT_RISK_MEMBER: MembershipUsageStats = {
  memberId: "m2", venueId: "v1", activeMonths: 3, avgVisitsPerMonth: 0.5,
  lastVisitMs: NOW - 45 * 86_400_000, totalSpentCents: 15_000,
  supportTickets: 4, hasUsedMobileApp: false, featureAdoptionPct: 20,
};

describe("Venue membership churn prediction", () => {
  it("churnProbabilityScore: engaged member → low score", () => {
    expect(churnProbabilityScore(ENGAGED_MEMBER, NOW)).toBeLessThan(25);
  });

  it("churnProbabilityScore: at-risk member → high score", () => {
    expect(churnProbabilityScore(AT_RISK_MEMBER, NOW)).toBeGreaterThan(50);
  });

  it("churnProbabilityScore: clamped 0-100", () => {
    const score = churnProbabilityScore(AT_RISK_MEMBER, NOW);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("churnRiskCategory: engaged member → low", () => {
    expect(churnRiskCategory(churnProbabilityScore(ENGAGED_MEMBER, NOW))).toBe("low");
  });

  it("preventionAction: high risk → outreach", () => {
    const action = preventionAction(churnProbabilityScore(AT_RISK_MEMBER, NOW));
    expect(action).not.toBeNull();
  });

  it("preventionAction: low risk → null", () => {
    expect(preventionAction(churnProbabilityScore(ENGAGED_MEMBER, NOW))).toBeNull();
  });
});
