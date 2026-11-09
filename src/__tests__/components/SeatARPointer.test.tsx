import React from "react";
import { render, screen } from "@testing-library/react";
import {
  SeatARPointer,
  calculateBarometricAltitude,
  calculateFloorFromAltitude,
} from "@/components/ar/SeatARPointer";

describe("SeatARPointer Component & Multi-Floor Altitude Detection", () => {
  describe("Altitude & Barometric Calculation Helpers", () => {
    it("returns zero altitude when current pressure equals baseline pressure", () => {
      const alt = calculateBarometricAltitude(1013.25, 1013.25);
      expect(alt).toBeCloseTo(0, 1);
    });

    it("calculates positive altitude when pressure drops (higher floor)", () => {
      // Atmospheric pressure decreases with altitude: ~1000 hPa is roughly ~110m higher
      const alt = calculateBarometricAltitude(1000, 1013.25);
      expect(alt).toBeGreaterThan(0);
      expect(alt).toBeCloseTo(111, 0);
    });

    it("calculates negative altitude when pressure rises (basement levels)", () => {
      const alt = calculateBarometricAltitude(1020, 1013.25);
      expect(alt).toBeLessThan(0);
    });

    it("handles zero or negative pressure values safely without NaN or throwing", () => {
      expect(calculateBarometricAltitude(0, 1013.25)).toBe(0);
      expect(calculateBarometricAltitude(-5, 1013.25)).toBe(0);
      expect(calculateBarometricAltitude(1013.25, 0)).toBe(0);
      expect(calculateBarometricAltitude(1013.25, -10)).toBe(0);
    });

    it("estimates floor numbers accurately based on default floor height (3.5m)", () => {
      expect(calculateFloorFromAltitude(0, 3.5, 1)).toBe(1);
      expect(calculateFloorFromAltitude(3.5, 3.5, 1)).toBe(2);
      expect(calculateFloorFromAltitude(7.0, 3.5, 1)).toBe(3);
      expect(calculateFloorFromAltitude(10.5, 3.5, 1)).toBe(4);
    });

    it("estimates intermediate elevations to nearest floor level correctly", () => {
      expect(calculateFloorFromAltitude(1.2, 3.5, 1)).toBe(1);
      expect(calculateFloorFromAltitude(2.5, 3.5, 1)).toBe(2);
      expect(calculateFloorFromAltitude(5.8, 3.5, 1)).toBe(3);
    });

    it("handles zero or negative floorHeight safely", () => {
      expect(calculateFloorFromAltitude(10, 0, 1)).toBe(1);
      expect(calculateFloorFromAltitude(10, -3.5, 1)).toBe(1);
    });

    it("supports custom base floor designations", () => {
      expect(calculateFloorFromAltitude(0, 3.5, 0)).toBe(0);
      expect(calculateFloorFromAltitude(3.5, 3.5, 0)).toBe(1);
    });
  });

  describe("Vertical Floor Guidance Badge Rendering", () => {
    it("renders 'Take Elevator / Stairs to Floor X' badge when user is on ground floor and seat is on Floor 3", () => {
      render(
        <SeatARPointer
          targetSeatNumber="A-102"
          targetFloor={3}
          userAltitude={0}
          floorHeightMeters={3.5}
        />
      );

      const guidanceBadge = screen.getByTestId("vertical-floor-guidance-badge");
      expect(guidanceBadge).toBeInTheDocument();
      expect(guidanceBadge).toHaveTextContent("Take Elevator / Stairs to Floor 3");
      expect(guidanceBadge).toHaveTextContent("Current Level: Floor 1 · Target: Floor 3");
    });

    it("renders 'Take Elevator / Stairs to Floor X' badge when user is on Floor 4 and seat is on Floor 2", () => {
      // User is at 10.5m (Floor 4), target is Floor 2 (3.5m)
      render(
        <SeatARPointer
          targetSeatNumber="B-205"
          targetFloor={2}
          userAltitude={10.5}
          floorHeightMeters={3.5}
        />
      );

      const guidanceBadge = screen.getByTestId("vertical-floor-guidance-badge");
      expect(guidanceBadge).toBeInTheDocument();
      expect(guidanceBadge).toHaveTextContent("Take Elevator / Stairs to Floor 2");
      expect(guidanceBadge).toHaveTextContent("Current Level: Floor 4 · Target: Floor 2");
    });

    it("renders normal seat direction pointer without stairs guidance when user is on the correct floor", () => {
      // Target is Floor 2 (3.5m), user is at 3.6m (within vertical threshold)
      render(
        <SeatARPointer
          targetSeatNumber="C-301"
          targetFloor={2}
          userAltitude={3.6}
          floorHeightMeters={3.5}
          verticalThresholdMeters={1.5}
        />
      );

      expect(screen.queryByTestId("vertical-floor-guidance-badge")).not.toBeInTheDocument();
      const seatPointer = screen.getByTestId("seat-direction-pointer");
      expect(seatPointer).toBeInTheDocument();
      expect(seatPointer).toHaveTextContent("Seat C-301");
      expect(seatPointer).toHaveTextContent("Floor 2 (On Target Level)");
    });

    it("calculates altitude using barometric pressure changes when userAltitude is omitted", () => {
      // Target Floor 2 = 3.5m elevation
      // Normal baseline = 1013.25. If current pressure is 1012.8 hPa (~3.7m altitude)
      render(
        <SeatARPointer
          targetSeatNumber="D-10"
          targetFloor={2}
          baselinePressureHpa={1013.25}
          currentPressureHpa={1012.8}
          floorHeightMeters={3.5}
          verticalThresholdMeters={1.5}
        />
      );

      // User is approximately at Floor 2, so should be on target level
      expect(screen.queryByTestId("vertical-floor-guidance-badge")).not.toBeInTheDocument();
      expect(screen.getByTestId("seat-direction-pointer")).toHaveTextContent("Seat D-10");
    });

    it("shows guidance badge when barometric pressure indicates user is on ground floor but target is on upper floor", () => {
      render(
        <SeatARPointer
          targetSeatNumber="E-22"
          targetFloor={3}
          baselinePressureHpa={1013.25}
          currentPressureHpa={1013.25} // ground level (0m)
          floorHeightMeters={3.5}
        />
      );

      const guidanceBadge = screen.getByTestId("vertical-floor-guidance-badge");
      expect(guidanceBadge).toBeInTheDocument();
      expect(guidanceBadge).toHaveTextContent("Take Elevator / Stairs to Floor 3");
    });

    it("triggers onFloorReached callback when user reaches the correct floor", () => {
      const handleFloorReached = jest.fn();

      render(
        <SeatARPointer
          targetSeatNumber="F-01"
          targetFloor={3}
          userAltitude={7.0} // Floor 3 level ((3-1)*3.5 = 7.0)
          floorHeightMeters={3.5}
          onFloorReached={handleFloorReached}
        />
      );

      expect(handleFloorReached).toHaveBeenCalledWith(3);
    });

    it("does not trigger onFloorReached callback when user is still on the wrong floor", () => {
      const handleFloorReached = jest.fn();

      render(
        <SeatARPointer
          targetSeatNumber="F-01"
          targetFloor={3}
          userAltitude={0.0} // Ground floor
          floorHeightMeters={3.5}
          onFloorReached={handleFloorReached}
        />
      );

      expect(handleFloorReached).not.toHaveBeenCalled();
    });

    it("falls back to userPosition.y when altitude and pressure are undefined", () => {
      render(
        <SeatARPointer
          targetSeatNumber="G-99"
          targetFloor={2}
          userPosition={{ x: 10, y: 3.5, z: 5 }}
          floorHeightMeters={3.5}
        />
      );

      expect(screen.queryByTestId("vertical-floor-guidance-badge")).not.toBeInTheDocument();
      expect(screen.getByTestId("seat-direction-pointer")).toBeInTheDocument();
    });

    it("respects custom verticalThresholdMeters parameter", () => {
      // Distance is 2.0m, default threshold is 1.5m -> triggers badge
      // With custom threshold 2.5m -> should not trigger badge
      const { rerender } = render(
        <SeatARPointer
          targetSeatNumber="H-44"
          targetFloor={2}
          userAltitude={1.5} // target is 3.5m, diff is 2.0m
          floorHeightMeters={3.5}
          verticalThresholdMeters={1.0}
        />
      );

      expect(screen.getByTestId("vertical-floor-guidance-badge")).toBeInTheDocument();

      rerender(
        <SeatARPointer
          targetSeatNumber="H-44"
          targetFloor={2}
          userAltitude={1.5}
          floorHeightMeters={3.5}
          verticalThresholdMeters={2.5}
        />
      );

      expect(screen.queryByTestId("vertical-floor-guidance-badge")).not.toBeInTheDocument();
      expect(screen.getByTestId("seat-direction-pointer")).toBeInTheDocument();
    });
  });

  describe("Multi-Story Coworking Building Elevation Delta Simulations", () => {
    it("simulates elevation delta across a 10-story building", () => {
      const targetFloor = 7;
      const floorHeight = 3.5;

      for (let floor = 1; floor <= 10; floor++) {
        const userAltitude = (floor - 1) * floorHeight;
        const { unmount } = render(
          <SeatARPointer
            targetSeatNumber={`SEAT-${floor}`}
            targetFloor={targetFloor}
            userAltitude={userAltitude}
            floorHeightMeters={floorHeight}
            verticalThresholdMeters={1.5}
          />
        );

        if (floor === targetFloor) {
          expect(screen.queryByTestId("vertical-floor-guidance-badge")).not.toBeInTheDocument();
          expect(screen.getByTestId("seat-direction-pointer")).toHaveTextContent(`Floor ${targetFloor} (On Target Level)`);
        } else {
          const badge = screen.getByTestId("vertical-floor-guidance-badge");
          expect(badge).toHaveTextContent(`Take Elevator / Stairs to Floor ${targetFloor}`);
          expect(badge).toHaveTextContent(`Current Level: Floor ${floor}`);
        }

        unmount();
      }
    });

    it("simulates continuous elevator ascent with changing altitude", () => {
      const targetFloor = 5; // target = 14m
      const stepAltitudes = [0, 2.5, 6.0, 10.0, 13.8, 14.0, 17.5];

      stepAltitudes.forEach((alt) => {
        const { unmount } = render(
          <SeatARPointer
            targetSeatNumber="ELEV-DESK"
            targetFloor={targetFloor}
            userAltitude={alt}
            floorHeightMeters={3.5}
            verticalThresholdMeters={1.5}
          />
        );

        const diff = Math.abs(14.0 - alt);
        if (diff <= 1.5) {
          expect(screen.getByTestId("seat-direction-pointer")).toBeInTheDocument();
        } else {
          expect(screen.getByTestId("vertical-floor-guidance-badge")).toBeInTheDocument();
        }

        unmount();
      }
    );
  });

    it("simulates continuous barometric pressure drops during stair ascent", () => {
      const targetFloor = 3; // 7.0m
      const pressures = [1013.25, 1012.9, 1012.4, 1011.5]; // descending pressure

      pressures.forEach((pressure) => {
        const calculatedAlt = calculateBarometricAltitude(pressure, 1013.25);
        const { unmount } = render(
          <SeatARPointer
            targetSeatNumber="STAIRS-DESK"
            targetFloor={targetFloor}
            currentPressureHpa={pressure}
            baselinePressureHpa={1013.25}
            floorHeightMeters={3.5}
            verticalThresholdMeters={1.5}
          />
        );

        const diff = Math.abs(7.0 - calculatedAlt);
        if (diff <= 1.5) {
          expect(screen.getByTestId("seat-direction-pointer")).toBeInTheDocument();
        } else {
          expect(screen.getByTestId("vertical-floor-guidance-badge")).toBeInTheDocument();
        }

        unmount();
      });
    });

    it("handles negative altitude representing underground basement levels", () => {
      render(
        <SeatARPointer
          targetSeatNumber="BASEMENT-SEAT"
          targetFloor={1}
          userAltitude={-7.0} // Two levels down in basement
          floorHeightMeters={3.5}
        />
      );

      const badge = screen.getByTestId("vertical-floor-guidance-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("Take Elevator / Stairs to Floor 1");
      expect(badge).toHaveTextContent("Current Level: Floor -1");
    });

    it("verifies badge animation and accessibility attributes", () => {
      render(
        <SeatARPointer
          targetSeatNumber="DESK-ACC"
          targetFloor={4}
          userAltitude={0}
          floorHeightMeters={3.5}
        />
      );

      const container = screen.getByTestId("seat-ar-pointer-container");
      expect(container).toBeInTheDocument();
      expect(container).toHaveClass("pointer-events-none");

      const badge = screen.getByTestId("vertical-floor-guidance-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("animate-pulse");
      expect(badge).toHaveClass("pointer-events-auto");
    });

    it("correctly displays formatted positive elevation deltas in badge", () => {
      render(
        <SeatARPointer
          targetSeatNumber="DESK-DELTA-UP"
          targetFloor={3}
          userAltitude={0}
          floorHeightMeters={3.5}
        />
      );

      const badge = screen.getByTestId("vertical-floor-guidance-badge");
      expect(badge).toHaveTextContent("Vertical Elevation: +7.0m");
    });

    it("correctly displays formatted negative elevation deltas in badge", () => {
      render(
        <SeatARPointer
          targetSeatNumber="DESK-DELTA-DOWN"
          targetFloor={1}
          userAltitude={7.0}
          floorHeightMeters={3.5}
        />
      );

      const badge = screen.getByTestId("vertical-floor-guidance-badge");
      expect(badge).toHaveTextContent("Vertical Elevation: -7.0m");
    });

    it("handles zero delta cleanly without negative zero string formatting", () => {
      render(
        <SeatARPointer
          targetSeatNumber="DESK-PERFECT-MATCH"
          targetFloor={2}
          userAltitude={3.5}
          floorHeightMeters={3.5}
        />
      );

      expect(screen.queryByTestId("vertical-floor-guidance-badge")).not.toBeInTheDocument();
      expect(screen.getByTestId("seat-direction-pointer")).toHaveTextContent("Seat DESK-PERFECT-MATCH");
    });

    it("renders smoothly when target position offset Y is applied", () => {
      render(
        <SeatARPointer
          targetSeatNumber="DESK-TABLETOP-OFFSET"
          targetFloor={2}
          targetPosition={{ x: 2, y: 0.8, z: 3 }} // desk table surface 0.8m above floor
          userAltitude={3.5}
          floorHeightMeters={3.5}
          verticalThresholdMeters={1.5}
        />
      );

      // Target elevation: 3.5 + 0.8 = 4.3m, user is at 3.5m, diff is 0.8m (<= 1.5m)
      expect(screen.queryByTestId("vertical-floor-guidance-badge")).not.toBeInTheDocument();
      expect(screen.getByTestId("seat-direction-pointer")).toBeInTheDocument();
    });

    it("renders guidance badge when target position offset Y exceeds threshold", () => {
      render(
        <SeatARPointer
          targetSeatNumber="DESK-MEZZANINE-OFFSET"
          targetFloor={2}
          targetPosition={{ x: 0, y: 2.5, z: 0 }} // mezzanine platform
          userAltitude={3.5}
          floorHeightMeters={3.5}
          verticalThresholdMeters={1.5}
        />
      );

      // Target elevation: 3.5 + 2.5 = 6.0m, diff is 2.5m (> 1.5m)
      expect(screen.getByTestId("vertical-floor-guidance-badge")).toBeInTheDocument();
    });

    it("handles extreme barometric pressure spikes safely", () => {
      render(
        <SeatARPointer
          targetSeatNumber="DESK-PRESSURE-SPIKE"
          targetFloor={1}
          currentPressureHpa={1200} // extreme high pressure
          baselinePressureHpa={1013.25}
          floorHeightMeters={3.5}
        />
      );

      expect(screen.getByTestId("seat-ar-pointer-container")).toBeInTheDocument();
    });

    it("handles extreme barometric pressure drops safely", () => {
      render(
        <SeatARPointer
          targetSeatNumber="DESK-PRESSURE-DROP"
          targetFloor={10}
          currentPressureHpa={800} // high altitude
          baselinePressureHpa={1013.25}
          floorHeightMeters={3.5}
        />
      );

      expect(screen.getByTestId("seat-ar-pointer-container")).toBeInTheDocument();
    });

    it("renders consistently across rapid prop updates", () => {
      const { rerender } = render(
        <SeatARPointer
          targetSeatNumber="RAPID-TEST"
          targetFloor={2}
          userAltitude={0}
          floorHeightMeters={3.5}
        />
      );

      expect(screen.getByTestId("vertical-floor-guidance-badge")).toBeInTheDocument();

      rerender(
        <SeatARPointer
          targetSeatNumber="RAPID-TEST"
          targetFloor={2}
          userAltitude={3.5}
          floorHeightMeters={3.5}
        />
      );

      expect(screen.queryByTestId("vertical-floor-guidance-badge")).not.toBeInTheDocument();
      expect(screen.getByTestId("seat-direction-pointer")).toBeInTheDocument();
    });
  });
});
