import "@testing-library/jest-dom";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import {
  SeatingForecastChart,
  SeatingForecastResult,
  applyHoltWintersToTelemetry,
} from "@/components/venue/SeatingForecastChart";

// Rich mock for recharts that preserves and renders Tooltip and Area props for assertion
jest.mock("recharts", () => {
  const React = require("react");
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-responsive-container">{children}</div>
    ),
    AreaChart: ({
      children,
      data,
    }: {
      children: React.ReactNode;
      data: any[];
    }) => (
      <div data-testid="mock-area-chart" data-chart-data={JSON.stringify(data)}>
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child, { chartData: data } as any);
          }
          return child;
        })}
      </div>
    ),
    Area: (props: any) => (
      <div
        data-testid={props["data-testid"] || `mock-area-${props.dataKey}`}
        data-datakey={props.dataKey}
        data-stroke={props.stroke}
        data-fill={props.fill}
        data-fill-opacity={props.fillOpacity}
        data-name={props.name}
      />
    ),
    BarChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-bar-chart">{children}</div>
    ),
    Bar: () => <div data-testid="mock-bar" />,
    Cell: () => <div data-testid="mock-cell" />,
    XAxis: () => <div data-testid="mock-xaxis" />,
    YAxis: () => <div data-testid="mock-yaxis" />,
    CartesianGrid: () => <div data-testid="mock-cartesian-grid" />,
    ReferenceArea: () => <div data-testid="mock-reference-area" />,
    ReferenceLine: (props: any) => (
      <div data-testid="mock-reference-line" data-x={props.x} />
    ),
    Tooltip: ({ content, chartData }: any) => {
      if (!content || !chartData || chartData.length === 0) {
        return <div data-testid="mock-tooltip-empty" />;
      }
      // Render active tooltip for the first forecast point
      const activePoint = chartData[0];
      const payload = [{ payload: activePoint }];
      const renderedContent = content({
        active: true,
        payload,
        label: activePoint.hour,
      });
      return <div data-testid="mock-tooltip-container">{renderedContent}</div>;
    },
  };
});

describe("SeatingForecastChart 95% Confidence Interval & Shading", () => {
  const mock7DayForecastData: SeatingForecastResult = {
    capacity: 60,
    recommendedHours: [9, 10, 14],
    forecast: [
      {
        hour: 9,
        date: "2026-11-09",
        predictedOccupancy: 30,
        lowerBound: 22,
        upperBound: 38,
        confidence: 0.9,
        capacity: 60,
        isForecast: true,
        intervalLevel: 0.95,
      },
      {
        hour: 10,
        date: "2026-11-09",
        predictedOccupancy: 40,
        lowerBound: 31,
        upperBound: 49,
        confidence: 0.88,
        capacity: 60,
        isForecast: true,
        intervalLevel: 0.95,
      },
      {
        hour: 11,
        date: "2026-11-09",
        predictedOccupancy: 48,
        lowerBound: 37,
        upperBound: 58,
        confidence: 0.85,
        capacity: 60,
        isForecast: true,
        intervalLevel: 0.95,
      },
    ],
  };

  it("renders both the semi-transparent confidence interval band and point forecast curve", () => {
    render(
      <SeatingForecastChart
        venueId="venue-ci-test"
        initialData={mock7DayForecastData}
      />
    );

    // Verify 95% Confidence Band Area element exists with correct props
    const confidenceBand = screen.getByTestId("forecast-confidence-band");
    expect(confidenceBand).toBeInTheDocument();
    expect(confidenceBand).toHaveAttribute("data-datakey", "confidenceBand");
    expect(confidenceBand).toHaveAttribute("data-name", "95% Confidence Interval");
    expect(confidenceBand).toHaveAttribute("data-fill", "url(#colorConfidenceBand)");

    // Verify Point Forecast curve Area exists and is visible above the band
    const forecastCurve = screen.getByTestId("forecast-curve");
    expect(forecastCurve).toBeInTheDocument();
    expect(forecastCurve).toHaveAttribute("data-datakey", "predictedOccupancy");
    expect(forecastCurve).toHaveAttribute("data-name", "Predicted Occupancy");
  });

  it("renders 95% Confidence Interval badge in chart legend", () => {
    render(
      <SeatingForecastChart
        venueId="venue-ci-test"
        initialData={mock7DayForecastData}
      />
    );

    expect(screen.getByTestId("legend-confidence-band")).toBeInTheDocument();
    expect(screen.getByText("95% Confidence Interval")).toBeInTheDocument();
    expect(screen.getByText("Predicted Occupancy")).toBeInTheDocument();
  });

  it("renders tooltip with date, predicted occupancy, lower bound, upper bound, and 95% interval level", () => {
    render(
      <SeatingForecastChart
        venueId="venue-ci-test"
        initialData={mock7DayForecastData}
      />
    );

    expect(screen.getByTestId("seating-forecast-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("tooltip-date")).toHaveTextContent("2026-11-09");
    expect(screen.getByTestId("tooltip-predicted")).toHaveTextContent("30 seats");
    expect(screen.getByTestId("tooltip-lower-bound")).toHaveTextContent("22 seats");
    expect(screen.getByTestId("tooltip-upper-bound")).toHaveTextContent("38 seats");
    expect(screen.getByTestId("tooltip-interval-level")).toHaveTextContent("95%");
  });

  it("updates confidence band and forecast curve when initialData changes", () => {
    const { rerender } = render(
      <SeatingForecastChart
        venueId="venue-ci-test"
        initialData={mock7DayForecastData}
      />
    );

    const initialBand = screen.getByTestId("forecast-confidence-band");
    expect(initialBand).toBeInTheDocument();

    const updatedData: SeatingForecastResult = {
      ...mock7DayForecastData,
      forecast: [
        {
          hour: 12,
          date: "2026-11-10",
          predictedOccupancy: 52,
          lowerBound: 44,
          upperBound: 60,
          confidence: 0.92,
          capacity: 60,
          isForecast: true,
          intervalLevel: 0.95,
        },
      ],
    };

    rerender(
      <SeatingForecastChart
        venueId="venue-ci-test"
        initialData={updatedData}
      />
    );

    expect(screen.getByTestId("tooltip-date")).toHaveTextContent("2026-11-10");
    expect(screen.getByTestId("tooltip-predicted")).toHaveTextContent("52 seats");
    expect(screen.getByTestId("tooltip-lower-bound")).toHaveTextContent("44 seats");
    expect(screen.getByTestId("tooltip-upper-bound")).toHaveTextContent("60 seats");
  });

  it("renders transition reference marker when both historical and forecast telemetry are provided", () => {
    const mixedTelemetryData: SeatingForecastResult = {
      capacity: 50,
      recommendedHours: [10],
      forecast: [
        {
          hour: 8,
          predictedOccupancy: 15,
          confidence: 1.0,
          capacity: 50,
          isForecast: false,
        },
        {
          hour: 9,
          predictedOccupancy: 25,
          lowerBound: 20,
          upperBound: 30,
          confidence: 0.85,
          capacity: 50,
          isForecast: true,
          intervalLevel: 0.95,
        },
      ],
    };

    render(
      <SeatingForecastChart
        venueId="venue-transition-test"
        initialData={mixedTelemetryData}
      />
    );

    const refLine = screen.getByTestId("mock-reference-line");
    expect(refLine).toBeInTheDocument();
    expect(refLine).toHaveAttribute("data-x", "09:00");
  });

  it("calculates 7-day Holt-Winters forecast with prediction intervals via applyHoltWintersToTelemetry", () => {
    // Generate 72 hours (3 days) of historical hourly occupancy data
    const history: number[] = [];
    for (let t = 0; t < 72; t++) {
      const dailySin = Math.sin((2 * Math.PI * (t % 24)) / 24) * 20;
      history.push(Math.max(5, Math.min(95, 50 + dailySin)));
    }

    // Forecast for 7 days ahead (168 hours)
    const result = applyHoltWintersToTelemetry(history, 168, 24);

    expect(result.predictions.length).toBe(168);
    expect(result.lowerBounds.length).toBe(168);
    expect(result.upperBounds.length).toBe(168);
    expect(result.intervalLevel).toBe(0.95);

    // Verify lowerBound <= prediction <= upperBound invariant holds for all 168 forecast hours
    for (let i = 0; i < 168; i++) {
      expect(result.lowerBounds[i]).toBeGreaterThanOrEqual(0);
      expect(result.upperBounds[i]).toBeLessThanOrEqual(100);
      expect(result.lowerBounds[i]).toBeLessThanOrEqual(result.predictions[i]);
      expect(result.predictions[i]).toBeLessThanOrEqual(result.upperBounds[i]);
    }
  });
});

