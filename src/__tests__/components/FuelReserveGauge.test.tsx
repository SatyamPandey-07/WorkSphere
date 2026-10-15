import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FuelReserveGauge,
  calculateFuelEndurance,
  BINGO_FUEL_THRESHOLD,
  MAX_JP8_CAPACITY_LBS,
  BASE_BURN_RATE_LBS_PER_HOUR,
} from "@/components/wellness/FuelReserveGauge";

describe("FuelReserveGauge JP-8 Endurance Monitor (#6308)", () => {
  describe("Burn Rate & Fuel Endurance Calculation", () => {
    it("calculates 100% fuel reserve at operational start", () => {
      const res = calculateFuelEndurance({
        minutesWorked: 0,
        minutesSinceHydration: 0,
        batteryLevel: 1.0,
      });

      expect(res.totalFuelPercent).toBe(100);
      expect(res.totalFuelLbs).toBe(MAX_JP8_CAPACITY_LBS);
      expect(res.isBingoFuel).toBe(false);
      expect(res.burnRateLbsPerHour).toBe(BASE_BURN_RATE_LBS_PER_HOUR);
    });

    it("accelerates burn rate as focus work and dehydration duration increase", () => {
      const initial = calculateFuelEndurance({
        minutesWorked: 0,
        minutesSinceHydration: 0,
      });

      const fatigued = calculateFuelEndurance({
        minutesWorked: 180,
        minutesSinceHydration: 90,
      });

      // Burn rate must accelerate under extended focus & dehydration
      expect(fatigued.burnRateLbsPerHour).toBeGreaterThan(initial.burnRateLbsPerHour);
      expect(fatigued.totalFuelPercent).toBeLessThan(initial.totalFuelPercent);
    });

    it("triggers isBingoFuel when fuel reserve drops below or equal to 15%", () => {
      // 4 hours work (50% drain) + 3 hours no water (45% drain) = 5% remaining
      const critical = calculateFuelEndurance({
        minutesWorked: 240,
        minutesSinceHydration: 180,
      });

      expect(critical.totalFuelPercent).toBeLessThanOrEqual(BINGO_FUEL_THRESHOLD);
      expect(critical.isBingoFuel).toBe(true);
    });

    it("factors in critical laptop battery level into endurance depletion", () => {
      const healthyBattery = calculateFuelEndurance({
        minutesWorked: 60,
        minutesSinceHydration: 30,
        batteryLevel: 0.9,
      });

      const lowBattery = calculateFuelEndurance({
        minutesWorked: 60,
        minutesSinceHydration: 30,
        batteryLevel: 0.05,
      });

      expect(lowBattery.totalFuelPercent).toBeLessThan(healthyBattery.totalFuelPercent);
    });
  });

  describe("Component Rendering & Twin Tapes", () => {
    it("renders twin analog vertical fuel tapes and fuel quantity readout", () => {
      render(
        <FuelReserveGauge
          minutesWorked={30}
          minutesSinceHydration={15}
          batteryLevel={0.9}
        />
      );

      expect(screen.getByTestId("fuel-tape-left")).toBeInTheDocument();
      expect(screen.getByTestId("fuel-tape-right")).toBeInTheDocument();
      expect(screen.getByTestId("total-fuel-readout")).toBeInTheDocument();
      expect(screen.queryByTestId("bingo-fuel-alert")).not.toBeInTheDocument();
    });

    it("displays blinking BINGO FUEL caution alert when reserve drops under 15%", () => {
      render(
        <FuelReserveGauge
          minutesWorked={240}
          minutesSinceHydration={180}
          enableAudioAlert={false}
        />
      );

      const alert = screen.getByTestId("bingo-fuel-alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(/BINGO FUEL \/\/ RETURN TO BASE/);
    });

    it("triggers refuel action callbacks on button clicks", () => {
      const handleHydrate = jest.fn();
      const handleBreak = jest.fn();

      render(
        <FuelReserveGauge
          onHydrateRefuel={handleHydrate}
          onBreakRefuel={handleBreak}
        />
      );

      fireEvent.click(screen.getByTestId("refuel-water-btn"));
      expect(handleHydrate).toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("refuel-break-btn"));
      expect(handleBreak).toHaveBeenCalled();
    });
  });
});
