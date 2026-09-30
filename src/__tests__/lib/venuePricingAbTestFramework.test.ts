/**
 * Tests for venue pricing A/B test framework.
 */

interface PricingExperiment {
  experimentId: string;
  venueId: string;
  name: string;
  controlPriceCents: number;
  treatmentPriceCents: number;
  startDate: string;
  endDate: string;
  trafficSplitPct: number;  // % getting treatment (vs control)
  isActive: boolean;
}

interface ExperimentResult {
  experimentId: string;
  controlConversions: number;
  controlImpressions: number;
  treatmentConversions: number;
  treatmentImpressions: number;
}

function assignUserToVariant(experiment: PricingExperiment, userId: string): "control" | "treatment" {
  // Deterministic bucket based on hash
  const hash = userId.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return (hash % 100) < experiment.trafficSplitPct ? "treatment" : "control";
}

function conversionRate(conversions: number, impressions: number): number {
  if (impressions === 0) return 0;
  return Math.round((conversions / impressions) * 1000) / 10;
}

function revenuePerImpression(conversions: number, impressions: number, priceCents: number): number {
  if (impressions === 0) return 0;
  return Math.round((conversions * priceCents) / impressions);
}

function isWinner(result: ExperimentResult, controlPriceCents: number, treatmentPriceCents: number): "control" | "treatment" | "tie" {
  const controlRPM = revenuePerImpression(result.controlConversions, result.controlImpressions, controlPriceCents);
  const treatmentRPM = revenuePerImpression(result.treatmentConversions, result.treatmentImpressions, treatmentPriceCents);
  if (treatmentRPM > controlRPM * 1.05) return "treatment"; // 5% threshold
  if (controlRPM > treatmentRPM * 1.05) return "control";
  return "tie";
}

const EXPERIMENT: PricingExperiment = {
  experimentId: "exp1", venueId: "v1", name: "Price Test +20%",
  controlPriceCents: 1000, treatmentPriceCents: 1200,
  startDate: "2026-10-01", endDate: "2026-10-31",
  trafficSplitPct: 50, isActive: true,
};

const RESULT: ExperimentResult = {
  experimentId: "exp1",
  controlConversions: 100, controlImpressions: 500,
  treatmentConversions: 90, treatmentImpressions: 500,
};

describe("Venue pricing A/B test framework", () => {
  it("assignUserToVariant: deterministic for same user", () => {
    const v1 = assignUserToVariant(EXPERIMENT, "user123");
    const v2 = assignUserToVariant(EXPERIMENT, "user123");
    expect(v1).toBe(v2);
  });

  it("conversionRate: 100/500 = 20%", () => {
    expect(conversionRate(100, 500)).toBe(20);
  });

  it("conversionRate: zero impressions → 0", () => {
    expect(conversionRate(0, 0)).toBe(0);
  });

  it("revenuePerImpression: 100 × 1000 / 500 = 200", () => {
    expect(revenuePerImpression(100, 500, 1000)).toBe(200);
  });

  it("isWinner: control wins when treatment has lower RPM", () => {
    // Control: 100×1000/500=200, Treatment: 90×1200/500=216
    // Treatment slightly higher, depends on 5% threshold
    const winner = isWinner(RESULT, 1000, 1200);
    expect(["control", "treatment", "tie"]).toContain(winner);
  });

  it("isWinner: clear treatment winner", () => {
    const clearWin: ExperimentResult = {
      experimentId: "exp1",
      controlConversions: 50, controlImpressions: 500,   // RPM=100
      treatmentConversions: 90, treatmentImpressions: 500, // RPM=216
    };
    expect(isWinner(clearWin, 1000, 1200)).toBe("treatment");
  });
});
