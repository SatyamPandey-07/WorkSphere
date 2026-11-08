import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VenueBeaconDiagnosticDrawer } from "@/components/spatial/VenueBeaconDiagnosticDrawer";
import type { BeaconReading } from "@/lib/spatial/indoorPdrEngine";

const TEST_BEACONS: BeaconReading[] = [
  { id: "beacon-entrance", x: 2, y: 2, rssi: -50, txPower: -59, pathLossExponent: 2.5 },
  { id: "beacon-coffee-bar", x: 14, y: 3, rssi: -68, txPower: -59, pathLossExponent: 2.5 },
  { id: "beacon-quiet-zone", x: 4, y: 12, rssi: -100, txPower: -59, pathLossExponent: 2.5 },
];

describe("VenueBeaconDiagnosticDrawer Component (#5766)", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <VenueBeaconDiagnosticDrawer
        isOpen={false}
        onClose={jest.fn()}
        beacons={TEST_BEACONS}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders diagnostic drawer dialog with beacon list and cellular signal bars when isOpen is true", () => {
    render(
      <VenueBeaconDiagnosticDrawer
        isOpen={true}
        onClose={jest.fn()}
        venueName="Central Coworking Lounge"
        beacons={TEST_BEACONS}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("BLE Proximity Diagnostics")).toBeInTheDocument();
    expect(screen.getByText(/Central Coworking Lounge/)).toBeInTheDocument();

    // Verify all beacons are rendered
    expect(screen.getByText("beacon-entrance")).toBeInTheDocument();
    expect(screen.getByText("beacon-coffee-bar")).toBeInTheDocument();
    expect(screen.getByText("beacon-quiet-zone")).toBeInTheDocument();

    // Verify summary telemetry
    expect(screen.getByTestId("telemetry-beacon-count")).toHaveTextContent("3");
    expect(screen.getByTestId("telemetry-max-rssi")).toHaveTextContent("-50");
  });

  it("fires onClose when close button or backdrop is clicked", () => {
    const handleClose = jest.fn();
    render(
      <VenueBeaconDiagnosticDrawer
        isOpen={true}
        onClose={handleClose}
        beacons={TEST_BEACONS}
      />
    );

    const closeBtn = screen.getByTestId("close-beacon-diagnostic-drawer");
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    const backdrop = screen.getByTestId("beacon-drawer-backdrop");
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it("fires onClose when Escape key is pressed", () => {
    const handleClose = jest.fn();
    render(
      <VenueBeaconDiagnosticDrawer
        isOpen={true}
        onClose={handleClose}
        beacons={TEST_BEACONS}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("triggers onPingBeacons when Ping RSSI button is clicked", () => {
    const handlePing = jest.fn();
    render(
      <VenueBeaconDiagnosticDrawer
        isOpen={true}
        onClose={jest.fn()}
        beacons={TEST_BEACONS}
        onPingBeacons={handlePing}
      />
    );

    const pingBtn = screen.getByTestId("ping-beacons-btn");
    fireEvent.click(pingBtn);
    expect(handlePing).toHaveBeenCalledTimes(1);
  });

  it("filters beacons when typing in search input", () => {
    render(
      <VenueBeaconDiagnosticDrawer
        isOpen={true}
        onClose={jest.fn()}
        beacons={TEST_BEACONS}
      />
    );

    const searchInput = screen.getByTestId("beacon-search-input");
    fireEvent.change(searchInput, { target: { value: "entrance" } });

    expect(screen.getByText("beacon-entrance")).toBeInTheDocument();
    expect(screen.queryByText("beacon-coffee-bar")).not.toBeInTheDocument();
    expect(screen.queryByText("beacon-quiet-zone")).not.toBeInTheDocument();
  });
});
