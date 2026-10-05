import {
  getWebVitalRating,
  calculatePercentiles,
  calculatePerformanceScore,
  aggregateWebVitals,
  recordWebVital,
  getStoredWebVitals,
  clearStoredWebVitals,
  WEB_VITALS_THRESHOLDS,
  WebVitalEntry,
} from "@/lib/webVitalsCollector";

describe("Web Vitals Collector & Aggregator Library (#4145)", () => {
  beforeEach(() => {
    clearStoredWebVitals();
  });

  describe("getWebVitalRating", () => {
    it("rates LCP correctly against Google threshold standards", () => {
      expect(getWebVitalRating("LCP", 1500)).toBe("good");
      expect(getWebVitalRating("LCP", 2500)).toBe("good");
      expect(getWebVitalRating("LCP", 3500)).toBe("needs-improvement");
      expect(getWebVitalRating("LCP", 4000)).toBe("needs-improvement");
      expect(getWebVitalRating("LCP", 4500)).toBe("poor");
    });

    it("rates INP correctly", () => {
      expect(getWebVitalRating("INP", 100)).toBe("good");
      expect(getWebVitalRating("INP", 200)).toBe("good");
      expect(getWebVitalRating("INP", 350)).toBe("needs-improvement");
      expect(getWebVitalRating("INP", 600)).toBe("poor");
    });

    it("rates CLS correctly", () => {
      expect(getWebVitalRating("CLS", 0.05)).toBe("good");
      expect(getWebVitalRating("CLS", 0.1)).toBe("good");
      expect(getWebVitalRating("CLS", 0.18)).toBe("needs-improvement");
      expect(getWebVitalRating("CLS", 0.35)).toBe("poor");
    });
  });

  describe("calculatePercentiles", () => {
    it("calculates p50, p75, p90 accurately for a given dataset", () => {
      const values = Array.from({ length: 100 }, (_, i) => (i + 1) * 10);
      const res = calculatePercentiles(values);

      expect(res.count).toBe(100);
      expect(res.min).toBe(10);
      expect(res.max).toBe(1000);
      expect(res.p50).toBe(500);
      expect(res.p75).toBe(750);
      expect(res.p90).toBe(900);
    });

    it("handles empty array gracefully", () => {
      const res = calculatePercentiles([]);
      expect(res.count).toBe(0);
      expect(res.p50).toBe(0);
      expect(res.p75).toBe(0);
      expect(res.p90).toBe(0);
    });
  });

  describe("calculatePerformanceScore", () => {
    it("calculates a high performance score when p75 values are good", () => {
      const metrics = {
        LCP: { name: "LCP", p50: 1000, p75: 1800, p90: 2200, rating: "good" as const, sampleCount: 10, distribution: { good: 100, needsImprovement: 0, poor: 0 } },
        INP: { name: "INP", p50: 50, p75: 100, p90: 150, rating: "good" as const, sampleCount: 10, distribution: { good: 100, needsImprovement: 0, poor: 0 } },
        CLS: { name: "CLS", p50: 0.02, p75: 0.04, p90: 0.06, rating: "good" as const, sampleCount: 10, distribution: { good: 100, needsImprovement: 0, poor: 0 } },
      };

      const score = calculatePerformanceScore(metrics);
      expect(score).toBeGreaterThanOrEqual(90);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("calculates a lower score when metrics are poor", () => {
      const metrics = {
        LCP: { name: "LCP", p50: 4500, p75: 5500, p90: 7000, rating: "poor" as const, sampleCount: 10, distribution: { good: 0, needsImprovement: 0, poor: 100 } },
        INP: { name: "INP", p50: 600, p75: 800, p90: 1000, rating: "poor" as const, sampleCount: 10, distribution: { good: 0, needsImprovement: 0, poor: 100 } },
      };

      const score = calculatePerformanceScore(metrics);
      expect(score).toBeLessThan(50);
    });
  });

  describe("aggregateWebVitals", () => {
    it("aggregates raw telemetry entries by metric name and route", () => {
      const entries: WebVitalEntry[] = [
        { id: "1", name: "LCP", value: 1200, rating: "good", delta: 1200, route: "/", timestamp: 100 },
        { id: "2", name: "LCP", value: 1800, rating: "good", delta: 1800, route: "/", timestamp: 200 },
        { id: "3", name: "LCP", value: 3500, rating: "needs-improvement", delta: 3500, route: "/venues", timestamp: 300 },
        { id: "4", name: "INP", value: 80, rating: "good", delta: 80, route: "/", timestamp: 400 },
      ];

      const aggregated = aggregateWebVitals(entries, "7d");
      expect(aggregated.totalSamples).toBe(4);
      expect(aggregated.metrics.LCP.sampleCount).toBe(3);
      expect(aggregated.routes.length).toBeGreaterThan(0);
    });
  });

  describe("Local Storage Persistence", () => {
    it("records and retrieves Web Vitals entries from local storage", () => {
      const entry = recordWebVital({
        name: "LCP",
        value: 1650,
        rating: "good",
        delta: 1650,
        route: "/chat",
      });

      expect(entry.id).toBeDefined();
      expect(entry.value).toBe(1650);

      const stored = getStoredWebVitals();
      expect(stored.length).toBeGreaterThan(0);
      expect(stored[stored.length - 1].route).toBe("/chat");
    });
  });
});
