import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AttitudeHorizonIndicator,
  calculateHorizonTranslation,
  calculateRollRotation,
  isAttitudeLevel,
  calculateFlightDirectorOffset,
} from "@/components/ar/AttitudeHorizonIndicator";

const mockRequestPermission = jest.fn().mockResolvedValue(true);
let mockTrackerState = {
  attitude: { pitch: 0, roll: 0, yaw: 0 },
  isSupported: true,
  isTracking: true,
  permissionState: "granted",
  error: null,
  requestPermission: mockRequestPermission,
};

jest.mock("@/hooks/useFlightAttitudeTracker", () => ({
  useFlightAttitudeTracker: () => mockTrackerState,
}));

describe("AttitudeHorizonIndicator Component and Utility Functions", () => {
  beforeEach(() => {
    mockRequestPermission.mockClear();
    mockTrackerState = {
      attitude: { pitch: 0, roll: 0, yaw: 0 },
      isSupported: true,
      isTracking: true,
      permissionState: "granted",
      error: null,
      requestPermission: mockRequestPermission,
    };
  });

  describe("calculateHorizonTranslation", () => {
    it("calculates vertical pixel translation within bounds for nominal pitch", () => {
      // 10 deg * 3.2 ppd = 32px
      expect(calculateHorizonTranslation(10, 3.2, 140)).toBeCloseTo(32);
      expect(calculateHorizonTranslation(-10, 3.2, 140)).toBeCloseTo(-32);
    });

    it("clamps pitch translation at maxTranslationPx", () => {
      // 80 deg * 3.2 = 256px -> clamped to 140px
      expect(calculateHorizonTranslation(80, 3.2, 140)).toBe(140);
      expect(calculateHorizonTranslation(-80, 3.2, 140)).toBe(-140);
    });

    it("sanitizes NaN, non-finite pitch, or invalid scale inputs gracefully", () => {
      expect(calculateHorizonTranslation(NaN)).toBe(0);
      expect(calculateHorizonTranslation(Infinity)).toBe(0);
      expect(calculateHorizonTranslation(10, NaN, 140)).toBeCloseTo(32);
      expect(calculateHorizonTranslation(10, 3.2, -50)).toBe(32);
    });
  });

  describe("calculateRollRotation", () => {
    it("inverts roll degrees for counter-rotation of artificial horizon", () => {
      expect(calculateRollRotation(30)).toBe(-30);
      expect(calculateRollRotation(-45)).toBe(45);
    });

    it("sanitizes NaN and non-finite roll values to 0", () => {
      expect(calculateRollRotation(NaN)).toBe(0);
      expect(calculateRollRotation(Infinity)).toBe(0);
    });
  });

  describe("isAttitudeLevel", () => {
    it("returns true when pitch and roll are within default tolerance (8°)", () => {
      expect(isAttitudeLevel(4, -5)).toBe(true);
      expect(isAttitudeLevel(0, 0)).toBe(true);
    });

    it("returns false when attitude exceeds level tolerance", () => {
      expect(isAttitudeLevel(12, 0)).toBe(false);
      expect(isAttitudeLevel(0, -15)).toBe(false);
    });

    it("handles non-finite pitch or roll safely", () => {
      expect(isAttitudeLevel(NaN, 0)).toBe(true);
      expect(isAttitudeLevel(0, NaN)).toBe(true);
    });
  });

  describe("calculateFlightDirectorOffset", () => {
    it("calculates pitch and shortest circular yaw errors", () => {
      // Target pitch +10, current +5 -> error +5
      // Target yaw 10, current 350 -> error +20 deg (wrap across 0/360)
      const res = calculateFlightDirectorOffset(5, 10, 350, 10);
      expect(res.pitchError).toBe(5);
      expect(res.yawError).toBe(20);
      expect(res.isAligned).toBe(false);
    });

    it("identifies aligned state within small tolerance", () => {
      const res = calculateFlightDirectorOffset(2, 4, 180, 182);
      expect(res.pitchError).toBe(2);
      expect(res.yawError).toBe(2);
      expect(res.isAligned).toBe(true);
    });

    it("sanitizes non-finite inputs to safe defaults without crashing", () => {
      const res = calculateFlightDirectorOffset(NaN, NaN, NaN, NaN);
      expect(res.pitchError).toBe(0);
      expect(res.yawError).toBe(0);
      expect(res.isAligned).toBe(true);
    });
  });

  describe("AttitudeHorizonIndicator Component Rendering", () => {
    it("renders instrument bezel, horizon disc, and reference symbol", () => {
      render(<AttitudeHorizonIndicator pitch={10} roll={-15} yaw={270} />);

      expect(screen.getByTestId("attitude-horizon-indicator")).toBeInTheDocument();
      expect(screen.getByTestId("horizon-disc")).toBeInTheDocument();
      expect(screen.getByTestId("pitch-ladder")).toBeInTheDocument();
      expect(screen.getByTestId("aircraft-reference-symbol")).toBeInTheDocument();

      // Check telemetry outputs
      expect(screen.getByTestId("attitude-pitch-telemetry")).toHaveTextContent("+10.0°");
      expect(screen.getByTestId("attitude-roll-telemetry")).toHaveTextContent("-15.0°");
      expect(screen.getByTestId("attitude-yaw-telemetry")).toHaveTextContent("270°");
    });

    it("sanitizes NaN and negative prop angles gracefully", () => {
      render(<AttitudeHorizonIndicator pitch={NaN} roll={NaN} yaw={-90} />);

      expect(screen.getByTestId("attitude-pitch-telemetry")).toHaveTextContent("+0.0°");
      expect(screen.getByTestId("attitude-roll-telemetry")).toHaveTextContent("+0.0°");
      // -90 normalized to 270 on compass
      expect(screen.getByTestId("attitude-yaw-telemetry")).toHaveTextContent("270°");
    });

    it("renders flight director cue and guidance banner when target waypoint provided", () => {
      render(
        <AttitudeHorizonIndicator
          pitch={0}
          roll={0}
          yaw={90}
          targetPitch={10}
          targetHeading={90}
          targetLabel="Desk 42B"
        />,
      );

      expect(screen.getByTestId("flight-director-cue")).toBeInTheDocument();
      expect(screen.getByTestId("ar-guidance-banner")).toBeInTheDocument();
      expect(screen.getByText(/STEER VECTOR:/i)).toBeInTheDocument();
    });

    it("displays locked alignment banner when target is reached", () => {
      render(
        <AttitudeHorizonIndicator
          pitch={10}
          roll={0}
          yaw={90}
          targetPitch={10}
          targetHeading={90}
          targetLabel="Desk 42B"
        />,
      );

      expect(screen.getByText(/ON VECTOR \/\/ DESK 42B LOCKED/i)).toBeInTheDocument();
    });

    it("handles interactive simulator controls smoothly without jumping to zero", () => {
      render(<AttitudeHorizonIndicator pitch={20} roll={10} />);

      const pitchUpBtn = screen.getByTestId("simulate-pitch-up-btn");
      fireEvent.click(pitchUpBtn);

      // Increments from 20 to 30
      expect(screen.getByTestId("attitude-pitch-telemetry")).toHaveTextContent("+30.0°");

      // Reset button should now be visible
      const resetBtn = screen.getByTestId("simulate-level-btn");
      expect(resetBtn).toBeInTheDocument();
      fireEvent.click(resetBtn);

      // Resets back to prop pitch
      expect(screen.getByTestId("attitude-pitch-telemetry")).toHaveTextContent("+20.0°");
    });

    it("renders permission request button when motion permission is in prompt state", () => {
      mockTrackerState.permissionState = "prompt";
      render(<AttitudeHorizonIndicator />);

      const permBtn = screen.getByTestId("request-attitude-permission-btn");
      expect(permBtn).toBeInTheDocument();

      fireEvent.click(permBtn);
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });
  });
});
