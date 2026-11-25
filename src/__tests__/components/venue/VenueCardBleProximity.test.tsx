import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { VenueCard } from "@/components/venue/VenueCard";

describe("VenueCard BLE Proximity Integration (#9611)", () => {
  const originalNavigator = global.navigator;

  const mockVenue = {
    id: "v-beacon-test",
    name: "Hub 42 Bangalore",
    address: "42 Indiranagar 100ft Rd",
    lat: 12.9716,
    lng: 77.5946,
  };

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    jest.clearAllMocks();
  });

  it("does not render BLE proximity indicator when enableBleProximity is false/default", () => {
    render(<VenueCard venue={mockVenue} />);
    expect(screen.queryByTestId("venue-ble-proximity-indicator")).not.toBeInTheDocument();
  });

  it("renders BLE unavailable status when enableBleProximity is true on unsupported browser without crashing", () => {
    Object.defineProperty(global, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });

    render(<VenueCard venue={mockVenue} enableBleProximity={true} />);
    expect(screen.getByTestId("venue-ble-proximity-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("ble-proximity-unsupported-badge")).toHaveTextContent("BLE unavailable");
  });

  it("renders Detect Beacon action button when Web Bluetooth is supported and does not prompt automatically", () => {
    const mockRequestDevice = jest.fn();
    Object.defineProperty(global, "navigator", {
      value: {
        bluetooth: {
          requestDevice: mockRequestDevice,
        },
      },
      writable: true,
      configurable: true,
    });

    render(<VenueCard venue={mockVenue} enableBleProximity={true} />);

    expect(screen.getByTestId("ble-proximity-scan-btn")).toBeInTheDocument();
    expect(mockRequestDevice).not.toHaveBeenCalled();
  });

  it("invokes startScanning when user explicitly clicks Detect Beacon", async () => {
    const mockDevice = {
      id: "hub-beacon-1",
      name: "Hub 42 BLE Beacon",
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      watchAdvertisements: jest.fn().mockResolvedValue(undefined),
      gatt: { connected: false, connect: jest.fn(), disconnect: jest.fn() },
    };
    const mockRequestDevice = jest.fn().mockResolvedValue(mockDevice);

    Object.defineProperty(global, "navigator", {
      value: {
        bluetooth: {
          requestDevice: mockRequestDevice,
        },
      },
      writable: true,
      configurable: true,
    });

    render(<VenueCard venue={mockVenue} enableBleProximity={true} />);

    const scanBtn = screen.getByTestId("ble-proximity-scan-btn");
    await act(async () => {
      fireEvent.click(scanBtn);
    });

    expect(mockRequestDevice).toHaveBeenCalledTimes(1);
  });
});
