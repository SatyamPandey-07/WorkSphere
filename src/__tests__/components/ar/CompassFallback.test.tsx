import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import CompassFallback from "@/components/ar/CompassFallback";
import * as useDeviceOrientationModule from "@/hooks/useDeviceOrientation";

jest.mock("@/hooks/useDeviceOrientation");

describe("CompassFallback Component", () => {
  let mockRequestPermission: jest.Mock;
  let originalGeolocation: any;

  beforeEach(() => {
    mockRequestPermission = jest.fn().mockResolvedValue(true);
    (
      useDeviceOrientationModule.useDeviceOrientation as jest.Mock
    ).mockReturnValue({
      heading: 45,
      error: null,
      isSupported: true,
      permissionState: "granted",
      requestPermission: mockRequestPermission,
    });

    originalGeolocation = navigator.geolocation;
    (navigator as any).geolocation = {
      watchPosition: jest.fn().mockImplementation((success) => {
        success({
          coords: {
            latitude: 40.7128,
            longitude: -74.006,
            accuracy: 10,
          },
        });
        return 123;
      }),
      clearWatch: jest.fn(),
    };
  });

  afterEach(() => {
    (navigator as any).geolocation = originalGeolocation;
    jest.clearAllMocks();
  });

  it("renders WebXR Unavailable badge and compass heading readout", () => {
    render(<CompassFallback />);

    expect(screen.getByText("WebXR Unavailable")).toBeInTheDocument();
    expect(screen.getByText("2D Compass Fallback")).toBeInTheDocument();
    expect(screen.getByText("Compass Heading")).toBeInTheDocument();
    expect(screen.getByText("45°")).toBeInTheDocument();
  });

  it("renders iOS Safari sensor permission prompt and handles button click", async () => {
    (
      useDeviceOrientationModule.useDeviceOrientation as jest.Mock
    ).mockReturnValue({
      heading: null,
      error: null,
      isSupported: true,
      permissionState: "prompt",
      requestPermission: mockRequestPermission,
    });

    render(<CompassFallback />);

    expect(screen.getByText("Enable Compass Orientation")).toBeInTheDocument();
    expect(
      screen.getByText(/iOS Safari requires permission/),
    ).toBeInTheDocument();

    const allowBtn = screen.getByRole("button", {
      name: /Allow Sensor Access/i,
    });
    await act(async () => {
      fireEvent.click(allowBtn);
    });

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it("displays directional guidance and distance when destination is provided", () => {
    // Destination near NYC: user at (40.7128, -74.0060), destination at (40.7228, -74.0060) (North, ~1.1 km)
    render(
      <CompassFallback
        destinationLat={40.7228}
        destinationLng={-74.006}
        destinationName="Empire Hub"
      />,
    );

    expect(screen.getByText("Empire Hub")).toBeInTheDocument();
    // Distance ~1.1 km or ~0.7 mi depending on locale distance unit
    expect(screen.getByText(/(1\.1 km|0\.7 mi)/)).toBeInTheDocument();
    expect(screen.getByText(/Bearing:/)).toBeInTheDocument();
    expect(screen.getByText("Destination Arrow")).toBeInTheDocument();
    expect(screen.getByText("Compass North")).toBeInTheDocument();
  });

  it("toggles between Destination Arrow and Compass North modes", () => {
    render(
      <CompassFallback
        destinationLat={40.7228}
        destinationLng={-74.006}
        destinationName="Empire Hub"
      />,
    );

    const northBtn = screen.getByRole("button", { name: "Compass North" });
    fireEvent.click(northBtn);

    const venueBtn = screen.getByRole("button", { name: "Destination Arrow" });
    fireEvent.click(venueBtn);
  });

  it("triggers onRetryAR callback when Retry AR button is clicked", () => {
    const handleRetry = jest.fn();
    render(<CompassFallback onRetryAR={handleRetry} />);

    const retryBtn = screen.getByRole("button", { name: /Retry AR/i });
    fireEvent.click(retryBtn);

    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it("renders unsupported message when device orientation is unavailable", () => {
    (
      useDeviceOrientationModule.useDeviceOrientation as jest.Mock
    ).mockReturnValue({
      heading: null,
      error: null,
      isSupported: false,
      permissionState: "unsupported",
      requestPermission: mockRequestPermission,
    });

    render(<CompassFallback />);

    expect(
      screen.getByText(/Device orientation sensors are not supported/),
    ).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const handleClose = jest.fn();
    render(<CompassFallback onClose={handleClose} />);

    const closeBtn = screen.getByRole("button", {
      name: /Close compass navigation/i,
    });
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key is pressed", () => {
    const handleClose = jest.fn();
    render(<CompassFallback onClose={handleClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("renders quaternion stabilization badge and pitch readout when alpha, beta, and gamma angles are provided", () => {
    render(<CompassFallback alpha={0} beta={45} gamma={0} />);

    expect(
      screen.getByTestId("quaternion-stabilization-badge"),
    ).toBeInTheDocument();
    expect(screen.getByText("Quaternion SLERP")).toBeInTheDocument();
    expect(screen.getByTestId("pitch-readout")).toHaveTextContent("Pitch: 45°");
  });

  it("activates Gimbal Lock Protected badge when device is tilted near vertical (beta = 90°)", () => {
    render(<CompassFallback alpha={0} beta={90} gamma={0} />);

    const badge = screen.getByTestId("quaternion-stabilization-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Gimbal Lock Protected");
    expect(screen.getByTestId("pitch-readout")).toHaveTextContent("Pitch: 90°");
  });

  it("maintains stable needle rotation without 180° flips when device pitch transitions across vertical", () => {
    const { rerender } = render(
      <CompassFallback alpha={0} beta={0} gamma={0} slerpFactor={1} />,
    );

    // Flat orientation pointing North: heading is 0°
    expect(screen.getByTestId("heading-readout")).toHaveTextContent("0°");

    // Tilt upright (beta = 89° -> 90° -> 91°): heading remains steady near 0° instead of flipping 180°
    rerender(<CompassFallback alpha={0} beta={89} gamma={0} slerpFactor={1} />);
    expect(screen.getByTestId("heading-readout")).toHaveTextContent("0°");

    rerender(<CompassFallback alpha={0} beta={90} gamma={0} slerpFactor={1} />);
    expect(screen.getByTestId("heading-readout")).toHaveTextContent("0°");

    rerender(<CompassFallback alpha={0} beta={91} gamma={0} slerpFactor={1} />);
    expect(screen.getByTestId("heading-readout")).toHaveTextContent("0°");
  });
});
