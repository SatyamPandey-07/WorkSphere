import React from "react";
import { render, screen } from "@testing-library/react";
import { BeaconSignalBars } from "@/components/spatial/BeaconSignalBars";

describe("BeaconSignalBars Component (#5766)", () => {
  it("renders accessible 5-bar cellular meter with full strength for -50 dBm", () => {
    render(<BeaconSignalBars rssi={-50} />);

    const meter = screen.getByRole("meter");
    expect(meter).toBeInTheDocument();
    expect(meter).toHaveAttribute("aria-valuenow", "5");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
    expect(meter).toHaveAttribute(
      "aria-label",
      "Signal strength: 5 of 5 bars (-50 dBm, Excellent)"
    );

    // Verify all 5 bars are active
    const bar1 = screen.getByTestId("signal-bar-1");
    const bar2 = screen.getByTestId("signal-bar-2");
    const bar3 = screen.getByTestId("signal-bar-3");
    const bar4 = screen.getByTestId("signal-bar-4");
    const bar5 = screen.getByTestId("signal-bar-5");

    expect(bar1).toHaveAttribute("data-active", "true");
    expect(bar2).toHaveAttribute("data-active", "true");
    expect(bar3).toHaveAttribute("data-active", "true");
    expect(bar4).toHaveAttribute("data-active", "true");
    expect(bar5).toHaveAttribute("data-active", "true");
  });

  it("renders 1 active bar for -100 dBm minimum anchor", () => {
    render(<BeaconSignalBars rssi={-100} />);

    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "1");
    expect(meter).toHaveAttribute(
      "aria-label",
      "Signal strength: 1 of 5 bars (-100 dBm, Weak)"
    );

    expect(screen.getByTestId("signal-bar-1")).toHaveAttribute(
      "data-active",
      "true"
    );
    expect(screen.getByTestId("signal-bar-2")).toHaveAttribute(
      "data-active",
      "false"
    );
    expect(screen.getByTestId("signal-bar-3")).toHaveAttribute(
      "data-active",
      "false"
    );
    expect(screen.getByTestId("signal-bar-4")).toHaveAttribute(
      "data-active",
      "false"
    );
    expect(screen.getByTestId("signal-bar-5")).toHaveAttribute(
      "data-active",
      "false"
    );
  });

  it("renders 3 active bars for -75 dBm (Fair)", () => {
    render(<BeaconSignalBars rssi={-75} />);

    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "3");

    expect(screen.getByTestId("signal-bar-1")).toHaveAttribute(
      "data-active",
      "true"
    );
    expect(screen.getByTestId("signal-bar-2")).toHaveAttribute(
      "data-active",
      "true"
    );
    expect(screen.getByTestId("signal-bar-3")).toHaveAttribute(
      "data-active",
      "true"
    );
    expect(screen.getByTestId("signal-bar-4")).toHaveAttribute(
      "data-active",
      "false"
    );
    expect(screen.getByTestId("signal-bar-5")).toHaveAttribute(
      "data-active",
      "false"
    );
  });

  it("renders 0 active bars when rssi is null or invalid", () => {
    render(<BeaconSignalBars rssi={null} />);

    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("signal-bar-1")).toHaveAttribute(
      "data-active",
      "false"
    );
    expect(screen.getByTestId("signal-bar-5")).toHaveAttribute(
      "data-active",
      "false"
    );
  });

  it("renders visible text label when showLabel is true", () => {
    render(
      <BeaconSignalBars
        rssi={-68}
        showLabel={true}
        labelFormat="rssi"
      />
    );

    const label = screen.getByTestId("signal-bars-label");
    expect(label).toBeInTheDocument();
    expect(label).toHaveTextContent("-68 dBm");
  });

  it("supports explicit bar overrides and custom accessible labels", () => {
    render(
      <BeaconSignalBars
        rssi={-70}
        bars={4}
        accessibleLabel="Custom Bluetooth Proximity Meter"
      />
    );

    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-label", "Custom Bluetooth Proximity Meter");
    expect(meter).toHaveAttribute("aria-valuenow", "4");
  });
});
