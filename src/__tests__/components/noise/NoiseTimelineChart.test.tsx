import React from "react";
import { render, screen } from "@testing-library/react";
import NoiseTimelineChart, {
  NoiseTimelineChart as NamedNoiseTimelineChart,
  HourlyForecast,
} from "@/components/noise/NoiseTimelineChart";

jest.mock("recharts", () => {
  const Original = jest.requireActual("recharts");
  return {
    ...Original,
    ResponsiveContainer: ({ children }: any) => (
      <div style={{ width: 400, height: 160 }} data-testid="recharts-responsive-container">
        {children}
      </div>
    ),
  };
});

describe("NoiseTimelineChart Component", () => {
  const sampleForecast: HourlyForecast[] = [
    { hour: 8, predictedDb: 48, confidence: 0.85, samples: 14 },
    { hour: 9, predictedDb: 56, confidence: 0.9, samples: 22 },
    { hour: 12, predictedDb: 68, confidence: 0.95, samples: 35 },
    { hour: 15, predictedDb: 62, confidence: 0.8, samples: 18 },
    { hour: 18, predictedDb: 54, confidence: 0.75, samples: 11 },
    { hour: 21, predictedDb: null, confidence: 0.5, samples: 1 },
  ];

  it("exports named NoiseTimelineChart and default NoiseTimelineChart", () => {
    expect(NoiseTimelineChart).toBeDefined();
    expect(NamedNoiseTimelineChart).toBe(NoiseTimelineChart);
  });

  it("renders empty state fallback banner when forecast is empty array, undefined, or null", () => {
    const { rerender } = render(<NoiseTimelineChart forecast={[]} />);
    expect(screen.getByTestId("noise-timeline-empty")).toBeInTheDocument();
    expect(screen.getByText(/No noise level forecast data available/i)).toBeInTheDocument();

    rerender(<NoiseTimelineChart forecast={undefined} />);
    expect(screen.getByTestId("noise-timeline-empty")).toBeInTheDocument();

    rerender(<NoiseTimelineChart forecast={null as any} />);
    expect(screen.getByTestId("noise-timeline-empty")).toBeInTheDocument();
  });

  it("renders timeline header, subtitle, and chart container when forecast data is provided", () => {
    render(<NoiseTimelineChart forecast={sampleForecast} />);

    expect(screen.getByTestId("noise-timeline-chart")).toBeInTheDocument();
    expect(screen.getByText("Noise Level Timeline")).toBeInTheDocument();
    expect(
      screen.getByText(/24-hour historical and forecasted ambient decibels/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("noise-timeline-container")).toBeInTheDocument();
    expect(screen.getByTestId("recharts-responsive-container")).toBeInTheDocument();
  });

  it("merges custom className and supports data-testid override", () => {
    render(
      <NoiseTimelineChart
        forecast={sampleForecast}
        className="custom-noise-chart"
        data-testid="custom-noise-timeline"
      />
    );

    const container = screen.getByTestId("custom-noise-timeline");
    expect(container).toHaveClass("custom-noise-chart", "mb-6", "rounded-2xl");
  });

  it("applies custom className on empty state fallback", () => {
    render(
      <NoiseTimelineChart
        forecast={[]}
        className="empty-custom-chart"
        data-testid="empty-noise-timeline"
      />
    );

    const container = screen.getByTestId("empty-noise-timeline");
    expect(container).toHaveClass("empty-custom-chart", "text-center");
    expect(screen.getByTestId("noise-timeline-empty")).toBeInTheDocument();
  });
});
