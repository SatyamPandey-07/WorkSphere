/**
 * Tests for venue booking funnel optimization.
 */

interface FunnelStep {
  step: number;
  name: string;
  users: number;
  completedToNext: number;
  avgTimeOnStepMs: number;
  bounceCount: number;
}

function conversionRateAtStep(step: FunnelStep): number {
  if (step.users === 0) return 0;
  return Math.round((step.completedToNext / step.users) * 100);
}

function dropOffAtStep(step: FunnelStep): number {
  return step.users - step.completedToNext;
}

function funnelBottleneck(steps: FunnelStep[]): FunnelStep | null {
  if (steps.length === 0) return null;
  return steps.reduce((worst, step) =>
    conversionRateAtStep(step) < conversionRateAtStep(worst) ? step : worst
  );
}

function overallFunnelConversionRate(steps: FunnelStep[]): number {
  if (steps.length === 0 || steps[0].users === 0) return 0;
  const finalCompleted = steps[steps.length - 1].completedToNext;
  return Math.round((finalCompleted / steps[0].users) * 100);
}

function slowestStep(steps: FunnelStep[]): FunnelStep | null {
  if (steps.length === 0) return null;
  return steps.reduce((slow, step) =>
    step.avgTimeOnStepMs > slow.avgTimeOnStepMs ? step : slow
  );
}

function improvementPotential(step: FunnelStep, targetConversionRate: number): number {
  const current = conversionRateAtStep(step);
  if (current >= targetConversionRate) return 0;
  const additionalUsers = Math.round(step.users * (targetConversionRate - current) / 100);
  return additionalUsers;
}

const FUNNEL: FunnelStep[] = [
  { step: 1, name: "Landing",     users: 1000, completedToNext: 600, avgTimeOnStepMs: 15_000, bounceCount: 400 },
  { step: 2, name: "Search",      users: 600,  completedToNext: 450, avgTimeOnStepMs: 90_000, bounceCount: 150 },
  { step: 3, name: "Venue Detail",users: 450,  completedToNext: 200, avgTimeOnStepMs: 120_000,bounceCount: 250 },
  { step: 4, name: "Checkout",    users: 200,  completedToNext: 150, avgTimeOnStepMs: 180_000,bounceCount: 50  },
  { step: 5, name: "Confirmation",users: 150,  completedToNext: 145, avgTimeOnStepMs: 10_000, bounceCount: 5   },
];

describe("Venue booking funnel optimization", () => {
  it("conversionRateAtStep: step 1 = 60%", () => {
    expect(conversionRateAtStep(FUNNEL[0])).toBe(60);
  });

  it("dropOffAtStep: 1000 - 600 = 400 dropped", () => {
    expect(dropOffAtStep(FUNNEL[0])).toBe(400);
  });

  it("funnelBottleneck: step 3 has lowest conversion (200/450≈44%)", () => {
    const bottleneck = funnelBottleneck(FUNNEL);
    expect(bottleneck!.name).toBe("Venue Detail");
  });

  it("overallFunnelConversionRate: 145/1000 = 14-15%", () => {
    expect(overallFunnelConversionRate(FUNNEL)).toBeCloseTo(14, 0);
  });

  it("slowestStep: Checkout is slowest (180s)", () => {
    expect(slowestStep(FUNNEL)!.name).toBe("Checkout");
  });

  it("improvementPotential: improve step 3 to 60% = more users", () => {
    const potential = improvementPotential(FUNNEL[2], 60);
    expect(potential).toBeGreaterThan(0);
  });
});
