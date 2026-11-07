import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  CockpitVerticalSpeedTape,
  calculateVerticalSpeedFpm,
  interpolateVsiNeedleOffset,
  fpmToMetersPerSecond,
  calculateFloorTransitEtaSeconds,
  classifyVerticalRate,
  playAvionicsRateChime,
} from "@/components/hud/CockpitVerticalSpeedTape";

describe("CockpitVerticalSpeedTape Mathematical Telemetry Utilities", () => {
  describe("calculateVerticalSpeedFpm", () => {
    it("returns 0 when from and to floors are identical or duration is non-positive", () => {
      expect(calculateVerticalSpeedFpm(3, 3, 10)).toBe(0);
      expect(calculateVerticalSpeedFpm(1, 5, 0)).toBe(0);
      expect(calculateVerticalSpeedFpm(1, 5, -5)).toBe(0);
      expect(calculateVerticalSpeedFpm(1, 5, NaN as any)).toBe(0);
    });

    it("calculates accurate vertical speed FPM for upward climb and downward descent", () => {
      // 4 floors * 14 ft = 56 ft in 10s => (56 * 60) / 10 = 336 FPM
      expect(calculateVerticalSpeedFpm(1, 5, 10, 14)).toBe(336);
      // Downward descent: -4 floors * 14 ft in 10s => -336 FPM
      expect(calculateVerticalSpeedFpm(5, 1, 10, 14)).toBe(-336);
    });
  });

  describe("interpolateVsiNeedleOffset", () => {
    it("translates needle offset proportionally from center line", () => {
      expect(interpolateVsiNeedleOffset(0, 3000, 100)).toBe(0);
      // Climb moves needle up (negative translateY)
      expect(interpolateVsiNeedleOffset(1500, 3000, 100)).toBe(-50);
      // Descent moves needle down (positive translateY)
      expect(interpolateVsiNeedleOffset(-1500, 3000, 100)).toBe(50);
    });

    it("clamps values beyond max scale limits", () => {
      expect(interpolateVsiNeedleOffset(4500, 3000, 100)).toBe(-100);
      expect(interpolateVsiNeedleOffset(-4500, 3000, 100)).toBe(100);
    });

    it("handles non-finite parameters safely", () => {
      expect(interpolateVsiNeedleOffset(NaN as any, 3000, 100)).toBe(0);
      expect(interpolateVsiNeedleOffset(1500, 0, 0)).toBe(-48);
    });
  });

  describe("fpmToMetersPerSecond", () => {
    it("converts FPM to metric m/s accurately", () => {
      expect(fpmToMetersPerSecond(1000)).toBe(5.1);
      expect(fpmToMetersPerSecond(-1000)).toBe(-5.1);
      expect(fpmToMetersPerSecond(0)).toBe(0);
      expect(fpmToMetersPerSecond(NaN as any)).toBe(0);
    });
  });

  describe("calculateFloorTransitEtaSeconds", () => {
    it("calculates floor transit ETA in seconds", () => {
      // 4 floors * 14 ft = 56 ft at 1000 FPM => (56 / 1000) * 60 = 3.36s => rounds to 3s
      expect(calculateFloorTransitEtaSeconds(1, 5, 1000, 14)).toBe(3);
      // Same floor returns 0
      expect(calculateFloorTransitEtaSeconds(3, 3, 1000, 14)).toBe(0);
      // Zero speed returns 0
      expect(calculateFloorTransitEtaSeconds(1, 5, 0, 14)).toBe(0);
    });
  });

  describe("classifyVerticalRate", () => {
    it("classifies level, climb, and descent intensities", () => {
      expect(classifyVerticalRate(20).state).toBe("LEVEL");
      expect(classifyVerticalRate(-20).state).toBe("LEVEL");

      // Climb
      expect(classifyVerticalRate(500)).toMatchObject({ state: "CLIMB", intensity: "NORMAL" });
      expect(classifyVerticalRate(1500)).toMatchObject({ state: "CLIMB", intensity: "ELEVATED" });
      expect(classifyVerticalRate(2500)).toMatchObject({ state: "CLIMB", intensity: "RAPID" });

      // Descent
      expect(classifyVerticalRate(-500)).toMatchObject({ state: "DESCENT", intensity: "NORMAL" });
      expect(classifyVerticalRate(-1500)).toMatchObject({ state: "DESCENT", intensity: "ELEVATED" });
      expect(classifyVerticalRate(-2500)).toMatchObject({ state: "DESCENT", intensity: "RAPID" });
    });
  });

  describe("playAvionicsRateChime", () => {
    it("executes safely in test environment without throwing", () => {
      expect(() => playAvionicsRateChime(true)).not.toThrow();
      expect(() => playAvionicsRateChime(false)).not.toThrow();
    });
  });
});

describe("CockpitVerticalSpeedTape Component", () => {
  it("renders with default props and displays telemetry readouts", () => {
    render(
      <CockpitVerticalSpeedTape
        currentFloor={2}
        targetFloor={6}
        totalFloors={10}
        venueName="Orion Sector"
      />
    );

    expect(screen.getByTestId("cockpit-vertical-speed-tape")).toBeInTheDocument();
    expect(screen.getByTestId("vsi-venue-name")).toHaveTextContent("Orion Sector");
    expect(screen.getByTestId("vsi-status-annunciator")).toBeInTheDocument();
    expect(screen.getByTestId("vsi-digital-readout")).toBeInTheDocument();
    expect(screen.getByTestId("vsi-transit-eta")).toBeInTheDocument();
    expect(screen.getByTestId("vsi-tape-scale")).toBeInTheDocument();
    expect(screen.getByTestId("vsi-rate-ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("vsi-needle-pointer")).toBeInTheDocument();
    expect(screen.getByTestId("vsi-transit-mode-name")).toHaveTextContent("Passenger Lift");
  });

  it("handles unknown transitMode gracefully with fallback", () => {
    render(
      <CockpitVerticalSpeedTape
        transitMode={"hyperloop_lift" as any}
        venueName="Experimental Shaft"
      />
    );

    expect(screen.getByTestId("vsi-transit-mode-name")).toHaveTextContent("Passenger Lift");
  });

  it("renders explicit verticalSpeedFpm prop and respects descent styling", () => {
    render(
      <CockpitVerticalSpeedTape
        verticalSpeedFpm={-1200}
        currentFloor={8}
        targetFloor={2}
      />
    );

    expect(screen.getByTestId("vsi-digital-readout")).toHaveTextContent("-1,200 FPM");
    expect(screen.getByTestId("vsi-status-annunciator")).toHaveTextContent("EXPRESS DESCENT");
  });

  it("adjusts simulated vertical speed with stepper buttons", () => {
    const handleSpeedChange = jest.fn();
    render(
      <CockpitVerticalSpeedTape
        verticalSpeedFpm={500}
        onVerticalSpeedChange={handleSpeedChange}
      />
    );

    const upBtn = screen.getByTestId("vsi-increase-rate-btn");
    const downBtn = screen.getByTestId("vsi-decrease-rate-btn");
    const levelBtn = screen.getByTestId("vsi-level-rate-btn");

    fireEvent.click(upBtn);
    expect(handleSpeedChange).toHaveBeenCalledWith(750);

    fireEvent.click(downBtn);
    expect(handleSpeedChange).toHaveBeenCalledWith(500);

    fireEvent.click(levelBtn);
    expect(handleSpeedChange).toHaveBeenCalledWith(0);
  });

  it("handles target floor adjustments and bounds checks", () => {
    const handleFloorChange = jest.fn();
    const { rerender } = render(
      <CockpitVerticalSpeedTape
        currentFloor={2}
        targetFloor={5}
        totalFloors={10}
        onFloorTransitionChange={handleFloorChange}
      />
    );

    const floorUpBtn = screen.getByTestId("vsi-target-floor-up-btn");
    const floorDownBtn = screen.getByTestId("vsi-target-floor-down-btn");

    fireEvent.click(floorUpBtn);
    expect(handleFloorChange).toHaveBeenCalledWith(2, 6);

    fireEvent.click(floorDownBtn);
    expect(handleFloorChange).toHaveBeenCalledWith(2, 4);

    rerender(
      <CockpitVerticalSpeedTape
        currentFloor={2}
        targetFloor={10}
        totalFloors={10}
        onFloorTransitionChange={handleFloorChange}
      />
    );
    expect(screen.getByTestId("vsi-target-floor-up-btn")).toBeDisabled();

    rerender(
      <CockpitVerticalSpeedTape
        currentFloor={2}
        targetFloor={1}
        totalFloors={10}
        onFloorTransitionChange={handleFloorChange}
      />
    );
    expect(screen.getByTestId("vsi-target-floor-down-btn")).toBeDisabled();
  });

  it("merges custom className on root element", () => {
    render(<CockpitVerticalSpeedTape className="custom-vsi-hud-wrapper" />);
    expect(screen.getByTestId("cockpit-vertical-speed-tape").className).toContain(
      "custom-vsi-hud-wrapper"
    );
  });
});
