import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  RouteLatencyHeatmap,
  escapeCsvField,
  getRouteMethod,
  getRoutePath,
  formatRouteLatencyHeatmapCSV,
  RouteLatencyCsvRow,
} from "@/components/admin/RouteLatencyHeatmap";
import type { RouteLatencyHeatmapData } from "@/lib/telemetry/types";

// Mock PartySocket hook
jest.mock("@/hooks/usePartySocketReconnect", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock RouteLatencyHeatmapCanvas
jest.mock("@/components/admin/RouteLatencyHeatmapCanvas", () => ({
  RouteLatencyHeatmap: () => <div data-testid="mock-geo-canvas" />,
}));

const mockHeatmapData: RouteLatencyHeatmapData = {
  generatedAt: "2026-11-21T12:00:00.000Z",
  range: "1h",
  bucketIntervalMinutes: 5,
  timeBuckets: [
    { index: 0, label: "12:00", timestamp: 1700000000000 },
    { index: 1, label: "12:05", timestamp: 1700000300000 },
  ],
  routes: [
    {
      route: "/api/ai/chat",
      displayName: "AI Assistant",
      category: "ai",
      totalRequests: 250,
      overallAvgMs: 290,
      overallP95Ms: 310,
      isSlowPath: true,
      severity: "red",
      cells: [
        {
          bucketIndex: 0,
          timeLabel: "12:00",
          timestamp: 1700000000000,
          route: "/api/ai/chat",
          count: 120,
          avgMs: 280,
          p50Ms: 260,
          p95Ms: 305,
          minMs: 150,
          maxMs: 390,
          status: "red",
        },
        {
          bucketIndex: 1,
          timeLabel: "12:05",
          timestamp: 1700000300000,
          route: "/api/ai/chat",
          count: 130,
          avgMs: 300,
          p50Ms: 270,
          p95Ms: 315,
          minMs: 160,
          maxMs: 410,
          status: "red",
        },
      ],
    },
    {
      route: "POST /api/venues/search",
      displayName: "Spatial Vector Search",
      category: "api",
      totalRequests: 500,
      overallAvgMs: 85,
      overallP95Ms: 120,
      isSlowPath: false,
      severity: "normal",
      cells: [
        {
          bucketIndex: 0,
          timeLabel: "12:00",
          timestamp: 1700000000000,
          route: "POST /api/venues/search",
          count: 250,
          avgMs: 80,
          p50Ms: 70,
          p95Ms: 110,
          minMs: 30,
          maxMs: 150,
          status: "normal",
        },
        {
          bucketIndex: 1,
          timeLabel: "12:05",
          timestamp: 1700000300000,
          route: "POST /api/venues/search",
          count: 250,
          avgMs: 90,
          p50Ms: 75,
          p95Ms: 130,
          minMs: 35,
          maxMs: 160,
          status: "normal",
        },
      ],
    },
  ],
  summary: {
    totalEndpoints: 2,
    slowEndpointsCount: 1,
    criticalEndpointsCount: 1,
    systemP95Ms: 310,
    systemAvgMs: 187,
    totalRequests: 750,
  },
};

describe("RouteLatencyHeatmap CSV Export", () => {
  let createdObjectURLs: string[] = [];
  let revokedObjectURLs: string[] = [];
  let appendChildSpy: jest.SpyInstance;
  let removeChildSpy: jest.SpyInstance;
  let clickSpy: jest.Mock;

  beforeAll(() => {
    // Mock ResizeObserver
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;

    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = jest.fn((_blob: Blob) => {
      const url = `blob:http://localhost/mock-blob-${createdObjectURLs.length}`;
      createdObjectURLs.push(url);
      return url;
    });

    global.URL.revokeObjectURL = jest.fn((url: string) => {
      revokedObjectURLs.push(url);
    });

    // Mock HTMLCanvasElement WebGL context
    HTMLCanvasElement.prototype.getContext = jest.fn((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {
          VERTEX_SHADER: 35633,
          FRAGMENT_SHADER: 35632,
          COMPILE_STATUS: 35713,
          LINK_STATUS: 35714,
          ARRAY_BUFFER: 34962,
          STATIC_DRAW: 35044,
          FLOAT: 5126,
          TRIANGLE_STRIP: 5,
          CURRENT_PROGRAM: 35725,
          createShader: jest.fn(() => ({})),
          shaderSource: jest.fn(),
          compileShader: jest.fn(),
          getShaderParameter: jest.fn(() => true),
          getShaderInfoLog: jest.fn(() => ""),
          deleteShader: jest.fn(),
          createProgram: jest.fn(() => ({})),
          attachShader: jest.fn(),
          linkProgram: jest.fn(),
          getProgramParameter: jest.fn(() => true),
          getProgramInfoLog: jest.fn(() => ""),
          deleteProgram: jest.fn(),
          useProgram: jest.fn(),
          createBuffer: jest.fn(() => ({})),
          bindBuffer: jest.fn(),
          bufferData: jest.fn(),
          deleteBuffer: jest.fn(),
          getAttribLocation: jest.fn(() => 0),
          enableVertexAttribArray: jest.fn(),
          vertexAttribPointer: jest.fn(),
          getUniformLocation: jest.fn(() => ({})),
          uniform2f: jest.fn(),
          uniform1f: jest.fn(),
          uniform3f: jest.fn(),
          uniform1i: jest.fn(),
          uniform4fv: jest.fn(),
          viewport: jest.fn(),
          drawArrays: jest.fn(),
          getParameter: jest.fn(() => ({})),
        };
      }
      return null;
    }) as any;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    createdObjectURLs = [];
    revokedObjectURLs = [];

    // Mock fetch for API endpoint
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockHeatmapData),
      }),
    ) as jest.Mock;
  });

  describe("CSV Formatter Unit Tests", () => {
    it("A. CSV headers: produces the exact seven columns in order", () => {
      const csv = formatRouteLatencyHeatmapCSV([]);
      const lines = csv.split("\r\n");
      expect(lines[0]).toBe(
        "Route Path,HTTP Method,Total Requests,p50 (ms),p95 (ms),p99 (ms),Error Rate (%)",
      );
    });

    it("A. CSV headers: includes headers even for empty datasets", () => {
      const csvEmpty = formatRouteLatencyHeatmapCSV([]);
      expect(csvEmpty).toBe(
        "Route Path,HTTP Method,Total Requests,p50 (ms),p95 (ms),p99 (ms),Error Rate (%)",
      );
    });

    it("B. Row formatting: exports correct fields and records with CRLF", () => {
      const rows: RouteLatencyCsvRow[] = [
        {
          route: "/api/ai/chat",
          totalRequests: 250,
          overallP95Ms: 310,
          overallAvgMs: 290,
          p50Ms: 260,
          p95Ms: 310,
          p99Ms: 388,
          errorRate: 0.05,
        },
      ];

      const csv = formatRouteLatencyHeatmapCSV(rows);
      const lines = csv.split("\r\n");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe("/api/ai/chat,GET,250,260,310,388,5");
    });

    it("B. Row formatting: correctly infers HTTP method from route prefix or falls back to GET", () => {
      expect(getRouteMethod("POST /api/venues/search")).toBe("POST");
      expect(getRoutePath("POST /api/venues/search")).toBe("/api/venues/search");

      expect(getRouteMethod("DELETE /api/bookings/123")).toBe("DELETE");
      expect(getRoutePath("DELETE /api/bookings/123")).toBe("/api/bookings/123");

      expect(getRouteMethod("/api/venues")).toBe("GET");
      expect(getRoutePath("/api/venues")).toBe("/api/venues");
    });

    it("C. RFC 4180 escaping: handles commas, quotes, and CRLF line endings", () => {
      // 1. Route with comma
      const escapedComma = escapeCsvField("/api/search,advanced");
      expect(escapedComma).toBe('"/api/search,advanced"');

      // 2. Route with double quotes (embedded quotes doubled)
      const escapedQuotes = escapeCsvField('/api/"special"');
      expect(escapedQuotes).toBe('"/api/""special"""');

      // 3. Route with newline
      const escapedNewline = escapeCsvField("/api/items\nall");
      expect(escapedNewline).toBe('"/api/items\nall"');

      // 4. Formula injection sanitization
      const formulaInjection = escapeCsvField("=SUM(A1:A10)");
      expect(formulaInjection).toBe("'=SUM(A1:A10)");

      // 5. Preserves ordinary values without quotes
      expect(escapeCsvField("/api/users")).toBe("/api/users");
      expect(escapeCsvField(123)).toBe("123");
      expect(escapeCsvField(null)).toBe("");
      expect(escapeCsvField(undefined)).toBe("");
    });
  });

  describe("Export Button UI and Download Handler", () => {
    it("renders export button in toolbar with accessible name", async () => {
      render(<RouteLatencyHeatmap />);

      await waitFor(() => {
        expect(screen.getByText("Live Route Latency Heatmap")).toBeInTheDocument();
      });

      const exportButton = screen.getByRole("button", {
        name: "Export Heatmap Data (.csv)",
      });
      expect(exportButton).toBeInTheDocument();
      expect(exportButton).toHaveAttribute("title", "Export Heatmap Data (.csv)");
    });

    it("triggers CSV generation, blob creation, download link click, and URL cleanup", async () => {
      clickSpy = jest.fn();
      const realCreateElement = document.createElement.bind(document);
      jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const el = realCreateElement(tagName);
        if (tagName.toLowerCase() === "a") {
          el.click = clickSpy;
        }
        return el;
      });

      appendChildSpy = jest.spyOn(document.body, "appendChild");
      removeChildSpy = jest.spyOn(document.body, "removeChild");

      render(<RouteLatencyHeatmap />);

      await waitFor(() => {
        expect(screen.getByText("AI Assistant")).toBeInTheDocument();
      });

      const exportButton = screen.getByRole("button", {
        name: "Export Heatmap Data (.csv)",
      });

      await act(async () => {
        fireEvent.click(exportButton);
      });

      // Verify Blob URL created
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
      const blobArg = (global.URL.createObjectURL as jest.Mock).mock.calls[0][0];
      expect(blobArg).toBeInstanceOf(Blob);
      expect(blobArg.type).toBe("text/csv;charset=utf-8");

      // Verify anchor click and append/remove
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();

      // Verify filename pattern: route-latency-heatmap-${timestamp}.csv
      const anchorElement = appendChildSpy.mock.calls.find(
        (call) => call[0]?.tagName?.toLowerCase() === "a",
      )?.[0] as HTMLAnchorElement;

      expect(anchorElement).toBeDefined();
      expect(anchorElement.download).toMatch(
        /^route-latency-heatmap-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/,
      );

      // Verify URL revoked
      expect(global.URL.revokeObjectURL).toHaveBeenCalledTimes(1);

      // Verify button restores normal state
      expect(exportButton).not.toBeDisabled();
      expect(exportButton).toHaveAttribute("aria-busy", "false");
    });

    it("prevents duplicate clicks while export is running", async () => {
      render(<RouteLatencyHeatmap />);

      await waitFor(() => {
        expect(screen.getByText("AI Assistant")).toBeInTheDocument();
      });

      const exportButton = screen.getByRole("button", {
        name: "Export Heatmap Data (.csv)",
      });

      // Rapidly click twice
      await act(async () => {
        fireEvent.click(exportButton);
        fireEvent.click(exportButton);
      });

      // Only one download sequence triggered
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it("restores button loading state even if download fails", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      (global.URL.createObjectURL as jest.Mock).mockImplementationOnce(() => {
        throw new Error("Disk quota exceeded");
      });

      render(<RouteLatencyHeatmap />);

      await waitFor(() => {
        expect(screen.getByText("AI Assistant")).toBeInTheDocument();
      });

      const exportButton = screen.getByRole("button", {
        name: "Export Heatmap Data (.csv)",
      });

      await act(async () => {
        fireEvent.click(exportButton);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[RouteLatencyHeatmap] CSV export failed:",
        expect.any(Error),
      );

      // State is restored to not busy
      expect(exportButton).toHaveAttribute("aria-busy", "false");
      expect(exportButton).not.toBeDisabled();

      consoleErrorSpy.mockRestore();
    });
  });
});
