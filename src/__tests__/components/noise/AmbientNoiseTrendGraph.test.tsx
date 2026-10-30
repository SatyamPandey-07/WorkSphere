import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  AmbientNoiseTrendGraph,
  getNoiseLevelColor,
  getNoiseLevelCategory,
} from "@/components/noise/AmbientNoiseTrendGraph";
import type { HourlyForecast } from "@/lib/noiseForecast";

// Lightweight Recharts mock for fast execution & zero memory leaks
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="mock-responsive-container">{children}</div>
  ),
  BarChart: ({ children, data }: any) => (
    <div data-testid="mock-bar-chart" data-points-count={data?.length}>
      {children}
    </div>
  ),
  Bar: ({ children }: any) => <div data-testid="mock-bar">{children}</div>,
  XAxis: () => <div data-testid="mock-xaxis" />,
  YAxis: () => <div data-testid="mock-yaxis" />,
  CartesianGrid: () => <div data-testid="mock-cartesian-grid" />,
  Tooltip: ({ content }: any) => {
    if (typeof content === "function") {
      const samplePayload = [
        {
          payload: {
            hour: 9,
            label: "9 AM",
            period: "morning",
            medianDb: 44,
            samples: 5,
            confidence: 88,
            color: "#22c55e",
            statusText: "Quiet (<50 dB)",
          },
        },
      ];
      return (
        <div data-testid="mock-tooltip">
          {content({ active: true, payload: samplePayload })}
        </div>
      );
    }
    return <div data-testid="mock-tooltip" />;
  },
  Cell: () => <div data-testid="mock-cell" />,
  ReferenceLine: () => <div data-testid="mock-reference-line" />,
}));

describe("AmbientNoiseTrendGraph", () => {
  const sampleForecast: HourlyForecast[] = [
    { hour: 8, medianDb: 40, samples: 10, confidence: 95 },
    { hour: 9, medianDb: 44, samples: 8, confidence: 90 },
    { hour: 12, medianDb: 62, samples: 15, confidence: 85 },
    { hour: 15, medianDb: 75, samples: 20, confidence: 80 },
    { hour: 20, medianDb: 48, samples: 6, confidence: 88 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Helper functions", () => {
    it("returns correct colors across dB thresholds", () => {
      expect(getNoiseLevelColor(null)).toBe("#71717a");
      expect(getNoiseLevelColor(NaN)).toBe("#71717a");
      expect(getNoiseLevelColor(35)).toBe("#22c55e");
      expect(getNoiseLevelColor(49.9)).toBe("#22c55e");
      expect(getNoiseLevelColor(50)).toBe("#eab308");
      expect(getNoiseLevelColor(70)).toBe("#eab308");
      expect(getNoiseLevelColor(70.1)).toBe("#f97316");
      expect(getNoiseLevelColor(85)).toBe("#f97316");
    });

    it("returns correct category labels across dB thresholds", () => {
      expect(getNoiseLevelCategory(null)).toBe("No Data");
      expect(getNoiseLevelCategory(NaN)).toBe("No Data");
      expect(getNoiseLevelCategory(42)).toBe("Quiet (<50 dB)");
      expect(getNoiseLevelCategory(55)).toBe("Moderate (50-70 dB)");
      expect(getNoiseLevelCategory(78)).toBe("Loud (>70 dB)");
    });
  });

  describe("Component Rendering", () => {
    it("renders provided forecast data with quietest hour badge and custom title", () => {
      render(
        <AmbientNoiseTrendGraph
          forecast={sampleForecast}
          title="Downtown Cafe Noise Telemetry"
        />
      );

      expect(screen.getByTestId("noise-trend-title")).toHaveTextContent(
        "Downtown Cafe Noise Telemetry"
      );
      const quietestBadge = screen.getByTestId("quietest-hour-badge");
      expect(quietestBadge).toBeInTheDocument();
      expect(quietestBadge).toHaveTextContent("Quietest: 8 AM (40 dB)");

      // Check chart container & tooltip payload
      expect(screen.getByTestId("noise-trend-chart-container")).toBeInTheDocument();
      expect(screen.getByTestId("noise-trend-tooltip")).toBeInTheDocument();
      expect(screen.getByText("Quiet (<50 dB)", { exact: false })).toBeInTheDocument();
    });

    it("filters hours by time bracket when clicking pill buttons", () => {
      render(<AmbientNoiseTrendGraph forecast={sampleForecast} />);

      const allBtn = screen.getByTestId("bracket-all-btn");
      const morningBtn = screen.getByTestId("bracket-morning-btn");
      const eveningBtn = screen.getByTestId("bracket-evening-btn");

      expect(allBtn).toHaveAttribute("aria-pressed", "true");
      expect(morningBtn).toHaveAttribute("aria-pressed", "false");
      expect(eveningBtn).toHaveAttribute("aria-pressed", "false");

      // Filter to morning (8 AM - 2 PM: hours 8 to 13 = 6 hours)
      fireEvent.click(morningBtn);
      expect(morningBtn).toHaveAttribute("aria-pressed", "true");
      expect(allBtn).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("mock-bar-chart")).toHaveAttribute(
        "data-points-count",
        "6"
      );

      // Filter to evening (2 PM - 10 PM: hours 14 to 22 = 9 hours)
      fireEvent.click(eveningBtn);
      expect(eveningBtn).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("mock-bar-chart")).toHaveAttribute(
        "data-points-count",
        "9"
      );

      // Switch back to all hours (hours 8 to 22 = 15 hours)
      fireEvent.click(allBtn);
      expect(allBtn).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("mock-bar-chart")).toHaveAttribute(
        "data-points-count",
        "15"
      );
    });

    it("fetches noise metrics from API when venueId is provided without initial forecast", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ forecast: sampleForecast }),
      });

      render(<AmbientNoiseTrendGraph venueId="venue-paris-101" />);

      expect(screen.getByTestId("noise-trend-loading")).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByTestId("noise-trend-loading")).not.toBeInTheDocument();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/venues/venue-paris-101/noise-metrics/forecast")
      );
      expect(screen.getByTestId("quietest-hour-badge")).toHaveTextContent(
        "Quietest: 8 AM (40 dB)"
      );
    });

    it("displays error alert banner on API failure and retries on button click", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      render(<AmbientNoiseTrendGraph venueId="venue-fail-99" />);

      await waitFor(() => {
        expect(screen.getByTestId("noise-trend-error")).toBeInTheDocument();
      });

      expect(screen.getByText(/Failed to load noise metrics forecast \(HTTP 503\)/i)).toBeInTheDocument();

      // Mock successful retry
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ forecast: sampleForecast }),
      });

      const retryBtn = screen.getByTestId("noise-trend-retry-btn");
      await act(async () => {
        fireEvent.click(retryBtn);
      });

      await waitFor(() => {
        expect(screen.queryByTestId("noise-trend-error")).not.toBeInTheDocument();
      });

      expect(screen.getByTestId("quietest-hour-badge")).toBeInTheDocument();
    });

    it("renders custom testId and className", () => {
      render(
        <AmbientNoiseTrendGraph
          forecast={sampleForecast}
          testId="custom-noise-graph"
          className="my-custom-layout-class"
        />
      );

      const root = screen.getByTestId("custom-noise-graph");
      expect(root).toBeInTheDocument();
      expect(root).toHaveClass("my-custom-layout-class");
    });
  });
});
