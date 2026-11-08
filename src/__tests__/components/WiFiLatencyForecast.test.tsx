import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import {
  WiFiLatencyForecast,
  computePingStats,
  measurePingSamples,
  type PingStats,
} from "@/components/wifi/WiFiLatencyForecast";

// Mock recharts ResponsiveContainer to render children in test environment
jest.mock("recharts", () => {
  const OriginalModule = jest.requireActual("recharts");
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 500, height: 300 }}>{children}</div>
    ),
  };
});

// Mock useWiFiLatency to provide deterministic forecast data without web workers
jest.mock("@/hooks/useWiFiLatency", () => ({
  useWiFiLatency: jest.fn(() => ({
    predictions: {
      hourlyLatency: Array.from({ length: 24 }, (_, i) => 20 + (i % 5)),
      hourlyPacketLoss: Array.from({ length: 24 }, () => 0.5),
      peakHours: [12, 13, 14],
      bestTimeSlot: { hour: 6, latency: 15 },
      confidence: 0.95,
    },
    isLoading: false,
    predict: jest.fn(),
  })),
}));

describe("WiFiLatencyForecast - Math & Statistics Logic", () => {
  describe("computePingStats", () => {
    it("computes mean latency and jitter (standard deviation) correctly across 5 samples", () => {
      // Samples: 20, 24, 22, 21, 23
      // Mean: (20 + 24 + 22 + 21 + 23) / 5 = 110 / 5 = 22.0
      // Variance: ((20-22)^2 + (24-22)^2 + (22-22)^2 + (21-22)^2 + (23-22)^2) / 5 = (4 + 4 + 0 + 1 + 1) / 5 = 2.0
      // Std Dev (Jitter): sqrt(2.0) = 1.414... -> 1.4
      const stats = computePingStats([20, 24, 22, 21, 23], 5);

      expect(stats.meanLatency).toBe(22);
      expect(stats.jitter).toBe(1.4);
      expect(stats.packetLossPct).toBe(0);
      expect(stats.isCallReady).toBe(true);
      expect(stats.qualityLabel).toBe("Zoom/Meet Ready");
      expect(stats.healthBadgeText).toBe("Call Ready - Jitter < 10ms");
    });

    it("correctly identifies Poor for Calls when jitter is high", () => {
      // High jitter samples: [10, 80, 15, 85, 20]
      const stats = computePingStats([10, 80, 15, 85, 20], 5);

      expect(stats.meanLatency).toBeGreaterThan(0);
      expect(stats.jitter).toBeGreaterThan(15);
      expect(stats.packetLossPct).toBe(0);
      expect(stats.isCallReady).toBe(false);
      expect(stats.qualityLabel).toBe("Poor for Calls");
      expect(stats.healthBadgeText).toContain("Poor for Calls - Jitter");
    });

    it("computes packet loss percentage when pings fail", () => {
      // 2 failed probes out of 5 = 40% packet loss
      const stats = computePingStats([20, null, 25, null, 22], 5);

      expect(stats.packetLossPct).toBe(40);
      expect(stats.successfulCount).toBe(3);
      expect(stats.totalSamples).toBe(5);
      expect(stats.isCallReady).toBe(false);
      expect(stats.qualityLabel).toBe("Poor for Calls");
      expect(stats.healthBadgeText).toBe("Poor for Calls - 40% Loss");
    });

    it("handles 100% packet loss gracefully", () => {
      const stats = computePingStats([null, null, null, null, null], 5);

      expect(stats.meanLatency).toBe(0);
      expect(stats.jitter).toBe(0);
      expect(stats.packetLossPct).toBe(100);
      expect(stats.isCallReady).toBe(false);
      expect(stats.qualityLabel).toBe("Poor for Calls");
      expect(stats.healthBadgeText).toBe("Poor for Calls - 100% Loss");
    });

    it("handles single successful ping sample (zero variance)", () => {
      const stats = computePingStats([25, null, null, null, null], 5);

      expect(stats.meanLatency).toBe(25);
      expect(stats.jitter).toBe(0);
      expect(stats.packetLossPct).toBe(80);
      expect(stats.isCallReady).toBe(false);
      expect(stats.qualityLabel).toBe("Poor for Calls");
    });
  });

  describe("measurePingSamples", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("executes 5 consecutive HTTP HEAD requests with cache: no-store", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      global.fetch = mockFetch;

      const samples = await measurePingSamples("/api/test-ping", 5);

      expect(samples.length).toBe(5);
      expect(mockFetch).toHaveBeenCalledTimes(5);
      for (const call of mockFetch.mock.calls) {
        expect(call[0]).toContain("/api/test-ping");
        expect(call[0]).toContain("probe=");
        expect(call[1]).toEqual(
          expect.objectContaining({
            method: "HEAD",
            cache: "no-store",
          }),
        );
      }
    });

    it("records null for failed or non-200 HTTP responses", async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2 || callCount === 4) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const samples = await measurePingSamples("/api/test-ping", 5);

      expect(samples.length).toBe(5);
      expect(samples[1]).toBeNull();
      expect(samples[3]).toBeNull();
      expect(typeof samples[0]).toBe("number");
      expect(typeof samples[2]).toBe("number");
      expect(typeof samples[4]).toBe("number");
    });

    it("records null when fetch throws network error", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("Network failed"));

      const samples = await measurePingSamples("/api/test-ping", 5);

      expect(samples.length).toBe(5);
      expect(samples.every((s) => s === null)).toBe(true);
    });

    it("aborts ping measurements when signal is aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const samples = await measurePingSamples(
        "/api/test-ping",
        5,
        controller.signal,
      );

      expect(samples.length).toBe(0);
    });
  });
});

describe("WiFiLatencyForecast - Component UI & Live Quality Measurements", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("renders with initial Call Ready ping stats", () => {
    const readyStats: PingStats = {
      samples: [20, 22, 21, 23, 22],
      successfulCount: 5,
      totalSamples: 5,
      meanLatency: 21.6,
      jitter: 1.0,
      packetLossPct: 0,
      isCallReady: true,
      qualityLabel: "Zoom/Meet Ready",
      healthBadgeText: "Call Ready - Jitter < 10ms",
    };

    render(
      <WiFiLatencyForecast
        venueId="venue-123"
        venueName="Central Cowork"
        autoTest={false}
        initialPingStats={readyStats}
      />,
    );

    // Visual connection quality indicator
    expect(
      screen.getByTestId("connection-quality-indicator"),
    ).toHaveTextContent("Zoom/Meet Ready");

    // Health badge
    const healthBadge = screen.getByTestId("health-badge");
    expect(healthBadge).toHaveTextContent("Call Ready - Jitter < 10ms");

    // Metrics display
    expect(screen.getByTestId("mean-latency-value")).toHaveTextContent(
      "21.6ms",
    );
    expect(screen.getByTestId("jitter-value")).toHaveTextContent("1ms");
    expect(screen.getByTestId("packet-loss-value")).toHaveTextContent("0%");

    // Retry button presence
    expect(screen.getByTestId("retest-ping-btn")).toBeInTheDocument();
  });

  it("renders with Poor for Calls connection quality indicator when packet loss occurs", () => {
    const poorStats: PingStats = {
      samples: [40, null, 42, null, 38],
      successfulCount: 3,
      totalSamples: 5,
      meanLatency: 40.0,
      jitter: 1.6,
      packetLossPct: 40,
      isCallReady: false,
      qualityLabel: "Poor for Calls",
      healthBadgeText: "Poor for Calls - 40% Loss",
    };

    render(
      <WiFiLatencyForecast
        venueId="venue-456"
        venueName="Cafe Rustica"
        autoTest={false}
        initialPingStats={poorStats}
      />,
    );

    expect(
      screen.getByTestId("connection-quality-indicator"),
    ).toHaveTextContent("Poor for Calls");
    expect(screen.getByTestId("health-badge")).toHaveTextContent(
      "Poor for Calls - 40% Loss",
    );
    expect(screen.getByTestId("packet-loss-value")).toHaveTextContent("40%");
  });

  it("performs auto-test on mount and measures 5 HTTP HEAD samples", async () => {
    const onTestComplete = jest.fn();

    render(
      <WiFiLatencyForecast
        venueId="venue-auto"
        venueName="Nomad Hub"
        autoTest={true}
        onTestComplete={onTestComplete}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    await waitFor(() => {
      expect(onTestComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSamples: 5,
          successfulCount: 5,
          packetLossPct: 0,
        }),
      );
    });

    expect(
      screen.getByTestId("connection-quality-indicator"),
    ).toHaveTextContent("Zoom/Meet Ready");
    expect(screen.getByTestId("health-badge")).toBeInTheDocument();
  });

  it("triggers re-test when retry button is clicked", async () => {
    const readyStats: PingStats = {
      samples: [20, 22, 21, 23, 22],
      successfulCount: 5,
      totalSamples: 5,
      meanLatency: 21.6,
      jitter: 1.0,
      packetLossPct: 0,
      isCallReady: true,
      qualityLabel: "Zoom/Meet Ready",
      healthBadgeText: "Call Ready - Jitter < 10ms",
    };

    render(
      <WiFiLatencyForecast
        venueId="venue-retry"
        venueName="Workspace Loft"
        autoTest={false}
        initialPingStats={readyStats}
      />,
    );

    const retryBtn = screen.getByTestId("retest-ping-btn");
    expect(retryBtn).toHaveTextContent("Re-test Connection");

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    expect(
      screen.getByTestId("connection-quality-indicator"),
    ).toHaveTextContent("Zoom/Meet Ready");
  });
});
