import {
  generateSystemVitalsCSV,
  downloadSystemVitalsCSV,
  generateWebVitalsCSV,
  downloadWebVitalsCSV,
  SystemVitalsExportData,
} from "@/lib/export/domain/systemVitalsExporter";
import { AggregatedWebVitals } from "@/lib/webVitalsCollector";

describe("systemVitalsExporter", () => {
  beforeAll(() => {
    global.URL.createObjectURL = jest
      .fn()
      .mockReturnValue("blob:http://localhost/mock-blob");
    global.URL.revokeObjectURL = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("generateSystemVitalsCSV", () => {
    const mockFullData: SystemVitalsExportData = {
      range: "7d",
      generatedAt: "2026-10-26T12:00:00Z",
      overview: {
        totalSearches: 1250,
        totalVenueClicks: 430,
        totalReviews: 85,
        agentAvgMs: 240,
        agentP95Ms: 510,
      },
      usageTrend: [
        {
          date: "2026-10-25",
          searches: 180,
          venueClicks: 65,
          reviews: 12,
        },
      ],
      agentLatencyTrend: [
        {
          date: "2026-10-25",
          avgMs: 235,
          p95Ms: 490,
          runs: 150,
        },
      ],
      agentBreakdown: [
        {
          agent: "ConciergeAgent",
          avgMs: 210,
          p95Ms: 450,
          runs: 120,
        },
      ],
      dbLatency: {
        totalQueryCount: 4500,
        slowQueryCount: 15,
        slowQueryThresholdMs: 100,
        avgMs: 12.5,
        p95Ms: 45.2,
        byModel: [
          {
            model: "Venue",
            avgMs: 8.2,
            p95Ms: 22.1,
            sampleCount: 2200,
          },
        ],
      },
      webVitals: {
        timeRange: "7d",
        generatedAt: "2026-10-26T12:00:00Z",
        overallScore: 94,
        totalSamples: 1200,
        metrics: {
          LCP: {
            p50: 1850,
            p75: 2200,
            p90: 2750,
            rating: "good",
            sampleCount: 300,
            distribution: { good: 85, needsImprovement: 10, poor: 5 },
          },
          CLS: {
            p50: 0.04,
            p75: 0.085,
            p90: 0.12,
            rating: "good",
            sampleCount: 300,
            distribution: { good: 90, needsImprovement: 8, poor: 2 },
          },
        },
        routes: [
          {
            route: "/venues/[id]",
            metrics: {
              LCP: {
                p75: 2100,
                rating: "good",
                sampleCount: 150,
              },
            },
          },
        ],
      },
    };

    it("generates complete RFC-4180 CSV report when given full data", () => {
      const csv = generateSystemVitalsCSV(mockFullData);

      expect(csv).toContain("=== SYSTEM VITAL METRICS OVERVIEW ===");
      expect(csv).toContain("Time Range,7d");
      expect(csv).toContain("Total Search Queries,1250");
      expect(csv).toContain("Slow DB Queries (> 100ms),15");
      expect(csv).toContain("=== CORE WEB VITALS METRICS ===");
      expect(csv).toContain("Overall Web Vitals Score,94 / 100");
      expect(csv).toContain("LCP,ms,1850,2200,2750,good,300,85%,10%,5%");
      expect(csv).toContain("CLS,score,0.040,0.085,0.120,good,300,90%,8%,2%");
      expect(csv).toContain("=== WEB VITALS BY ROUTE ===");
      expect(csv).toContain("/venues/[id],LCP,2100,good,150");
      expect(csv).toContain("=== DAILY PLATFORM USAGE TRENDS ===");
      expect(csv).toContain("2026-10-25,180,65,12");
      expect(csv).toContain("=== AI AGENT RUNTIME BREAKDOWN ===");
      expect(csv).toContain("ConciergeAgent,210,450,120");
      expect(csv).toContain("=== DATABASE QUERY LATENCY BY MODEL ===");
      expect(csv).toContain("Venue,8.2,22.1,2200");
    });

    it("returns empty string when data is null or undefined", () => {
      expect(generateSystemVitalsCSV(null as unknown as SystemVitalsExportData)).toBe("");
      expect(
        generateSystemVitalsCSV(undefined as unknown as SystemVitalsExportData),
      ).toBe("");
    });

    it("safely handles minimal data with missing sections and arrays", () => {
      const minimalData: SystemVitalsExportData = {
        range: "30d",
        generatedAt: "2026-10-26T12:00:00Z",
        overview: null as any,
        usageTrend: null as any,
        agentLatencyTrend: undefined as any,
        agentBreakdown: [] as any,
        dbLatency: null as any,
      };

      const csv = generateSystemVitalsCSV(minimalData);
      expect(csv).toContain("=== SYSTEM VITAL METRICS OVERVIEW ===");
      expect(csv).toContain("Time Range,30d");
      expect(csv).toContain("Total Search Queries,0");
      expect(csv).toContain("Slow DB Queries (> 100ms),0");
      expect(csv).not.toContain("=== DAILY PLATFORM USAGE TRENDS ===");
      expect(csv).not.toContain("=== CORE WEB VITALS METRICS ===");
    });
  });

  describe("downloadSystemVitalsCSV", () => {
    it("creates blob and triggers browser download", () => {
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const appendSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(document.body, "removeChild");

      const data: SystemVitalsExportData = {
        range: "24h",
        generatedAt: "2026-10-26T12:00:00Z",
        overview: {
          totalSearches: 10,
          totalVenueClicks: 5,
          totalReviews: 2,
          agentAvgMs: 120,
          agentP95Ms: 250,
        },
        usageTrend: [],
        agentLatencyTrend: [],
        agentBreakdown: [],
        dbLatency: {
          totalQueryCount: 50,
          slowQueryCount: 0,
          slowQueryThresholdMs: 100,
          avgMs: 5,
          p95Ms: 12,
          byModel: [],
        },
      };

      const blob = downloadSystemVitalsCSV(data, "custom-vitals.csv");
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("text/csv;charset=utf-8;");
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(appendSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();

      clickSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("handles nullish data gracefully without throwing", () => {
      const blob = downloadSystemVitalsCSV(null as unknown as SystemVitalsExportData);
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  describe("generateWebVitalsCSV", () => {
    it("returns empty string on nullish data", () => {
      expect(generateWebVitalsCSV(null as unknown as AggregatedWebVitals)).toBe("");
    });

    it("formats Web Vitals with route breakdowns and handles NaN percentiles", () => {
      const data: AggregatedWebVitals = {
        timeRange: "30d",
        generatedAt: "2026-10-26T12:00:00Z",
        overallScore: 88,
        totalSamples: 500,
        metrics: {
          LCP: {
            p50: NaN,
            p75: 2300,
            p90: 3100,
            rating: "needs-improvement",
            sampleCount: 100,
            distribution: { good: 60, needsImprovement: 30, poor: 10 },
          },
        },
        routes: [
          {
            route: "/explore",
            metrics: {
              LCP: {
                p75: 2250,
                rating: "good",
                sampleCount: 50,
              },
            },
          },
        ],
      };

      const csv = generateWebVitalsCSV(data);
      expect(csv).toContain("=== GOOGLE WEB VITALS PERFORMANCE REPORT ===");
      expect(csv).toContain("Time Range,30d");
      expect(csv).toContain("Overall Performance Score,88 / 100");
      expect(csv).toContain("LCP,ms,0,2300,3100,needs-improvement,100,60%,30%,10%");
      expect(csv).toContain("=== ROUTE-LEVEL BREAKDOWN ===");
      expect(csv).toContain("/explore,LCP,2250,good,50");
    });
  });

  describe("downloadWebVitalsCSV", () => {
    it("creates blob and triggers browser download", () => {
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const appendSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(document.body, "removeChild");

      const data: AggregatedWebVitals = {
        timeRange: "7d",
        generatedAt: "2026-10-26T12:00:00Z",
        overallScore: 95,
        totalSamples: 100,
        metrics: {},
      };

      const blob = downloadWebVitalsCSV(data, "custom-web-vitals.csv");
      expect(blob).toBeInstanceOf(Blob);
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();

      clickSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });
});
