import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ForecastLegend } from "@/components/noise/ForecastLegend";

describe("ForecastLegend", () => {
  it("renders with default labels and accessible attributes", () => {
    render(<ForecastLegend />);

    const legend = screen.getByTestId("forecast-legend");
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveAttribute("role", "group");
    expect(legend).toHaveAttribute("aria-label", "Noise forecast legend");

    expect(screen.getByText("Predicted Noise (dB)")).toBeInTheDocument();
    expect(screen.getByText("Quietest Hours")).toBeInTheDocument();

    expect(screen.getByTestId("forecast-legend-predicted-dot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("forecast-legend-quietest-dot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("renders with custom labels when provided", () => {
    render(
      <ForecastLegend
        predictedLabel="Forecasted Decibels"
        quietestLabel="Low Noise Window"
      />,
    );

    expect(screen.getByText("Forecasted Decibels")).toBeInTheDocument();
    expect(screen.getByText("Low Noise Window")).toBeInTheDocument();
    expect(screen.queryByText("Predicted Noise (dB)")).not.toBeInTheDocument();
  });

  it("conditionally hides items when toggle props are false", () => {
    const { rerender } = render(<ForecastLegend showPredicted={false} />);
    expect(screen.queryByTestId("forecast-legend-predicted")).not.toBeInTheDocument();
    expect(screen.getByTestId("forecast-legend-quietest")).toBeInTheDocument();

    rerender(<ForecastLegend showQuietest={false} />);
    expect(screen.getByTestId("forecast-legend-predicted")).toBeInTheDocument();
    expect(screen.queryByTestId("forecast-legend-quietest")).not.toBeInTheDocument();
  });

  it("renders extra legend items with custom styling", () => {
    render(
      <ForecastLegend
        extraItems={[
          {
            id: "peak",
            label: "Peak Work Hours",
            dotClassName: "bg-red-500/20 border-red-500",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("forecast-legend-extra-peak")).toBeInTheDocument();
    expect(screen.getByText("Peak Work Hours")).toBeInTheDocument();
  });

  it("handles non-array or malformed extraItems gracefully", () => {
    render(
      <ForecastLegend
        extraItems={undefined as unknown as []}
      />,
    );

    expect(screen.getByTestId("forecast-legend")).toBeInTheDocument();
  });

  it("applies custom className using cn utility", () => {
    render(<ForecastLegend className="custom-legend-class" />);

    expect(screen.getByTestId("forecast-legend")).toHaveClass("custom-legend-class");
  });
});
