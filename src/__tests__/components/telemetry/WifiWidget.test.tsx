import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WifiWidget, getSpeedTier } from "@/components/telemetry/WifiWidget";

jest.mock("@/lib/telemetry", () => ({
  useSmoothTelemetry: jest.fn((speed: number) => ({
    smoothedSpeed: speed,
    isOutlier: false,
    history: [speed],
  })),
}));

import { useSmoothTelemetry } from "@/lib/telemetry";

const mockedUseSmoothTelemetry = useSmoothTelemetry as unknown as jest.Mock;

describe("WifiWidget", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with default props and values", () => {
    render(<WifiWidget rawSpeedMbps={55} />);

    expect(screen.getByTestId("wifi-telemetry-widget")).toBeInTheDocument();
    expect(screen.getByText("Live WiFi Telemetry")).toBeInTheDocument();
    expect(screen.getByTestId("smoothed-speed-value")).toHaveTextContent("55.0");
    expect(screen.getByTestId("wifi-speed-tier")).toHaveTextContent("High Speed");
    expect(screen.getByTestId("raw-speed-metric")).toHaveTextContent("55 Mbps");
    expect(screen.getByTestId("latency-metric")).toHaveTextContent("18 ms");
    expect(screen.getByTestId("jitter-metric")).toHaveTextContent("±2 ms");
  });

  it("renders correct speed tiers via getSpeedTier helper", () => {
    expect(getSpeedTier(150).tier).toBe("Ultra Fast");
    expect(getSpeedTier(50).tier).toBe("High Speed");
    expect(getSpeedTier(25).tier).toBe("Moderate");
    expect(getSpeedTier(5).tier).toBe("Basic");
  });

  it("displays Ultra Fast tier for speeds >= 100 Mbps", () => {
    mockedUseSmoothTelemetry.mockReturnValue({
      smoothedSpeed: 120.5,
      isOutlier: false,
      history: [120.5],
    });

    render(<WifiWidget rawSpeedMbps={120.5} />);
    expect(screen.getByTestId("wifi-speed-tier")).toHaveTextContent("Ultra Fast");
  });

  it("displays Basic tier for speeds < 15 Mbps", () => {
    mockedUseSmoothTelemetry.mockReturnValue({
      smoothedSpeed: 8.2,
      isOutlier: false,
      history: [8.2],
    });

    render(<WifiWidget rawSpeedMbps={8.2} />);
    expect(screen.getByTestId("wifi-speed-tier")).toHaveTextContent("Basic");
  });

  it("renders venue name when provided and omits it when absent", () => {
    const { rerender } = render(
      <WifiWidget rawSpeedMbps={50} venueName="Tokyo Nomad Cowork" />
    );
    expect(screen.getByTestId("wifi-venue-name")).toHaveTextContent("Tokyo Nomad Cowork");

    rerender(<WifiWidget rawSpeedMbps={50} />);
    expect(screen.queryByTestId("wifi-venue-name")).not.toBeInTheDocument();
  });

  it("renders outlier badge when telemetry reports 3-sigma spike", () => {
    mockedUseSmoothTelemetry.mockReturnValue({
      smoothedSpeed: 45.0,
      isOutlier: true,
      history: [45.0],
    });

    render(<WifiWidget rawSpeedMbps={45.0} />);
    expect(screen.getByTestId("outlier-badge")).toBeInTheDocument();
    expect(screen.getByText("Filtered 3σ Spike")).toBeInTheDocument();
  });

  it("renders sparkline history bars when history has multiple entries", () => {
    mockedUseSmoothTelemetry.mockReturnValue({
      smoothedSpeed: 60.0,
      isOutlier: false,
      history: [40, 50, 60, 55],
    });

    render(<WifiWidget rawSpeedMbps={60.0} />);
    expect(screen.getByTestId("telemetry-sparkline")).toBeInTheDocument();
    expect(screen.getByTestId("telemetry-sparkline-bar-0")).toBeInTheDocument();
    expect(screen.getByTestId("telemetry-sparkline-bar-3")).toBeInTheDocument();
  });

  it("defensively clamps negative values and handles NaN safely", () => {
    mockedUseSmoothTelemetry.mockImplementation((speed: number) => ({
      smoothedSpeed: speed,
      isOutlier: false,
      history: [speed],
    }));

    render(
      <WifiWidget
        rawSpeedMbps={NaN as unknown as number}
        pingMs={-5}
        jitterMs={NaN as unknown as number}
      />
    );

    expect(screen.getByTestId("raw-speed-metric")).toHaveTextContent("0 Mbps");
    expect(screen.getByTestId("latency-metric")).toHaveTextContent("0 ms");
    expect(screen.getByTestId("jitter-metric")).toHaveTextContent("±0 ms");
  });

  it("applies custom className", () => {
    render(<WifiWidget rawSpeedMbps={50} className="custom-wifi-widget-class" />);
    expect(screen.getByTestId("wifi-telemetry-widget")).toHaveClass("custom-wifi-widget-class");
  });
});
