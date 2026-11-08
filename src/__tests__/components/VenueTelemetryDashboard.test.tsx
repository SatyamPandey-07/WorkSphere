import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueTelemetryDashboard } from "@/components/telemetry/VenueTelemetryDashboard";

describe("VenueTelemetryDashboard Component", () => {
  it("renders venue telemetry dashboard header and widgets", () => {
    render(<VenueTelemetryDashboard venueName="Central Cowork" />);

    expect(
      screen.getByTestId("venue-telemetry-dashboard"),
    ).toBeInTheDocument();
    expect(screen.getByText("Venue Telemetry Dashboard")).toBeInTheDocument();
    expect(screen.getByText(/Central Cowork/)).toBeInTheDocument();
    expect(screen.getByTestId("wifi-telemetry-widget")).toBeInTheDocument();
    expect(screen.getByTestId("noise-monitor")).toBeInTheDocument();
  });

  it("toggles ambient noise alerts via telemetry dashboard toggle button", () => {
    const onAlertsEnabledChange = jest.fn();
    render(
      <VenueTelemetryDashboard
        venueName="Central Cowork"
        onAlertsEnabledChange={onAlertsEnabledChange}
      />,
    );

    const toggleBtn = screen.getByTestId("telemetry-noise-alert-toggle");
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute("role", "switch");
    expect(toggleBtn).toHaveAttribute("aria-checked", "true");
    expect(toggleBtn).toHaveTextContent("Noise Alerts Active");

    // Toggle off
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-checked", "false");
    expect(toggleBtn).toHaveTextContent("Noise Alerts Muted");
    expect(onAlertsEnabledChange).toHaveBeenCalledWith(false);

    // Toggle on
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-checked", "true");
    expect(toggleBtn).toHaveTextContent("Noise Alerts Active");
    expect(onAlertsEnabledChange).toHaveBeenCalledWith(true);
  });
});
