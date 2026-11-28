import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AmbientNoiseSparkline } from "@/components/analytics/AmbientNoiseSparkline";

describe("AmbientNoiseSparkline threshold alert badge and line", () => {
  it("renders dashed threshold line at default 65 dB and hides alert badge for normal readings", () => {
    render(
      <AmbientNoiseSparkline
        hourlyDecibels={[
          { hour: 9, dBA: 50 },
          { hour: 10, dBA: 58 },
        ]}
      />,
    );

    const thresholdLine = screen.getByTestId("noise-threshold-line");
    expect(thresholdLine).toBeInTheDocument();
    expect(thresholdLine).toHaveAttribute("stroke-dasharray", "4 3");
    expect(screen.getByTestId("noise-threshold-label")).toHaveTextContent(
      "65 dB",
    );

    // Alert badge must not render when reading is below threshold
    expect(
      screen.queryByTestId("noise-threshold-alert-badge"),
    ).not.toBeInTheDocument();
  });

  it("does not render alert badge when current reading is exactly at threshold (borderline)", () => {
    render(
      <AmbientNoiseSparkline
        thresholdDb={65}
        hourlyDecibels={[
          { hour: 10, dBA: 60 },
          { hour: 11, dBA: 65 },
        ]}
      />,
    );

    expect(
      screen.queryByTestId("noise-threshold-alert-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders alert badge and accessible tooltip when rolling 5-minute average exceeds thresholdDb", () => {
    const baseTime = Date.parse("2026-11-26T12:00:00Z");
    render(
      <AmbientNoiseSparkline
        thresholdDb={65}
        hourlyDecibels={[
          { hour: 11, dBA: 62, timestamp: baseTime - 10 * 60_000 },
          { hour: 12, dBA: 70, timestamp: baseTime - 3 * 60_000 },
          { hour: 12, dBA: 74, timestamp: baseTime },
        ]}
      />,
    );

    // Rolling 5-minute average of 70 and 74 is 72 dB (> 65 dB)
    const badge = screen.getByTestId("noise-threshold-alert-badge");
    const announcement = screen.getByRole("status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveTextContent("Ambient noise threshold exceeded");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("High Noise Level: 72 dB");
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("exceeding the 65 dB threshold"),
    );

    // Hovering badge displays peak decibel spike and duration tooltip
    fireEvent.mouseEnter(badge);
    const tooltip = screen.getByTestId("noise-threshold-alert-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Peak Spike:");
    expect(tooltip).toHaveTextContent("74 dB");
    expect(tooltip).toHaveTextContent("Exceeded For:");
  });

  it("defaults thresholdDb to 75 dB when venueType is lively", () => {
    render(
      <AmbientNoiseSparkline
        venueType="lively"
        hourlyDecibels={[
          { hour: 18, dBA: 72 },
          { hour: 19, dBA: 74 },
        ]}
      />,
    );

    expect(screen.getByTestId("noise-threshold-label")).toHaveTextContent(
      "75 dB",
    );
    expect(
      screen.queryByTestId("noise-threshold-alert-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders threshold line accurately across responsive container dimensions", () => {
    render(
      <AmbientNoiseSparkline
        width={600}
        height={200}
        thresholdDb={70}
        hourlyDecibels={[
          { hour: 10, dBA: 60 },
          { hour: 11, dBA: 76 },
        ]}
      />,
    );

    const thresholdLine = screen.getByTestId("noise-threshold-line");
    expect(thresholdLine).toHaveAttribute("x1", "16");
    expect(thresholdLine).toHaveAttribute("x2", "584");
    const y1 = Number(thresholdLine.getAttribute("y1"));
    const y2 = Number(thresholdLine.getAttribute("y2"));
    expect(y1).toBe(y2);
    expect(y1).toBeGreaterThanOrEqual(12);
    expect(y1).toBeLessThanOrEqual(180);
  });

  it("highlights individual peaks exceeding the configured thresholdDb", () => {
    render(
      <AmbientNoiseSparkline
        thresholdDb={60}
        hourlyDecibels={[
          { hour: 10, dBA: 55 },
          { hour: 11, dBA: 70 },
          { hour: 12, dBA: 58 },
        ]}
      />,
    );

    const points = screen.getAllByTestId("noise-data-point");

    expect(points[0]).toHaveAttribute("data-threshold-exceeded", "false");
    expect(points[1]).toHaveAttribute("data-threshold-exceeded", "true");
    expect(points[1]).toHaveAttribute("fill", "#fb7185");
    expect(points[1]).toHaveAttribute("stroke", "#f43f5e");
    expect(points[2]).toHaveAttribute("data-threshold-exceeded", "false");
  });
});
