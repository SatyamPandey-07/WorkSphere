import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  CockpitVerticalSpeedTape,
  calculateVerticalSpeedFpm,
  interpolateVsiNeedleOffset,
  fpmToMetersPerSecond,
  calculateFloorTransitEtaSeconds,
  classifyVerticalRate,
} from "../CockpitVerticalSpeedTape";

describe("CockpitVerticalSpeedTape", () => {
  describe("calculateVerticalSpeedFpm", () => {
    it("calculates positive climb rate when ascending floors", () => {
      // Ascending from Floor 1 to Floor 5 (4 floors * 14 ft = 56 ft) in 10 seconds
      // 56 * 60 / 10 = 336 FPM
      const fpm = calculateVerticalSpeedFpm(1, 5, 10, 14);
      expect(fpm).toBe(336);
    });

    it("calculates negative descent rate when descending floors", () => {
      // Descending from Floor 6 to Floor 2 (-4 floors * 14 ft = -56 ft) in 10 seconds
      const fpm = calculateVerticalSpeedFpm(6, 2, 10, 14);
      expect(fpm).toBe(-336);
    });

    it("returns 0 FPM when remaining on the same floor", () => {
      expect(calculateVerticalSpeedFpm(3, 3, 10, 14)).toBe(0);
    });

    it("returns 0 FPM for non-positive duration", () => {
      expect(calculateVerticalSpeedFpm(1, 4, 0, 14)).toBe(0);
      expect(calculateVerticalSpeedFpm(1, 4, -5, 14)).toBe(0);
    });
  });

  describe("interpolateVsiNeedleOffset", () => {
    it("maps 0 FPM to center 0 px offset", () => {
      expect(interpolateVsiNeedleOffset(0, 3000, 100)).toBe(0);
    });

    it("maps max climb (+3,000 FPM) to -100 px upward offset", () => {
      expect(interpolateVsiNeedleOffset(3000, 3000, 100)).toBe(-100);
    });

    it("maps max descent (-3,000 FPM) to +100 px downward offset", () => {
      expect(interpolateVsiNeedleOffset(-3000, 3000, 100)).toBe(100);
    });

    it("maps half-scale climb (+1,500 FPM) to -50 px offset", () => {
      expect(interpolateVsiNeedleOffset(1500, 3000, 100)).toBe(-50);
    });

    it("clamps values exceeding scale boundaries", () => {
      expect(interpolateVsiNeedleOffset(5000, 3000, 100)).toBe(-100);
      expect(interpolateVsiNeedleOffset(-5000, 3000, 100)).toBe(100);
    });
  });

  describe("fpmToMetersPerSecond", () => {
    it("converts 0 FPM to 0.0 m/s", () => {
      expect(fpmToMetersPerSecond(0)).toBe(0);
    });

    it("converts +1,000 FPM to 5.1 m/s", () => {
      expect(fpmToMetersPerSecond(1000)).toBe(5.1);
    });

    it("converts +2,400 FPM (express elevator) to 12.2 m/s", () => {
      expect(fpmToMetersPerSecond(2400)).toBe(12.2);
    });
  });

  describe("calculateFloorTransitEtaSeconds", () => {
    it("returns 0 if already on target floor", () => {
      expect(calculateFloorTransitEtaSeconds(4, 4, 1000)).toBe(0);
    });

    it("returns 0 if vertical speed is 0", () => {
      expect(calculateFloorTransitEtaSeconds(1, 5, 0)).toBe(0);
    });

    it("calculates transit ETA seconds accurately", () => {
      // 5 floors * 14 ft = 70 ft at 1,000 FPM
      // (70 / 1000) * 60 = 4.2 seconds -> 4s
      expect(calculateFloorTransitEtaSeconds(1, 6, 1000, 14)).toBe(4);
    });
  });

  describe("classifyVerticalRate", () => {
    it("classifies near-zero rates as LEVEL TRANSIT", () => {
      const result = classifyVerticalRate(20);
      expect(result.state).toBe("LEVEL");
      expect(result.label).toBe("LEVEL TRANSIT");
    });

    it("classifies normal climb rate", () => {
      const result = classifyVerticalRate(500);
      expect(result.state).toBe("CLIMB");
      expect(result.intensity).toBe("NORMAL");
      expect(result.label).toBe("ASCENDING");
    });

    it("classifies express elevator climb", () => {
      const result = classifyVerticalRate(1500);
      expect(result.state).toBe("CLIMB");
      expect(result.intensity).toBe("ELEVATED");
      expect(result.label).toBe("EXPRESS CLIMB");
    });

    it("classifies rapid climb", () => {
      const result = classifyVerticalRate(2500);
      expect(result.state).toBe("CLIMB");
      expect(result.intensity).toBe("RAPID");
      expect(result.label).toBe("RAPID ASCENT");
    });

    it("classifies descent rates", () => {
      const normal = classifyVerticalRate(-400);
      expect(normal.state).toBe("DESCENT");
      expect(normal.label).toBe("DESCENDING");

      const rapid = classifyVerticalRate(-2200);
      expect(rapid.state).toBe("DESCENT");
      expect(rapid.intensity).toBe("RAPID");
      expect(rapid.label).toBe("RAPID DROP");
    });
  });

  describe("CockpitVerticalSpeedTape Component", () => {
    it("renders with default props and displays core HUD tape elements", () => {
      render(
        <CockpitVerticalSpeedTape
          venueName="Apex Tower Central"
          verticalSpeedFpm={1200}
          currentFloor={2}
          targetFloor={6}
          totalFloors={12}
        />,
      );

      expect(screen.getByText("Apex Tower Central")).toBeInTheDocument();
      expect(screen.getByTestId("cockpit-vertical-speed-tape")).toBeInTheDocument();
      expect(screen.getByTestId("vsi-tape-scale")).toBeInTheDocument();
      expect(screen.getByTestId("vsi-digital-readout")).toBeInTheDocument();
      expect(screen.getByTestId("vsi-needle-pointer")).toBeInTheDocument();
      expect(screen.getByTestId("vsi-rate-ribbon")).toBeInTheDocument();
      expect(screen.getByText("+1,200 FPM")).toBeInTheDocument();
      expect(screen.getByText("F2 ➔ F6")).toBeInTheDocument();
    });

    it("renders scale tick marks for 0, 1000, 2000, -1000, and -2000 FPM", () => {
      render(
        <CockpitVerticalSpeedTape
          verticalSpeedFpm={0}
          currentFloor={1}
          targetFloor={1}
        />,
      );

      expect(screen.getByTestId("vsi-mark-0")).toBeInTheDocument();
      expect(screen.getByTestId("vsi-mark-1000")).toBeInTheDocument();
      expect(screen.getByTestId("vsi-mark-2000")).toBeInTheDocument();
      expect(screen.getByTestId("vsi-mark--1000")).toBeInTheDocument();
      expect(screen.getByTestId("vsi-mark--2000")).toBeInTheDocument();
    });

    it("allows stepping climb rate up and down with buttons", () => {
      const handleRateChange = jest.fn();
      render(
        <CockpitVerticalSpeedTape
          verticalSpeedFpm={1000}
          onVerticalSpeedChange={handleRateChange}
        />,
      );

      const increaseBtn = screen.getByRole("button", { name: /increase climb rate/i });
      fireEvent.click(increaseBtn);
      expect(handleRateChange).toHaveBeenCalledWith(1250);

      const decreaseBtn = screen.getByRole("button", { name: /decrease climb rate/i });
      fireEvent.click(decreaseBtn);
      expect(handleRateChange).toHaveBeenCalledWith(1000);

      const levelBtn = screen.getByRole("button", { name: /level out vertical speed/i });
      fireEvent.click(levelBtn);
      expect(handleRateChange).toHaveBeenCalledWith(0);
    });

    it("allows changing target floor via floor stepper buttons", () => {
      const handleFloorTransition = jest.fn();
      render(
        <CockpitVerticalSpeedTape
          currentFloor={3}
          targetFloor={7}
          totalFloors={15}
          onFloorTransitionChange={handleFloorTransition}
        />,
      );

      const incFloorBtn = screen.getByRole("button", { name: /increase target floor/i });
      fireEvent.click(incFloorBtn);
      expect(handleFloorTransition).toHaveBeenCalledWith(3, 8);

      const decFloorBtn = screen.getByRole("button", { name: /decrease target floor/i });
      fireEvent.click(decFloorBtn);
      expect(handleFloorTransition).toHaveBeenCalledWith(3, 6);
    });

    it("triggers rate change audio and safely closes AudioContext", () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      const mockStart = jest.fn();
      const mockStop = jest.fn();
      let capturedOnEnded: (() => void) | null = null;

      class MockAudioContext {
        state = "running";
        currentTime = 0;
        destination = {};
        createOscillator() {
          return {
            type: "sine",
            frequency: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
            connect: jest.fn(),
            start: mockStart,
            stop: mockStop,
            set onended(handler: () => void) {
              capturedOnEnded = handler;
            },
          };
        }
        createGain() {
          return {
            gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
            connect: jest.fn(),
          };
        }
        close = mockClose;
      }

      (window as any).AudioContext = MockAudioContext;

      const { rerender } = render(
        <CockpitVerticalSpeedTape
          verticalSpeedFpm={-500}
          enableAudioFeedback={true}
        />
      );

      rerender(
        <CockpitVerticalSpeedTape
          verticalSpeedFpm={500}
          enableAudioFeedback={true}
        />
      );

      expect(mockStart).toHaveBeenCalled();
      if (capturedOnEnded) {
        capturedOnEnded();
        expect(mockClose).toHaveBeenCalled();
      }
    });
  });
});
