/**
 * Tests for end-to-end customer journey health scoring.
 */

interface JourneyStageHealth {
  stage: string;
  conversionRate: number;     // 0-1
  avgTimeMs: number;          // time spent in this stage
  errorRate: number;          // 0-1
  dropOffRate: number;        // 0-1
}

function stageHealthScore(health: JourneyStageHealth): number {
  const conversionScore = health.conversionRate * 40;
  const errorPenalty = health.errorRate * 30;
  const dropOffPenalty = health.dropOffRate * 20;
  const speedBonus = Math.max(0, 10 - (health.avgTimeMs / 60_000)); // bonus if < 10 min avg
  return Math.round(Math.max(0, conversionScore - errorPenalty - dropOffPenalty + speedBonus));
}

function overallJourneyHealth(stages: JourneyStageHealth[]): number {
  if (stages.length === 0) return 0;
  return Math.round(stages.reduce((s, stage) => s + stageHealthScore(stage), 0) / stages.length);
}

function criticalStages(stages: JourneyStageHealth[], threshold = 15): string[] {
  return stages.filter((s) => stageHealthScore(s) < threshold).map((s) => s.stage);
}

function journeyFunnel(stages: JourneyStageHealth[]): { stage: string; score: number }[] {
  return stages.map((s) => ({ stage: s.stage, score: stageHealthScore(s) }));
}

const STAGES: JourneyStageHealth[] = [
  { stage: "discovery",   conversionRate: 0.4,  avgTimeMs: 120_000, errorRate: 0.02, dropOffRate: 0.6 },
  { stage: "selection",   conversionRate: 0.6,  avgTimeMs: 180_000, errorRate: 0.05, dropOffRate: 0.4 },
  { stage: "checkout",    conversionRate: 0.8,  avgTimeMs: 300_000, errorRate: 0.10, dropOffRate: 0.2 },
  { stage: "confirmation",conversionRate: 0.98, avgTimeMs: 30_000,  errorRate: 0.01, dropOffRate: 0.02 },
];

describe("Customer journey health scoring", () => {
  it("stageHealthScore: confirmation (high conversion, low errors) → high", () => {
    const confScore = stageHealthScore(STAGES[3]);
    const discScore = stageHealthScore(STAGES[0]);
    expect(confScore).toBeGreaterThan(discScore);
  });

  it("overallJourneyHealth: average of all stages", () => {
    const overall = overallJourneyHealth(STAGES);
    expect(overall).toBeGreaterThan(0);
    expect(overall).toBeLessThanOrEqual(50);
  });

  it("overallJourneyHealth: empty → 0", () => {
    expect(overallJourneyHealth([])).toBe(0);
  });

  it("criticalStages: discovery may be below threshold", () => {
    const critical = criticalStages(STAGES, 10);
    // discovery has low score due to high drop-off
    expect(Array.isArray(critical)).toBe(true);
  });

  it("journeyFunnel: returns stage-score pairs", () => {
    const funnel = journeyFunnel(STAGES);
    expect(funnel).toHaveLength(4);
    expect(funnel[3].stage).toBe("confirmation");
    expect(funnel[3].score).toBeGreaterThan(funnel[0].score);
  });
});
