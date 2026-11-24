import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { BatterySaverIndicator } from "@/components/navigation/BatterySaverIndicator";

describe("BatterySaverIndicator (#10003)", () => {
  it("renders indicator when device is on battery power", () => {
    render(
      <BatterySaverIndicator mockBattery={{ level: 0.85, charging: false }} />,
    );

    const btn = screen.getByTestId("battery-saver-indicator-btn");
    expect(btn).toBeInTheDocument();
    expect(screen.getByTestId("battery-saver-percentage").textContent).toBe(
      "85%",
    );
    expect(btn).toHaveAttribute(
      "aria-label",
      "Battery saver active, 85% On Battery",
    );
  });

  it("renders indicator with pulse when battery is below threshold", () => {
    render(
      <BatterySaverIndicator mockBattery={{ level: 0.15, charging: false }} />,
    );

    expect(
      screen.getByTestId("battery-saver-indicator-btn"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("battery-saver-percentage").textContent).toBe(
      "15%",
    );
    expect(screen.getByTestId("battery-saver-leaf-icon")).toBeInTheDocument();
  });

  it("does not render when on AC power with ample battery", () => {
    const { container } = render(
      <BatterySaverIndicator mockBattery={{ level: 0.95, charging: true }} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("opens popover showing battery status and power source on click", () => {
    render(
      <BatterySaverIndicator mockBattery={{ level: 0.45, charging: false }} />,
    );

    const btn = screen.getByTestId("battery-saver-indicator-btn");
    expect(
      screen.queryByTestId("battery-saver-popover"),
    ).not.toBeInTheDocument();

    fireEvent.click(btn);

    const popover = screen.getByTestId("battery-saver-popover");
    expect(popover).toBeInTheDocument();
    expect(screen.getByTestId("battery-level-display").textContent).toBe("45%");
    expect(screen.getByTestId("battery-power-source-display").textContent).toBe(
      "On Battery",
    );
    expect(screen.getByTestId("battery-saver-status-tag").textContent).toBe(
      "ACTIVE",
    );
  });

  it("allows user to manually toggle battery saver mode", () => {
    render(
      <BatterySaverIndicator mockBattery={{ level: 0.3, charging: false }} />,
    );

    fireEvent.click(screen.getByTestId("battery-saver-indicator-btn"));

    const toggleBtn = screen.getByTestId("battery-saver-toggle-btn");
    expect(toggleBtn.textContent).toBe("Temporarily disable battery saving");
    expect(screen.getByTestId("battery-saver-status-tag").textContent).toBe(
      "ACTIVE",
    );

    // Toggle off
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("battery-saver-status-tag").textContent).toBe(
      "OFF",
    );
    expect(toggleBtn.textContent).toBe("Enable battery saving");

    // Toggle back on
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("battery-saver-status-tag").textContent).toBe(
      "ACTIVE",
    );
  });

  it("closes popover on Escape key press", () => {
    render(
      <BatterySaverIndicator mockBattery={{ level: 0.25, charging: false }} />,
    );

    fireEvent.click(screen.getByTestId("battery-saver-indicator-btn"));
    expect(screen.getByTestId("battery-saver-popover")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByTestId("battery-saver-popover"),
    ).not.toBeInTheDocument();
  });
});
