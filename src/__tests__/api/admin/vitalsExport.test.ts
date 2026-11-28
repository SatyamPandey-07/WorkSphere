import { NextRequest } from "next/server";
import { GET, escapeCsvField, aggregateRouteMetrics, formatMetricsCsv } from "@/app/api/admin/vitals/export/route";
import * as adminAuth from "@/lib/admin";
import * as rateLimiter from "@/lib/rateLimit";
import * as perfCollector from "@/lib/telemetry/collectors/performanceCollector";
import type { RouteHeatmapRow, RouteLatencyHeatmapData } from "@/lib/telemetry/types";

jest.mock("@/lib/admin");
jest.mock("@/lib/rateLimit");
jest.mock("@/lib/telemetry/collectors/performanceCollector");

const mockAdminUser = {
  id: "admin-123",
  role: "admin",
  email: "admin@worksphere.io",
  firstName: "Admin",
  lastName: "User",
};

const mockRoutes: RouteHeatmapRow[] = [
  {
    route: "GET /api/venues",
    displayName: "Venues API",
    category: "api",
    totalRequests: 1200,
    overallAvgMs: 45,
    overallP95Ms: 95,
    isSlowPath: false,
    severity: "normal",
    cells: [
      {
        bucketIndex: 0,
        timeLabel: "10:00",
        timestamp: 1700000000000,
        route: "GET /api/venues",
        count: 600,
        avgMs: 42,
        p50Ms: 38,
        p95Ms: 90,
        minMs: 20,
        maxMs: 120,
        status: "normal",
      },
      {
        bucketIndex: 1,
        timeLabel: "10:05",
        timestamp: 1700000300000,
        route: "GET /api/venues",
        count: 600,
        avgMs: 48,
        p50Ms: 40,
        p95Ms: 100,
        minMs: 25,
        maxMs: 140,
        status: "normal",
      },
    ],
  },
  {
    route: "POST /api/ai/chat",
    displayName: "AI Assistant",
    category: "ai",
    totalRequests: 500,
    overallAvgMs: 350,
    overallP95Ms: 800,
    isSlowPath: true,
    severity: "red",
    cells: [
      {
        bucketIndex: 0,
        timeLabel: "10:00",
        timestamp: 1700000000000,
        route: "POST /api/ai/chat",
        count: 250,
        avgMs: 340,
        p50Ms: 310,
        p95Ms: 780,
        minMs: 150,
        maxMs: 900,
        status: "red",
      },
      {
        bucketIndex: 1,
        timeLabel: "10:05",
        timestamp: 1700000300000,
        route: "POST /api/ai/chat",
        count: 250,
        avgMs: 360,
        p50Ms: 330,
        p95Ms: 820,
        minMs: 160,
        maxMs: 950,
        status: "red",
      },
    ],
  },
];

const mockHeatmapData: RouteLatencyHeatmapData = {
  generatedAt: "2026-11-22T10:00:00.000Z",
  range: "24h",
  bucketIntervalMinutes: 5,
  timeBuckets: [
    { index: 0, label: "10:00", timestamp: 1700000000000 },
    { index: 1, label: "10:05", timestamp: 1700000300000 },
  ],
  routes: mockRoutes,
};

describe("Admin Vitals Export API — Route Latency Telemetry Heatmap (#9437)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (adminAuth.getAdminUser as jest.Mock).mockResolvedValue(mockAdminUser);
    (rateLimiter.rateLimit as jest.Mock).mockResolvedValue(true);
    (rateLimiter.getRateLimitInfo as jest.Mock).mockResolvedValue({
      remaining: 29,
      resetTime: Date.now() + 60000,
    });
    (perfCollector.getRouteLatencyHeatmapData as jest.Mock).mockResolvedValue(mockHeatmapData);
  });

  describe("1. Authorization Checks", () => {
    it("returns 403 Forbidden when user is not authenticated as admin", async () => {
      (adminAuth.getAdminUser as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export?format=json");
      const res = await GET(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/admin access required/i);
      // Ensure telemetry aggregation was NOT called prior to auth check
      expect(perfCollector.getRouteLatencyHeatmapData).not.toHaveBeenCalled();
    });

    it("returns 403 Forbidden when getAdminUser throws an error", async () => {
      (adminAuth.getAdminUser as jest.Mock).mockRejectedValue(new Error("Auth DB failure"));

      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export?format=csv");
      const res = await GET(req);

      expect(res.status).toBe(403);
      expect(perfCollector.getRouteLatencyHeatmapData).not.toHaveBeenCalled();
    });
  });

  describe("2. Parameter Validation", () => {
    it("defaults format to json and window to 24h when omitted", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export");
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const data = await res.json();
      expect(data.window).toBe("24h");
      expect(perfCollector.getRouteLatencyHeatmapData).toHaveBeenCalledWith("24h");
    });

    it("rejects invalid format with 400 Bad Request", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export?format=xml");
      const res = await GET(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid format/i);
      expect(perfCollector.getRouteLatencyHeatmapData).not.toHaveBeenCalled();
    });

    it("rejects invalid window with 400 Bad Request", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export?window=1y");
      const res = await GET(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid window/i);
      expect(perfCollector.getRouteLatencyHeatmapData).not.toHaveBeenCalled();
    });

    it("accepts valid window options (24h, 7d, 30d)", async () => {
      for (const win of ["24h", "7d", "30d"]) {
        const req = new NextRequest(`http://localhost:3000/api/admin/vitals/export?window=${win}`);
        const res = await GET(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.window).toBe(win);
      }
    });
  });

  describe("3. Rate Limiting", () => {
    it("returns 429 Too Many Requests when rate limit is exceeded", async () => {
      (rateLimiter.rateLimit as jest.Mock).mockResolvedValue(false);
      (rateLimiter.getRateLimitInfo as jest.Mock).mockResolvedValue({
        remaining: 0,
        resetTime: Date.now() + 45000,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export");
      const res = await GET(req);

      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBeDefined();
      expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
      const json = await res.json();
      expect(json.error).toMatch(/too many export requests/i);
      expect(perfCollector.getRouteLatencyHeatmapData).not.toHaveBeenCalled();
    });

    it("includes standard rate limit headers on successful responses", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export");
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("x-ratelimit-limit")).toBe("30");
      expect(res.headers.get("x-ratelimit-remaining")).toBe("29");
      expect(res.headers.get("ratelimit-limit")).toBe("30");
    });
  });

  describe("4. JSON Serialization", () => {
    it("returns properly structured JSON with metadata, definitions, routes, and summary", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export?format=json&window=7d");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.window).toBe("7d");
      expect(json.unit).toBe("milliseconds");
      expect(json.generatedAt).toBeDefined();
      expect(json.definitions).toMatchObject({
        p50LatencyMs: expect.any(String),
        p95LatencyMs: expect.any(String),
        p99LatencyMs: expect.any(String),
        errorRate: expect.any(String),
      });

      expect(Array.isArray(json.routes)).toBe(true);
      expect(json.routes.length).toBe(2);

      const firstRoute = json.routes[0];
      expect(firstRoute).toMatchObject({
        route: "GET /api/venues",
        requestVolume: 1200,
        p50LatencyMs: expect.any(Number),
        p95LatencyMs: 95,
        p99LatencyMs: expect.any(Number),
        errorCount: expect.any(Number),
        errorRate: expect.any(Number),
      });

      expect(json.summary).toMatchObject({
        totalRoutes: 2,
        totalRequests: 1700,
        totalErrors: expect.any(Number),
      });
    });
  });

  describe("5. CSV Serialization", () => {
    it("returns RFC 4180 compliant CSV with required columns and headers", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export?format=csv&window=24h");
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="route-latency-vitals.csv"');

      const csvText = await res.text();
      const lines = csvText.split("\r\n");

      // Verify exact header row
      expect(lines[0]).toBe("Route,Request Volume,P50 Latency (ms),P95 Latency (ms),P99 Latency (ms),Error Count,Error Rate");

      // Verify data lines
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines[1]).toContain("GET /api/venues");
      expect(lines[2]).toContain("POST /api/ai/chat");
    });

    it("mitigates CSV formula injection for malicious values", () => {
      expect(escapeCsvField("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(escapeCsvField("+CMD|' /C calc'!A0")).toBe("'+CMD|' /C calc'!A0");
      expect(escapeCsvField("-2+3*[calc]")).toBe("'-2+3*[calc]");
      expect(escapeCsvField("@malicious_call")).toBe("'@malicious_call");
      expect(escapeCsvField("\tTabInjected")).toBe("'\tTabInjected");
    });

    it("correctly escapes values with commas, quotes, and newlines", () => {
      expect(escapeCsvField('Hello, "World"')).toBe('"Hello, ""World"""');
      expect(escapeCsvField("Line1\nLine2")).toBe('"Line1\nLine2"');
    });
  });

  describe("6. Edge Cases & Error Handling", () => {
    it("handles empty routes array gracefully in both JSON and CSV", async () => {
      (perfCollector.getRouteLatencyHeatmapData as jest.Mock).mockResolvedValue({
        generatedAt: "2026-11-22T10:00:00.000Z",
        range: "24h",
        timeBuckets: [],
        routes: [],
      });

      // JSON export
      const jsonReq = new NextRequest("http://localhost:3000/api/admin/vitals/export?format=json");
      const jsonRes = await GET(jsonReq);
      expect(jsonRes.status).toBe(200);
      const jsonData = await jsonRes.json();
      expect(jsonData.routes).toEqual([]);
      expect(jsonData.summary.totalRoutes).toBe(0);
      expect(jsonData.summary.totalRequests).toBe(0);

      // CSV export
      const csvReq = new NextRequest("http://localhost:3000/api/admin/vitals/export?format=csv");
      const csvRes = await GET(csvReq);
      expect(csvRes.status).toBe(200);
      const csvText = await csvRes.text();
      expect(csvText).toBe("Route,Request Volume,P50 Latency (ms),P95 Latency (ms),P99 Latency (ms),Error Count,Error Rate");
    });

    it("returns 500 when performance collector throws an unexpected error", async () => {
      (perfCollector.getRouteLatencyHeatmapData as jest.Mock).mockRejectedValue(new Error("Telemetry DB Down"));

      const req = new NextRequest("http://localhost:3000/api/admin/vitals/export");
      const res = await GET(req);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/failed to export route latency vitals/i);
    });
  });
});
