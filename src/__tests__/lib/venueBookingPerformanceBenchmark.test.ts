/**
 * Tests for venue booking performance benchmark measurement utilities.
 */

interface PerformanceBenchmark {
  metricName: string;
  currentValue: number;
  industryP25: number;
  industryP50: number;
  industryP75: number;
  industryP90: number;
  unit: string;
  higherIsBetter: boolean;
}

function percentileRankInIndustry(benchmark: PerformanceBenchmark): number {
  const { currentValue: v, industryP25: p25, industryP50: p50, industryP75: p75, industryP90: p90, higherIsBetter: hib } = benchmark;

  const thresholds = hib
    ? [p25, p50, p75, p90]
    : [p90, p75, p50, p25]; // invert for lower-is-better

  const percentiles = hib
    ? [25, 50, 75, 90]
    : [90, 75, 50, 25];

  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (hib ? v >= thresholds[i] : v <= thresholds[i]) return percentiles[i];
  }
  return hib ? 10 : 95;
}

function benchmarkLabel(rank: number): "top_performer" | "above_average" | "average" | "below_average" | "needs_improvement" {
  if (rank >= 90) return "top_performer";
  if (rank >= 75) return "above_average";
  if (rank >= 50) return "average";
  if (rank >= 25) return "below_average";
  return "needs_improvement";
}

function gapToTop(benchmark: PerformanceBenchmark): number {
  if (benchmark.higherIsBetter) {
    return Math.max(0, Math.round((benchmark.industryP90 - benchmark.currentValue) * 100) / 100);
  }
  return Math.max(0, Math.round((benchmark.currentValue - benchmark.industryP25) * 100) / 100);
}

const BENCHMARKS: PerformanceBenchmark[] = [
  { metricName: "avg_rating",        currentValue: 4.7,  industryP25: 3.8, industryP50: 4.2, industryP75: 4.6, industryP90: 4.8, unit: "stars",   higherIsBetter: true },
  { metricName: "response_time_hrs", currentValue: 1.5,  industryP25: 8.0, industryP50: 4.0, industryP75: 2.0, industryP90: 1.0, unit: "hours",   higherIsBetter: false },
  { metricName: "cancellation_rate", currentValue: 0.08, industryP25: 0.15,industryP50: 0.1, industryP75: 0.07,industryP90: 0.04,unit: "percent", higherIsBetter: false },
];

describe("Performance benchmark measurement", () => {
  it("percentileRankInIndustry: rating 4.7 ≥ P75(4.6) → 75th", () => {
    expect(percentileRankInIndustry(BENCHMARKS[0])).toBe(75);
  });

  it("benchmarkLabel: P75 → above_average", () => {
    expect(benchmarkLabel(75)).toBe("above_average");
  });

  it("benchmarkLabel: P90+ → top_performer", () => {
    expect(benchmarkLabel(90)).toBe("top_performer");
  });

  it("gapToTop: rating 4.7, top is 4.8 → gap 0.1", () => {
    expect(gapToTop(BENCHMARKS[0])).toBe(0.1);
  });

  it("percentileRankInIndustry: fast response (lower-is-better)", () => {
    const rank = percentileRankInIndustry(BENCHMARKS[1]);
    expect(rank).toBeGreaterThan(50); // 1.5h is faster than median
  });
});
