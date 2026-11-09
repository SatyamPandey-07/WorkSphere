import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SeatARPointer } from "@/components/ar/SeatARPointer";
import { drawRadarOverlay } from "@/lib/ar/radarCanvas";
import * as useWebXRModule from "@/hooks/useWebXR";
import * as useDeviceOrientationModule from "@/hooks/useDeviceOrientation";

// Mock hooks
jest.mock("@/hooks/useWebXR");
jest.mock("@/hooks/useDeviceOrientation");

// Mock three.js
jest.mock("three", () => {
  const actual = jest.requireActual("three");
  return {
    ...actual,
    WebGLRenderer: jest.fn().mockImplementation(() => ({
      setSize: jest.fn(),
      setPixelRatio: jest.fn(),
      xr: { enabled: false },
      domElement: document.createElement("canvas"),
      render: jest.fn(),
      dispose: jest.fn(),
    })),
  };
});

describe("SeatARPointer 2D Radar Overlay (#4601)", () => {
  let mockRequestSession: jest.Mock;

  beforeEach(() => {
    mockRequestSession = jest.fn().mockResolvedValue({
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });

    (useWebXRModule.useWebXR as jest.Mock).mockReturnValue({
      isSupported: true,
      requestSession: mockRequestSession,
    });

    (useDeviceOrientationModule.useDeviceOrientation as jest.Mock).mockReturnValue({
      heading: 120,
      accuracy: 0.9,
      error: null,
      isSupported: true,
      permissionState: "granted",
      requestPermission: jest.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders 2D radar overlay by default and synchronizes compass azimuth", () => {
    render(
      <SeatARPointer
        seatNumber="3B"
        targetAnchor={{ x: 2, y: 0.8, z: -4 }}
      />,
    );

    // Radar toggle button should be present and pressed
    const toggleBtn = screen.getByTestId("toggle-radar-btn");
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute("aria-pressed", "true");

    // Radar canvas container and canvas should be present
    expect(screen.getByTestId("radar-overlay-container")).toBeInTheDocument();
    const canvas = screen.getByTestId("radar-canvas");
    expect(canvas).toBeInTheDocument();

    // Azimuth degree indicator should render 120°
    expect(screen.getByText("120°")).toBeInTheDocument();
  });

  it("toggles radar overlay visibility when clicking the radar button", () => {
    render(<SeatARPointer seatNumber="4C" />);

    const toggleBtn = screen.getByTestId("toggle-radar-btn");
    expect(screen.getByTestId("radar-overlay-container")).toBeInTheDocument();

    // Click to hide radar
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("radar-overlay-container")).not.toBeInTheDocument();

    // Click again to show radar
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("radar-overlay-container")).toBeInTheDocument();
  });

  it("drawRadarOverlay helper calculates beacon positions and draws on 2D canvas", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 130;
    canvas.height = 130;
    const ctx = canvas.getContext("2d")!;

    // Test drawing radar with target straight ahead (relative 0 deg)
    const result1 = drawRadarOverlay(ctx, {
      size: 130,
      maxRangeMeters: 10,
      heading: 0,
      bearingAngle: 0,
      distance: 5,
      pulseTime: 1.0,
      seatLabel: "1A",
    });

    expect(result1.inRange).toBe(true);
    // Beacon should be centered horizontally at cx (65) and above cy (top)
    expect(result1.beaconX).toBeCloseTo(65, 0);
    expect(result1.beaconY).toBeLessThan(65);

    // Test drawing radar when out of range
    const result2 = drawRadarOverlay(ctx, {
      size: 130,
      maxRangeMeters: 10,
      heading: 90,
      bearingAngle: 90,
      distance: 15,
      pulseTime: 2.0,
      seatLabel: "1A",
    });

    expect(result2.inRange).toBe(false);
  });
});
