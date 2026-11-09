import React from "react";
import { render, screen } from "@testing-library/react";
import {
  VenueNoiseChart,
  WifiPredictionPoint,
  OccupancyDataPoint,
} from "@/components/chat/VenueNoiseChart";
import type { HourlyForecast } from "@/components/noise/NoiseTimelineChart";

// Lightweight recharts mock avoiding heavy d3/recharts import overhead
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-barchart">{children}</div>
  ),
  Bar: () => <div data-testid="mock-bar" />,
  XAxis: () => <div data-testid="mock-xaxis" />,
  YAxis: () => <div data-testid="mock-yaxis" />,
  Tooltip: ({ content }: { content?: React.ComponentType<any> | React.ReactElement | ((props: any) => React.ReactNode) }) => {
    if (typeof content === "function") {
      const SampleContent = content as (props: any) => React.ReactNode;
      return (
        <div data-testid="mock-tooltip">
          {SampleContent({
            active: true,
            payload: [
              {
                payload: {
                  time: "12:00",
                  download: 150,
                  upload: 75,
                  latency: 20,
                  crowd: "Normal",
                  occupancy: 65,
                  hour: "12:00",
                  predictedDb: 55,
                  confidence: 0.88,
                },
              },
            ],
          })}
        </div>
      );
    }
    return <div data-testid="mock-tooltip" />;
  },
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-linechart">{children}</div>
  ),
  Line: () => <div data-testid="mock-line" />,
  CartesianGrid: () => <div data-testid="mock-grid" />,
}));

describe("VenueNoiseChart Component", () => {
  const mockWifi: WifiPredictionPoint[] = [
    {
      time: "10:00",
      download: 180,
      upload: 95,
      latency: 18,
      crowd: "Low",
    },
    {
      time: "14:00",
      download: 120,
      upload: 60,
      latency: 32,
      crowd: "Moderate",
    },
  ];

  const mockOccupancy: OccupancyDataPoint[] = [
    { time: "09:00", occupancy: 20 },
    { time: "13:00", occupancy: 85 },
  ];

  const mockForecast: HourlyForecast[] = [
    { hour: 9, predictedDb: 52, confidence: 0.9 },
    { hour: 14, predictedDb: 68, confidence: 0.85 },
  ];

  it("renders null when all datasets are empty", () => {
    const { container } = render(
      <VenueNoiseChart wifiPredictions={[]} occupancyData={[]} forecast={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders null when all datasets are null or undefined", () => {
    const { container } = render(
      <VenueNoiseChart
        wifiPredictions={null}
        occupancyData={null}
        forecast={null}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders only AI WiFi prediction when only wifiPredictions are provided", () => {
    render(<VenueNoiseChart wifiPredictions={mockWifi} />);

    expect(screen.getByTestId("wifi-prediction-section")).toBeInTheDocument();
    expect(screen.getByText("AI Wifi Prediction")).toBeInTheDocument();
    expect(
      screen.getByText("Expected speeds based on crowd telemetry")
    ).toBeInTheDocument();
    expect(screen.getByTestId("wifi-tooltip")).toBeInTheDocument();

    expect(screen.queryByTestId("occupancy-section")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("noise-timeline-section")
    ).not.toBeInTheDocument();
  });

  it("renders only live crowd occupancy when only occupancyData is provided", () => {
    render(<VenueNoiseChart occupancyData={mockOccupancy} />);

    expect(screen.getByTestId("occupancy-section")).toBeInTheDocument();
    expect(screen.getByText("Live Crowd Occupancy")).toBeInTheDocument();
    expect(
      screen.getByText("Historical crowd levels by hour")
    ).toBeInTheDocument();
    expect(screen.getByTestId("occupancy-tooltip")).toBeInTheDocument();

    expect(
      screen.queryByTestId("wifi-prediction-section")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("noise-timeline-section")
    ).not.toBeInTheDocument();
  });

  it("renders only noise level timeline when only forecast is provided", () => {
    render(<VenueNoiseChart forecast={mockForecast} />);

    expect(screen.getByTestId("noise-timeline-section")).toBeInTheDocument();
    expect(screen.getByText("Noise Level Timeline")).toBeInTheDocument();
    expect(
      screen.getByText("Predicted ambient noise (dB) throughout the day")
    ).toBeInTheDocument();
    expect(screen.getByTestId("noise-tooltip")).toBeInTheDocument();

    expect(
      screen.queryByTestId("wifi-prediction-section")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("occupancy-section")).not.toBeInTheDocument();
  });

  it("renders all three sections when all datasets are supplied", () => {
    render(
      <VenueNoiseChart
        wifiPredictions={mockWifi}
        occupancyData={mockOccupancy}
        forecast={mockForecast}
        className="custom-chart-container"
        testId="custom-venue-noise-chart"
      />
    );

    const root = screen.getByTestId("custom-venue-noise-chart");
    expect(root).toBeInTheDocument();
    expect(root.className).toContain("custom-chart-container");

    expect(screen.getByTestId("wifi-prediction-section")).toBeInTheDocument();
    expect(screen.getByTestId("occupancy-section")).toBeInTheDocument();
    expect(screen.getByTestId("noise-timeline-section")).toBeInTheDocument();
  });

  it("safely handles malformed forecast items with non-numeric hours and missing confidence", () => {
    const malformedForecast = [
      { hour: "8" as unknown as number, predictedDb: 48, confidence: undefined as unknown as number },
      { hour: 25, predictedDb: 75, confidence: 0.95 },
      null as unknown as HourlyForecast,
    ];

    render(<VenueNoiseChart forecast={malformedForecast} />);

    expect(screen.getByTestId("noise-timeline-section")).toBeInTheDocument();
    expect(screen.getByText("Noise Level Timeline")).toBeInTheDocument();
  });
});
