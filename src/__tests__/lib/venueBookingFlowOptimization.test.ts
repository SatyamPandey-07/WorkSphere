/**
 * Tests for booking flow UX optimization metrics.
 */

interface FlowMetrics {
  flowId: string;
  variant: "A" | "B" | "C";
  stepsCompleted: number;
  totalSteps: number;
  timeSpentMs: number;
  errorCount: number;
  helpClickCount: number;
  abandoned: boolean;
  completed: boolean;
}

function completionRate(metrics: FlowMetrics[]): number {
  if (metrics.length === 0) return 0;
  return Math.round((metrics.filter((m) => m.completed).length / metrics.length) * 100);
}

function avgTimeToComplete(metrics: FlowMetrics[]): number {
  const completed = metrics.filter((m) => m.completed);
  if (completed.length === 0) return 0;
  return Math.round(completed.reduce((s, m) => s + m.timeSpentMs, 0) / completed.length / 1000);
}

function avgErrorsPerSession(metrics: FlowMetrics[]): number {
  if (metrics.length === 0) return 0;
  return Math.round((metrics.reduce((s, m) => s + m.errorCount, 0) / metrics.length) * 10) / 10;
}

function mostDroppedStep(metrics: FlowMetrics[]): number | null {
  const abandoned = metrics.filter((m) => m.abandoned);
  if (abandoned.length === 0) return null;
  const stepCounts: Record<number, number> = {};
  abandoned.forEach((m) => { stepCounts[m.stepsCompleted] = (stepCounts[m.stepsCompleted] ?? 0) + 1; });
  return Number(Object.entries(stepCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0][0]);
}

function variantComparisonScore(metrics: FlowMetrics[], variant: "A" | "B" | "C"): number {
  const variantMetrics = metrics.filter((m) => m.variant === variant);
  if (variantMetrics.length === 0) return 0;
  const completion = completionRate(variantMetrics);
  const avgErrors = avgErrorsPerSession(variantMetrics);
  const avgTime = avgTimeToComplete(variantMetrics);
  return Math.round(completion - avgErrors * 5 - avgTime * 0.1);
}

const METRICS: FlowMetrics[] = [
  { flowId: "f1", variant: "A", stepsCompleted: 5, totalSteps: 5, timeSpentMs: 60_000, errorCount: 0, helpClickCount: 0, abandoned: false, completed: true  },
  { flowId: "f2", variant: "A", stepsCompleted: 3, totalSteps: 5, timeSpentMs: 45_000, errorCount: 2, helpClickCount: 1, abandoned: true,  completed: false },
  { flowId: "f3", variant: "B", stepsCompleted: 5, totalSteps: 5, timeSpentMs: 45_000, errorCount: 1, helpClickCount: 0, abandoned: false, completed: true  },
  { flowId: "f4", variant: "B", stepsCompleted: 5, totalSteps: 5, timeSpentMs: 50_000, errorCount: 0, helpClickCount: 0, abandoned: false, completed: true  },
];

describe("Booking flow optimization", () => {
  it("completionRate: 3 of 4 completed = 75%", () => {
    expect(completionRate(METRICS)).toBe(75);
  });

  it("completionRate: empty → 0", () => {
    expect(completionRate([])).toBe(0);
  });

  it("avgTimeToComplete: averages completed only", () => {
    const avgSec = avgTimeToComplete(METRICS);
    expect(avgSec).toBeGreaterThan(0);
  });

  it("avgErrorsPerSession: includes abandoned", () => {
    expect(avgErrorsPerSession(METRICS)).toBeCloseTo(0.75, 1);
  });

  it("mostDroppedStep: step 3 is where f2 abandoned", () => {
    expect(mostDroppedStep(METRICS)).toBe(3);
  });

  it("mostDroppedStep: no abandoned → null", () => {
    const noAbandoned = METRICS.filter((m) => !m.abandoned);
    expect(mostDroppedStep(noAbandoned)).toBeNull();
  });

  it("variantComparisonScore: B has 100% completion vs A 50%", () => {
    const scoreB = variantComparisonScore(METRICS, "B");
    const scoreA = variantComparisonScore(METRICS, "A");
    expect(scoreB).toBeGreaterThan(scoreA);
  });
});
