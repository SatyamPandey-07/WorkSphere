/**
 * Tests for venue performance benchmarking against competitors.
 */

interface BenchmarkMetric {
  metricId: string;
  category: "pricing" | "satisfaction" | "availability" | "amenities" | "location";
  venueName: string;
  venueScore: number;    // 0-100
  marketAvg: number;    // 0-100
  marketBest: number;   // 0-100
}

function benchmarkGap(metric: BenchmarkMetric): number {
  return metric.venueScore - metric.marketAvg;
}

function isAboveMarket(metric: BenchmarkMetric): boolean {
  return metric.venueScore > metric.marketAvg;
}

function distanceToLeader(metric: BenchmarkMetric): number {
  return Math.max(0, metric.marketBest - metric.venueScore);
}

function overallBenchmarkScore(metrics: BenchmarkMetric[]): number {
  if (metrics.length === 0) return 0;
  return Math.round(metrics.reduce((s, m) => s + m.venueScore, 0) / metrics.length);
}

function weakestCategory(metrics: BenchmarkMetric[]): string | null {
  if (metrics.length === 0) return null;
  return metrics.reduce((worst, m) => benchmarkGap(m) < benchmarkGap(worst) ? m : worst).category;
}

function strongestCategory(metrics: BenchmarkMetric[]): string | null {
  if (metrics.length === 0) return null;
  return metrics.reduce((best, m) => benchmarkGap(m) > benchmarkGap(best) ? m : best).category;
}

const METRICS: BenchmarkMetric[] = [
  { metricId: "m1", category: "pricing",      venueName: "v1", venueScore: 75, marketAvg: 70, marketBest: 90 },
  { metricId: "m2", category: "satisfaction", venueName: "v1", venueScore: 85, marketAvg: 75, marketBest: 95 },
  { metricId: "m3", category: "availability", venueName: "v1", venueScore: 60, marketAvg: 72, marketBest: 85 },
  { metricId: "m4", category: "amenities",    venueName: "v1", venueScore: 80, marketAvg: 68, marketBest: 92 },
];

describe("Venue performance benchmarking", () => {
  it("benchmarkGap: pricing 75-70 = +5", () => {
    expect(benchmarkGap(METRICS[0])).toBe(5);
  });

  it("benchmarkGap: availability 60-72 = -12 (below market)", () => {
    expect(benchmarkGap(METRICS[2])).toBe(-12);
  });

  it("isAboveMarket: pricing (75>70) → true", () => {
    expect(isAboveMarket(METRICS[0])).toBe(true);
  });

  it("isAboveMarket: availability (60<72) → false", () => {
    expect(isAboveMarket(METRICS[2])).toBe(false);
  });

  it("distanceToLeader: pricing = 90-75 = 15", () => {
    expect(distanceToLeader(METRICS[0])).toBe(15);
  });

  it("overallBenchmarkScore: avg of all venue scores", () => {
    expect(overallBenchmarkScore(METRICS)).toBe(75); // (75+85+60+80)/4 = 75
  });

  it("weakestCategory: availability has -12 gap", () => {
    expect(weakestCategory(METRICS)).toBe("availability");
  });

  it("strongestCategory: satisfaction has +10 gap", () => {
    expect(strongestCategory(METRICS)).toBe("satisfaction");
  });
});
