/**
 * Tests for venue booking A/B testing framework utilities.
 */

interface ABExperiment {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed";
  variants: ABVariant[];
  startMs: number;
  endMs: number | null;
  primaryMetric: string;
}

interface ABVariant {
  id: string;
  name: string;
  trafficPercent: number;
  conversions: number;
  visitors: number;
}

function conversionRate(variant: ABVariant): number {
  if (variant.visitors === 0) return 0;
  return Math.round((variant.conversions / variant.visitors) * 10000) / 100; // percentage
}

function trafficSplit(variants: ABVariant[]): number {
  return Math.round(variants.reduce((s, v) => s + v.trafficPercent, 0));
}

function isValidSplit(variants: ABVariant[]): boolean {
  return trafficSplit(variants) === 100;
}

function winningVariant(variants: ABVariant[]): ABVariant | null {
  if (variants.length === 0) return null;
  return variants.reduce((best, v) => (conversionRate(v) > conversionRate(best) ? v : best), variants[0]);
}

function relativeLift(control: ABVariant, treatment: ABVariant): number {
  const controlRate = conversionRate(control);
  if (controlRate === 0) return 0;
  return Math.round(((conversionRate(treatment) - controlRate) / controlRate) * 100);
}

function experimentDuration(exp: ABExperiment, nowMs: number): number {
  const end = exp.endMs ?? nowMs;
  return Math.floor((end - exp.startMs) / 86_400_000);
}

const NOW = 1_700_000_000_000;
const VARIANTS: ABVariant[] = [
  { id: "ctrl", name: "Control",   trafficPercent: 50, conversions: 150, visitors: 1000 },
  { id: "var1", name: "Treatment", trafficPercent: 50, conversions: 180, visitors: 1000 },
];
const EXP: ABExperiment = {
  id: "exp1", name: "CTA color test", status: "running",
  variants: VARIANTS, startMs: NOW - 7 * 86_400_000, endMs: null, primaryMetric: "booking_rate",
};

describe("A/B testing framework", () => {
  it("conversionRate: 150/1000 = 15%", () => {
    expect(conversionRate(VARIANTS[0])).toBe(15);
  });

  it("trafficSplit: 50+50 = 100", () => {
    expect(trafficSplit(VARIANTS)).toBe(100);
  });

  it("isValidSplit: 100% → true", () => {
    expect(isValidSplit(VARIANTS)).toBe(true);
  });

  it("winningVariant: treatment (18%) over control (15%)", () => {
    expect(winningVariant(VARIANTS)?.id).toBe("var1");
  });

  it("relativeLift: 18% vs 15% = 20% lift", () => {
    expect(relativeLift(VARIANTS[0], VARIANTS[1])).toBe(20);
  });

  it("experimentDuration: 7 days running", () => {
    expect(experimentDuration(EXP, NOW)).toBe(7);
  });
});
