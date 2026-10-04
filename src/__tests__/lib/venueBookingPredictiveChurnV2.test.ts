/**
 * Tests for predictive churn scoring using engagement signals.
 */

interface EngagementSignal {
  userId: string;
  daysSinceLogin: number;
  daysSinceLastBooking: number;
  openEmailRate: number;      // 0-1
  supportTicketsOpen: number;
  declinedOffers: number;
  searchesLast30Days: number;
  reviewsGiven: number;
}

function engagementScore(signal: EngagementSignal): number {
  let score = 100;
  score -= Math.min(signal.daysSinceLogin * 0.5, 30);
  score -= Math.min(signal.daysSinceLastBooking * 0.3, 25);
  score -= (1 - signal.openEmailRate) * 15;
  score -= signal.supportTicketsOpen * 5;
  score -= signal.declinedOffers * 3;
  score += Math.min(signal.searchesLast30Days * 0.5, 10);
  score += Math.min(signal.reviewsGiven * 2, 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function churnRisk(signal: EngagementSignal): "low" | "medium" | "high" | "critical" {
  const score = engagementScore(signal);
  if (score >= 70) return "low";
  if (score >= 50) return "medium";
  if (score >= 30) return "high";
  return "critical";
}

function retentionAction(signal: EngagementSignal): string {
  const risk = churnRisk(signal);
  switch (risk) {
    case "low": return "No action needed";
    case "medium": return "Send re-engagement email";
    case "high": return "Offer personal discount";
    case "critical": return "Schedule account manager call";
  }
}

function highRiskUsers(signals: EngagementSignal[]): EngagementSignal[] {
  return signals.filter((s) => {
    const risk = churnRisk(s);
    return risk === "high" || risk === "critical";
  });
}

const SIGNALS: EngagementSignal[] = [
  { userId: "u1", daysSinceLogin: 2,  daysSinceLastBooking: 10, openEmailRate: 0.8, supportTicketsOpen: 0, declinedOffers: 0, searchesLast30Days: 15, reviewsGiven: 3 },
  { userId: "u2", daysSinceLogin: 45, daysSinceLastBooking: 90, openEmailRate: 0.1, supportTicketsOpen: 2, declinedOffers: 3, searchesLast30Days: 1,  reviewsGiven: 0 },
  { userId: "u3", daysSinceLogin: 20, daysSinceLastBooking: 40, openEmailRate: 0.4, supportTicketsOpen: 1, declinedOffers: 1, searchesLast30Days: 5,  reviewsGiven: 1 },
];

describe("Predictive churn scoring", () => {
  it("engagementScore: u1 (active) → high score", () => {
    expect(engagementScore(SIGNALS[0])).toBeGreaterThan(70);
  });

  it("engagementScore: u2 (inactive) → low score", () => {
    expect(engagementScore(SIGNALS[1])).toBeLessThan(50);
  });

  it("churnRisk: u1 → low", () => {
    expect(churnRisk(SIGNALS[0])).toBe("low");
  });

  it("churnRisk: u2 → high or critical", () => {
    const risk = churnRisk(SIGNALS[1]);
    expect(["high", "critical"]).toContain(risk);
  });

  it("retentionAction: low risk → no action", () => {
    expect(retentionAction(SIGNALS[0])).toBe("No action needed");
  });

  it("highRiskUsers: u2 is high risk", () => {
    const at_risk = highRiskUsers(SIGNALS);
    expect(at_risk.map((s) => s.userId)).toContain("u2");
  });
});
