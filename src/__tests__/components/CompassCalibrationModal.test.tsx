import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import CompassCalibrationModal, {
  evaluateSensorHealth,
} from "@/components/ar/CompassCalibrationModal";

describe("CompassCalibrationModal Component (#6499)", () => {
  describe("Visibility & Accessible Dialog Semantics", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <CompassCalibrationModal isOpen={false} onClose={jest.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders accessible dialog, title, instructions, and Figure-8 SVG when isOpen is true", () => {
      render(<CompassCalibrationModal isOpen={true} onClose={jest.fn()} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute(
        "aria-labelledby",
        "compass-calibration-title",
      );
      expect(dialog).toHaveAttribute(
        "aria-describedby",
        "compass-calibration-desc",
      );

      expect(
        screen.getByRole("heading", { name: /Compass Sensor Calibration/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Wave your device in a smooth/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId("figure-8-visual-container")).toBeInTheDocument();
      expect(screen.getByTestId("figure-8-animated-particle")).toBeInTheDocument();
    });
  });

  describe("Telemetry Evaluation & Sensor Health Status", () => {
    it("reports low-confidence when platform accuracy < 2", () => {
      render(
        <CompassCalibrationModal
          isOpen={true}
          onClose={jest.fn()}
          accuracy={1}
        />,
      );

      const badge = screen.getByTestId("sensor-health-badge");
      expect(badge).toHaveTextContent(/Sensor Calibration Needed/i);
      expect(badge).toHaveTextContent(/Low magnetometer accuracy \(level 1 of 3\)/i);
    });

    it("reports low-confidence when isDistorted is true (steel-beam magnetic distortion)", () => {
      render(
        <CompassCalibrationModal
          isOpen={true}
          onClose={jest.fn()}
          isDistorted={true}
        />,
      );

      const badge = screen.getByTestId("sensor-health-badge");
      expect(badge).toHaveTextContent(/Sensor Calibration Needed/i);
      expect(badge).toHaveTextContent(/High magnetic distortion detected/i);
    });

    it("reports healthy when platform accuracy >= 2", () => {
      render(
        <CompassCalibrationModal
          isOpen={true}
          onClose={jest.fn()}
          accuracy={3}
        />,
      );

      const badge = screen.getByTestId("sensor-health-badge");
      expect(badge).toHaveTextContent(/Sensors Calibrated/i);
      expect(badge).toHaveTextContent(/Magnetometer accuracy is optimal \(level 3\)/i);
    });

    it("evaluates iOS webkitAccuracyDeg separately in degrees", () => {
      // Uncalibrated negative deviation
      const uncalibrated = evaluateSensorHealth({ webkitAccuracyDeg: -1 });
      expect(uncalibrated.health).toBe("low-confidence");
      expect(uncalibrated.reason).toMatch(/uncalibrated/i);

      // High deviation > 35 deg
      const highDev = evaluateSensorHealth({ webkitAccuracyDeg: 45 });
      expect(highDev.health).toBe("low-confidence");
      expect(highDev.reason).toMatch(/High heading deviation tolerance/i);

      // Optimal deviation <= 35 deg
      const optimal = evaluateSensorHealth({ webkitAccuracyDeg: 12 });
      expect(optimal.health).toBe("healthy");
      expect(optimal.reason).toMatch(/Compass calibrated within ±12°/i);
    });

    it("reports unknown when telemetry is unavailable", () => {
      render(
        <CompassCalibrationModal isOpen={true} onClose={jest.fn()} />,
      );

      const badge = screen.getByTestId("sensor-health-badge");
      expect(badge).toHaveTextContent(/Sensor Status: Ready/i);
      expect(badge).toHaveTextContent(/telemetry unavailable in this browser/i);
    });

    it("displays heading angle when provided", () => {
      render(
        <CompassCalibrationModal
          isOpen={true}
          onClose={jest.fn()}
          heading={185.4}
        />,
      );

      expect(screen.getByTestId("telemetry-heading-display")).toHaveTextContent(
        "185.4°",
      );
    });
  });

  describe("Instructional Progress & Callback Semantics", () => {
    it("advances instructional progress and displays percentage", () => {
      render(<CompassCalibrationModal isOpen={true} onClose={jest.fn()} />);

      const progressText = screen.getByTestId("calibration-progress-percentage");
      expect(progressText).toHaveTextContent("0%");

      const simulateBtn = screen.getByTestId("simulate-motion-step-btn");
      act(() => {
        fireEvent.click(simulateBtn);
      });
      expect(progressText).toHaveTextContent("25%");

      act(() => {
        fireEvent.click(simulateBtn);
        fireEvent.click(simulateBtn);
        fireEvent.click(simulateBtn);
      });
      expect(progressText).toHaveTextContent("100%");
      expect(screen.getByText(/Instructional motion completed/i)).toBeInTheDocument();
    });

    it("fires onClose when 'Calibrate Later' or close 'X' button is clicked", () => {
      const handleClose = jest.fn();
      render(<CompassCalibrationModal isOpen={true} onClose={handleClose} />);

      fireEvent.click(screen.getByTestId("compass-calibration-close-btn"));
      expect(handleClose).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("calibration-dismiss-btn"));
      expect(handleClose).toHaveBeenCalledTimes(2);
    });

    it("fires onComplete when 'I'm Done' or 'Resume AR' button is clicked", () => {
      const handleComplete = jest.fn();
      render(
        <CompassCalibrationModal
          isOpen={true}
          onClose={jest.fn()}
          onComplete={handleComplete}
        />,
      );

      const finishBtn = screen.getByTestId("calibration-complete-btn");
      fireEvent.click(finishBtn);
      expect(handleComplete).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire onCalibrationConfirmed merely because telemetry is healthy", () => {
      const handleConfirmed = jest.fn();

      // Healthy telemetry alone represents sensor confidence, not confirmation that calibration happened
      render(
        <CompassCalibrationModal
          isOpen={true}
          onClose={jest.fn()}
          accuracy={3}
          onCalibrationConfirmed={handleConfirmed}
        />,
      );

      expect(handleConfirmed).not.toHaveBeenCalled();
    });

    it("fires onCalibrationConfirmed ONLY when a trusted isCalibrationConfirmed signal is present", () => {
      const handleConfirmed = jest.fn();

      const { rerender } = render(
        <CompassCalibrationModal
          isOpen={true}
          onClose={jest.fn()}
          telemetry={{ isCalibrationConfirmed: false }}
          onCalibrationConfirmed={handleConfirmed}
        />,
      );
      expect(handleConfirmed).not.toHaveBeenCalled();

      rerender(
        <CompassCalibrationModal
          isOpen={true}
          onClose={jest.fn()}
          telemetry={{ isCalibrationConfirmed: true }}
          onCalibrationConfirmed={handleConfirmed}
        />,
      );
      expect(handleConfirmed).toHaveBeenCalledTimes(1);
    });

    it("handles Escape key to close dialog", () => {
      const handleClose = jest.fn();
      render(<CompassCalibrationModal isOpen={true} onClose={handleClose} />);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Sensor Listener Teardown", () => {
    it("attaches deviceorientation listener in standalone mode and cleanly unregisters on close/unmount", () => {
      const addSpy = jest.spyOn(window, "addEventListener");
      const removeSpy = jest.spyOn(window, "removeEventListener");

      const { unmount, rerender } = render(
        <CompassCalibrationModal
          isOpen={true}
          autoListenSensors={true}
          onClose={jest.fn()}
        />,
      );

      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
      );

      // Closing modal removes listener
      rerender(
        <CompassCalibrationModal
          isOpen={false}
          autoListenSensors={true}
          onClose={jest.fn()}
        />,
      );
      expect(removeSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
      );

      unmount();
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe("Reduced Motion Support", () => {
    it("provides static guidance visual alongside animated SVG path", () => {
      render(<CompassCalibrationModal isOpen={true} onClose={jest.fn()} />);

      const reducedMotionEl = screen.getByTestId(
        "figure-8-reduced-motion-indicator",
      );
      expect(reducedMotionEl).toBeInTheDocument();
      expect(reducedMotionEl).toHaveClass("hidden", "motion-reduce:block");
    });
  });
});
