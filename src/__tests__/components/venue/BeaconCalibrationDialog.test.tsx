import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BeaconCalibrationDialog } from "@/components/venue/BeaconCalibrationDialog";
import * as BeaconHook from "@/hooks/useBeaconCalibration";

jest.mock("@/hooks/useBeaconCalibration");

const mockUseBeaconCalibration = BeaconHook.useBeaconCalibration as jest.MockedFunction<
  typeof BeaconHook.useBeaconCalibration
>;

describe("BeaconCalibrationDialog Component", () => {
  const defaultHookReturn = {
    phase: "idle" as const,
    activeSample: null,
    secondsRemaining: 0,
    samples: [[], []] as [number[], number[]],
    calibration: null,
    error: null,
    startCalibration: jest.fn(),
    cancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseBeaconCalibration.mockReturnValue(defaultHookReturn);
  });

  it("returns null when open=false", () => {
    const { container } = render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={false}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders dialog with title, inputs, and uncalibrated settings when open=true", () => {
    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByTestId("beacon-calibration-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("beacon-calibration-title")).toHaveTextContent(
      "Bluetooth beacon calibration"
    );
    expect(screen.getByTestId("beacon-first-distance-input")).toHaveValue(1);
    expect(screen.getByTestId("beacon-second-distance-input")).toHaveValue(3);
    expect(screen.getByTestId("beacon-current-settings")).toHaveTextContent(
      "A₀ not calibrated dBm, n not calibrated"
    );
    expect(screen.getByTestId("beacon-start-btn")).toHaveTextContent(
      "Start 10-second samples"
    );
  });

  it("displays calibrated settings accurately when values are provided", () => {
    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        currentReferenceRssi={-58.4}
        currentPathLossExponent={2.15}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByTestId("beacon-current-settings")).toHaveTextContent(
      "A₀ -58.4 dBm, n 2.15"
    );
  });

  it("calls cancel and onClose when close button, cancel button, or backdrop are clicked", () => {
    const handleClose = jest.fn();
    const cancelMock = jest.fn();
    mockUseBeaconCalibration.mockReturnValue({
      ...defaultHookReturn,
      cancel: cancelMock,
    });

    const { rerender } = render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={handleClose}
        onSaved={jest.fn()}
      />
    );

    // Close button
    fireEvent.click(screen.getByTestId("beacon-calibration-close-btn"));
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Cancel button
    rerender(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={handleClose}
        onSaved={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("beacon-cancel-btn"));
    expect(cancelMock).toHaveBeenCalledTimes(2);
    expect(handleClose).toHaveBeenCalledTimes(2);

    // Backdrop click
    rerender(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={handleClose}
        onSaved={jest.fn()}
      />
    );
    const backdrop = screen.getByTestId("beacon-calibration-backdrop");
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(cancelMock).toHaveBeenCalledTimes(3);
    expect(handleClose).toHaveBeenCalledTimes(3);
  });

  it("dismisses on Escape key press", () => {
    const handleClose = jest.fn();
    const cancelMock = jest.fn();
    mockUseBeaconCalibration.mockReturnValue({
      ...defaultHookReturn,
      cancel: cancelMock,
    });

    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={handleClose}
        onSaved={jest.fn()}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("updates distance inputs and triggers startCalibration with numeric inputs", () => {
    const startCalibrationMock = jest.fn();
    mockUseBeaconCalibration.mockReturnValue({
      ...defaultHookReturn,
      startCalibration: startCalibrationMock,
    });

    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    const firstInput = screen.getByTestId("beacon-first-distance-input");
    const secondInput = screen.getByTestId("beacon-second-distance-input");

    fireEvent.change(firstInput, { target: { value: "1.5" } });
    fireEvent.change(secondInput, { target: { value: "4.5" } });

    expect(firstInput).toHaveValue(1.5);
    expect(secondInput).toHaveValue(4.5);

    fireEvent.click(screen.getByTestId("beacon-start-btn"));
    expect(startCalibrationMock).toHaveBeenCalledWith(1.5, 4.5);
  });

  it("renders sampling phase with active sample and countdown, disabling controls", () => {
    mockUseBeaconCalibration.mockReturnValue({
      ...defaultHookReturn,
      phase: "sampling",
      activeSample: 1,
      secondsRemaining: 7,
      samples: [[-55, -57, -56], []],
    });

    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByTestId("beacon-sampling-banner")).toBeInTheDocument();
    expect(screen.getByTestId("beacon-seconds-remaining")).toHaveTextContent(
      "7 seconds remaining"
    );
    expect(screen.getByText("Collecting sample 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("3 RSSI readings collected")).toBeInTheDocument();

    expect(screen.getByTestId("beacon-first-distance-input")).toBeDisabled();
    expect(screen.getByTestId("beacon-second-distance-input")).toBeDisabled();
    expect(screen.getByTestId("beacon-calibration-close-btn")).toBeDisabled();
    expect(screen.getByTestId("beacon-cancel-btn")).toBeDisabled();
    expect(screen.getByTestId("beacon-start-btn")).toBeDisabled();
    expect(screen.getByTestId("beacon-loader-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("beacon-start-btn")).toHaveTextContent("Collecting…");
  });

  it("renders saving phase banner", () => {
    mockUseBeaconCalibration.mockReturnValue({
      ...defaultHookReturn,
      phase: "saving",
    });

    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByTestId("beacon-saving-banner")).toHaveTextContent(
      "Saving calibrated beacon settings…"
    );
    expect(screen.getByTestId("beacon-start-btn")).toHaveTextContent("Saving…");
  });

  it("renders completion banner with calibrated parameters", () => {
    mockUseBeaconCalibration.mockReturnValue({
      ...defaultHookReturn,
      phase: "complete",
      calibration: {
        referenceRssi: -59.2,
        pathLossExponent: 2.24,
        firstDistanceMeters: 1,
        secondDistanceMeters: 3,
        firstMeanRssi: -59.2,
        firstStandardDeviation: 1.8,
        secondMeanRssi: -70.1,
        secondStandardDeviation: 2.3,
        sampleCount: 40,
      },
    });

    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByTestId("beacon-complete-banner")).toBeInTheDocument();
    expect(screen.getByTestId("beacon-calibration-results")).toHaveTextContent(
      "A₀: -59.2 dBm · n: 2.24"
    );
    expect(screen.getByTestId("beacon-start-btn")).toHaveTextContent(
      "Calibrate again"
    );
  });

  it("renders error banner when error occurs", () => {
    mockUseBeaconCalibration.mockReturnValue({
      ...defaultHookReturn,
      phase: "error",
      error: "Bluetooth adapter unavailable or permission denied.",
    });

    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByTestId("beacon-error-banner")).toHaveTextContent(
      "Bluetooth adapter unavailable or permission denied."
    );
  });

  it("applies custom className to dialog", () => {
    render(
      <BeaconCalibrationDialog
        venueId="venue-123"
        open={true}
        className="custom-calibration-dialog-style"
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByTestId("beacon-calibration-dialog").className).toContain(
      "custom-calibration-dialog-style"
    );
  });
});
