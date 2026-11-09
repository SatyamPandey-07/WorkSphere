import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  HourlyNoiseHeatGraph,
  classifyDecibelBand,
  getBandColor,
  generateSyntheticNoiseCurve,
  DECIBEL_THRESHOLDS,
} from "@/components/venues/HourlyNoiseHeatGraph";

// Mock recharts
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="mock-responsive-container">{children}</div>
  ),
  ComposedChart: ({ children, data }: any) => (
    <div data-testid="mock-composed-chart" data-points-count={data?.length}>
      {children}
    </div>
  ),
  Area: () => <div data-testid="mock-area" />,
  Line: () => <div data-testid="mock-line" />,
  XAxis: () => <div data-testid="mock-xaxis" />,
  YAxis: () => <div data-testid="mock-yaxis" />,
  CartesianGrid: () => <div data-testid="mock-cartesian-grid" />,
  Tooltip: () => <div data-testid="mock-tooltip" />,
  ReferenceArea: () => <div data-testid="mock-reference-area" />,
  ReferenceLine: () => <div data-testid="mock-reference-line" />,
}));

describe("HourlyNoiseHeatGraph Component", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, metrics: [] }),
      })
    ) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Helper Functions", () => {
    it("classifyDecibelBand classifies noise levels accurately", () => {
      expect(classifyDecibelBand(30)).toBe("deep-work");
      expect(classifyDecibelBand(44.9)).toBe("deep-work");
      expect(classifyDecibelBand(45)).toBe("moderate");
      expect(classifyDecibelBand(55)).toBe("moderate");
      expect(classifyDecibelBand(65)).toBe("moderate");
      expect(classifyDecibelBand(65.1)).toBe("high-energy");
      expect(classifyDecibelBand(80)).toBe("high-energy");
    });

    it("getBandColor returns matching hex colors for all bands", () => {
      expect(getBandColor("deep-work")).toBe("#10b981"); // green
      expect(getBandColor("moderate")).toBe("#f59e0b");  // amber
      expect(getBandColor("high-energy")).toBe("#ef4444"); // red
    });

    it("generateSyntheticNoiseCurve returns 24 hourly data points", () => {
      const weekdayCurve = generateSyntheticNoiseCurve("venue-1", "weekday");
      expect(weekdayCurve).toHaveLength(24);
      expect(weekdayCurve[0].hour).toBe(0);
      expect(weekdayCurve[23].hour).toBe(23);

      const weekendCurve = generateSyntheticNoiseCurve("venue-1", "weekend");
      expect(weekendCurve).toHaveLength(24);
      expect(weekendCurve[0].hour).toBe(0);
      expect(weekendCurve[23].hour).toBe(23);
    });

    it("DECIBEL_THRESHOLDS has expected boundary values", () => {
      expect(DECIBEL_THRESHOLDS.deepWorkMax).toBe(45);
      expect(DECIBEL_THRESHOLDS.moderateMax).toBe(65);
    });
  });

  describe("Rendering and Interactivity", () => {
    it("renders nothing if venueId is empty", () => {
      const { container } = render(<HourlyNoiseHeatGraph venueId="" />);
      expect(container.firstChild).toBeNull();
    });

    it("renders the main container and header", async () => {
      render(<HourlyNoiseHeatGraph venueId="venue-123" venueName="Central Library" />);

      expect(screen.getByTestId("hourly-noise-heat-graph")).toBeInTheDocument();
      expect(screen.getByText("Hourly Historical Noise Profile")).toBeInTheDocument();
      expect(screen.getByText("Historical decibel curves for Central Library")).toBeInTheDocument();
    });

    it("renders the 3 decibel band legends", async () => {
      render(<HourlyNoiseHeatGraph venueId="venue-123" />);

      expect(screen.getByTestId("legend-band-deep-work")).toBeInTheDocument();
      expect(screen.getByTestId("legend-band-moderate")).toBeInTheDocument();
      expect(screen.getByTestId("legend-band-high-energy")).toBeInTheDocument();

      expect(screen.getByText(/Deep Work/i)).toBeInTheDocument();
      expect(screen.getByText(/Moderate Conversation/i)).toBeInTheDocument();
      expect(screen.getByText(/High Energy/i)).toBeInTheDocument();
    });

    it("toggles between Mon-Fri and Sat-Sun profiles", async () => {
      render(<HourlyNoiseHeatGraph venueId="venue-123" initialProfile="weekday" />);

      const weekdayBtn = screen.getByTestId("toggle-weekday");
      const weekendBtn = screen.getByTestId("toggle-weekend");

      expect(weekdayBtn).toBeInTheDocument();
      expect(weekendBtn).toBeInTheDocument();

      // Click weekend
      fireEvent.click(weekendBtn);
      expect(screen.getByTestId("mock-composed-chart")).toBeInTheDocument();

      // Click weekday back
      fireEvent.click(weekdayBtn);
      expect(screen.getByTestId("mock-composed-chart")).toBeInTheDocument();
    });

    it("displays live sensor badge overlay", async () => {
      render(
        <HourlyNoiseHeatGraph
          venueId="venue-123"
          liveReadingDb={42}
        />
      );

      const liveBadge = screen.getByTestId("live-sensor-badge");
      expect(liveBadge).toBeInTheDocument();
      expect(screen.getByText("42 dB")).toBeInTheDocument();
      expect(screen.getByText("Deep Work")).toBeInTheDocument();
    });

    it("accepts custom data points for weekday and weekend", async () => {
      const customWeekdayData = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        timeLabel: `${i.toString().padStart(2, "0")}:00`,
        avgDecibels: 40,
        band: "deep-work" as const,
      }));

      render(
        <HourlyNoiseHeatGraph
          venueId="venue-custom"
          weekdayData={customWeekdayData}
        />
      );

      const chart = screen.getByTestId("mock-composed-chart");
      expect(chart).toHaveAttribute("data-points-count", "24");
    });
  });
});
