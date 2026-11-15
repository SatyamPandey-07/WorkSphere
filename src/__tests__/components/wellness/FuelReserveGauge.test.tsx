import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import FuelReserveGaugeDefault, {
  FuelReserveGauge,
  calculateFuelEndurance,
  BINGO_FUEL_THRESHOLD,
  MAX_JP8_CAPACITY_LBS,
  BASE_BURN_RATE_LBS_PER_HOUR,
} from "@/components/wellness/FuelReserveGauge";

jest.mock("@/hooks/useBatteryStatus", () => ({
  useBatteryStatus: () => ({
    level: 0.85,
    charging: false,
    chargingTime: 0,
    dischargingTime: Infinity,
  }),
}));

describe("FuelReserveGauge Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Exports & Constants", () => {
    it("exports FuelReserveGauge as named and default export", () => {
      expect(FuelReserveGauge).toBeDefined();
      expect(FuelReserveGaugeDefault).toBeDefined();
      expect(FuelReserveGauge).toBe(FuelReserveGaugeDefault);
    });

    it("exports calculation constants", () => {
      expect(BINGO_FUEL_THRESHOLD).toBe(15);
      expect(MAX_JP8_CAPACITY_LBS).toBe(8000);
      expect(BASE_BURN_RATE_LBS_PER_HOUR).toBe(1200);
    });
  });

  describe("calculateFuelEndurance Utility", () => {
    it("calculates full endurance for a fresh session", () => {
      const res = calculateFuelEndurance({
        minutesWorked: 0,
        minutesSinceHydration: 0,
        batteryLevel: 0.9,
      });

      expect(res.totalFuelPercent).toBe(100);
      expect(res.totalFuelLbs).toBe(MAX_JP8_CAPACITY_LBS);
      expect(res.isBingoFuel).toBe(false);
      expect(res.burnRateLbsPerHour).toBe(BASE_BURN_RATE_LBS_PER_HOUR);
    });

    it("triggers isBingoFuel when fatigue and hydration drain fuel below 15%", () => {
      const res = calculateFuelEndurance({
        minutesWorked: 400,
        minutesSinceHydration: 240,
        batteryLevel: 0.1,
      });

      expect(res.totalFuelPercent).toBeLessThanOrEqual(BINGO_FUEL_THRESHOLD);
      expect(res.isBingoFuel).toBe(true);
    });

    it("applies low battery penalty when battery is under 20%", () => {
      const fullBattery = calculateFuelEndurance({
        minutesWorked: 60,
        minutesSinceHydration: 30,
        batteryLevel: 0.8,
      });

      const lowBattery = calculateFuelEndurance({
        minutesWorked: 60,
        minutesSinceHydration: 30,
        batteryLevel: 0.05,
      });

      expect(lowBattery.totalFuelPercent).toBeLessThan(fullBattery.totalFuelPercent);
    });
  });

  describe("Default Rendering", () => {
    it("renders gauge container, header and telemetry readout", () => {
      render(
        <FuelReserveGauge
          minutesWorked={30}
          minutesSinceHydration={15}
        />,
      );

      const root = screen.getByTestId("fuel-reserve-gauge");
      expect(root).toBeInTheDocument();
      expect(screen.getByText("JP-8 FUEL QTY")).toBeInTheDocument();
      expect(screen.getByText(/LBS\/HR/)).toBeInTheDocument();
      expect(screen.getByTestId("fuel-tape-left")).toBeInTheDocument();
      expect(screen.getByTestId("fuel-tape-right")).toBeInTheDocument();
      expect(screen.getByTestId("total-fuel-readout")).toBeInTheDocument();
      expect(screen.getByText("EST TIME ON STATION")).toBeInTheDocument();
    });

    it("does not render bingo fuel alert in healthy state", () => {
      render(
        <FuelReserveGauge
          minutesWorked={10}
          minutesSinceHydration={5}
        />,
      );

      expect(screen.queryByTestId("bingo-fuel-alert")).not.toBeInTheDocument();
    });
  });

  describe("Bingo Fuel Alert", () => {
    it("renders bingo fuel alert banner when fuel is critical", () => {
      render(
        <FuelReserveGauge
          minutesWorked={360}
          minutesSinceHydration={200}
          enableAudioAlert={false}
        />,
      );

      const alert = screen.getByTestId("bingo-fuel-alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("BINGO FUEL // RETURN TO BASE");
    });
  });

  describe("Refuel Actions", () => {
    it("calls onHydrateRefuel when Hydrate button is clicked", () => {
      const onHydrateRefuel = jest.fn();
      render(
        <FuelReserveGauge
          minutesWorked={60}
          minutesSinceHydration={45}
          onHydrateRefuel={onHydrateRefuel}
        />,
      );

      const hydrateBtn = screen.getByTestId("refuel-water-btn");
      fireEvent.click(hydrateBtn);

      expect(onHydrateRefuel).toHaveBeenCalledTimes(1);
    });

    it("calls onBreakRefuel when Refuel RTB button is clicked", () => {
      const onBreakRefuel = jest.fn();
      render(
        <FuelReserveGauge
          minutesWorked={120}
          minutesSinceHydration={60}
          onBreakRefuel={onBreakRefuel}
        />,
      );

      const breakBtn = screen.getByTestId("refuel-break-btn");
      fireEvent.click(breakBtn);

      expect(onBreakRefuel).toHaveBeenCalledTimes(1);
    });
  });

  describe("Custom Props & Overrides", () => {
    it("supports custom data-testid and className overrides", () => {
      render(
        <FuelReserveGauge
          data-testid="custom-fuel-gauge"
          className="my-avionics-gauge"
        />,
      );

      const root = screen.getByTestId("custom-fuel-gauge");
      expect(root).toBeInTheDocument();
      expect(root).toHaveClass("my-avionics-gauge");
      expect(root).toHaveClass("rounded-2xl");
    });
  });
});
