import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  LanternPowerRing,
  getWillpowerStatus,
} from "@/components/analytics/LanternPowerRing";
import * as batteryHook from "@/hooks/useBatteryStatus";

jest.mock("@/hooks/useBatteryStatus");

describe("LanternPowerRing - Willpower Battery Charge Meter (#6182)", () => {
  const mockBatteryStatus = (
    overrides: Partial<batteryHook.BatteryState> = {},
  ) => {
    (batteryHook.useBatteryStatus as jest.Mock).mockReturnValue({
      level: 0.8,
      charging: false,
      dischargingTime: 3600,
      isLow: false,
      isPanic: false,
      isSupported: true,
      ...overrides,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBatteryStatus();
  });

  describe("getWillpowerStatus helper", () => {
    it("returns correct tier and description for all charge ranges", () => {
      expect(getWillpowerStatus(0).tier).toBe("DORMANT");
      expect(getWillpowerStatus(10).tier).toBe("SPARK");
      expect(getWillpowerStatus(25).tier).toBe("CADET");
      expect(getWillpowerStatus(40).tier).toBe("GUARDIAN");
      expect(getWillpowerStatus(55).tier).toBe("VETERAN");
      expect(getWillpowerStatus(70).tier).toBe("HONOR_GUARD");
      expect(getWillpowerStatus(80).tier).toBe("VANGUARD");
      expect(getWillpowerStatus(90).tier).toBe("MASTER");
      expect(getWillpowerStatus(95).tier).toBe("SENTINEL");
      expect(getWillpowerStatus(100).tier).toBe("ION");
    });
  });

  describe("Acceptance Criteria 1: Dynamic SVG stroke-dashoffset", () => {
    const RADIUS = 38;
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~238.761

    it("renders circular SVG power ring meter with correct circumference and offset at 0%", () => {
      render(<LanternPowerRing chargePercent={0} />);

      const circle = screen.getByTestId("lantern-ring-circle");
      expect(circle).toBeInTheDocument();
      expect(circle).toHaveAttribute("r", "38");
      expect(Number(circle.getAttribute("stroke-dasharray"))).toBeCloseTo(
        CIRCUMFERENCE,
        1,
      );

      // At 0% charge, stroke-dashoffset equals the full circumference
      const offset = Number(circle.getAttribute("stroke-dashoffset"));
      expect(offset).toBeCloseTo(CIRCUMFERENCE, 1);
    });

    it("renders stroke-dashoffset at 0 when fully charged (100%)", () => {
      render(<LanternPowerRing chargePercent={100} />);

      const circle = screen.getByTestId("lantern-ring-circle");
      const offset = Number(circle.getAttribute("stroke-dashoffset"));
      expect(offset).toBeCloseTo(0, 1);
    });

    it("renders stroke-dashoffset at half circumference for 50% charge", () => {
      render(<LanternPowerRing chargePercent={50} />);

      const circle = screen.getByTestId("lantern-ring-circle");
      const offset = Number(circle.getAttribute("stroke-dashoffset"));
      expect(offset).toBeCloseTo(CIRCUMFERENCE / 2, 1);
    });

    it("clamps negative values to 0% and values above 100 to 100%", () => {
      const { rerender } = render(<LanternPowerRing chargePercent={-15} />);
      let circle = screen.getByTestId("lantern-ring-circle");
      expect(Number(circle.getAttribute("stroke-dashoffset"))).toBeCloseTo(
        CIRCUMFERENCE,
        1,
      );

      rerender(<LanternPowerRing chargePercent={150} />);
      circle = screen.getByTestId("lantern-ring-circle");
      expect(Number(circle.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 1);
    });
  });

  describe("Acceptance Criteria 2: Animated glow pulse when plugged into power / charging", () => {
    it("applies .animate-ring-pulse and renders charging pulse badge when isCharging is true", () => {
      render(<LanternPowerRing chargePercent={75} isCharging={true} />);

      const ringContainer = screen.getByTestId("lantern-power-ring");
      expect(ringContainer).toHaveClass("animate-ring-pulse");
      expect(ringContainer).toHaveAttribute("data-charging", "true");

      const pulseBadge = screen.getByTestId("lantern-ring-charging-pulse");
      expect(pulseBadge).toBeInTheDocument();
    });

    it("does not apply .animate-ring-pulse or pulse badge when isCharging is false", () => {
      render(<LanternPowerRing chargePercent={75} isCharging={false} />);

      const ringContainer = screen.getByTestId("lantern-power-ring");
      expect(ringContainer).not.toHaveClass("animate-ring-pulse");
      expect(ringContainer).toHaveAttribute("data-charging", "false");
      expect(
        screen.queryByTestId("lantern-ring-charging-pulse"),
      ).not.toBeInTheDocument();
    });

    it("triggers .animate-ring-flash upon reaching 100% full charge", () => {
      render(<LanternPowerRing chargePercent={100} />);

      const ringContainer = screen.getByTestId("lantern-power-ring");
      expect(ringContainer).toHaveClass("animate-ring-flash");
      expect(ringContainer).toHaveAttribute("data-ring-flash", "true");
    });
  });

  describe("Acceptance Criteria 3: Tooltip detailing charge percentage and willpower status", () => {
    it("provides accessible tooltip with exact charge percentage and willpower status", () => {
      render(<LanternPowerRing chargePercent={88} isCharging={false} />);

      expect(screen.getByTestId("lantern-ring-tooltip")).toBeInTheDocument();

      const chargeText = screen.getByTestId("lantern-ring-charge-text");
      expect(chargeText).toHaveTextContent("88%");

      const statusLabel = screen.getByTestId("lantern-ring-status-label");
      expect(statusLabel).toHaveTextContent("Willpower Master");

      const powerStatus = screen.getByTestId("lantern-ring-power-status");
      expect(powerStatus).toHaveTextContent("Discharging · Nomad Battery");
    });

    it("displays charging message in tooltip when plugged into power", () => {
      render(<LanternPowerRing chargePercent={45} isCharging={true} />);

      const powerStatus = screen.getByTestId("lantern-ring-power-status");
      expect(powerStatus).toHaveTextContent("Charging · Energy Influx");
    });

    it("supports custom statusLabel override in tooltip", () => {
      render(
        <LanternPowerRing
          chargePercent={60}
          statusLabel="Daily Quest Completed"
        />,
      );

      const statusLabel = screen.getByTestId("lantern-ring-status-label");
      expect(statusLabel).toHaveTextContent("Daily Quest Completed");
    });

    it("hides tooltip when showTooltip is false", () => {
      render(<LanternPowerRing chargePercent={50} showTooltip={false} />);

      expect(
        screen.queryByTestId("lantern-ring-tooltip"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Device Battery Fallback Integration", () => {
    it("automatically derives charge and charging state from useBatteryStatus when props omitted", () => {
      mockBatteryStatus({ level: 0.64, charging: true });

      render(<LanternPowerRing />);

      const ringContainer = screen.getByTestId("lantern-power-ring");
      expect(ringContainer).toHaveAttribute("aria-valuenow", "64");
      expect(ringContainer).toHaveClass("animate-ring-pulse");
      expect(screen.getByTestId("lantern-ring-charge-text")).toHaveTextContent(
        "64%",
      );
      expect(screen.getByTestId("lantern-ring-status-label")).toHaveTextContent(
        "Emerald Veteran",
      );
    });
  });

  describe("Sizing, Interaction & Accessibility", () => {
    it("supports size variants and custom numeric pixels", () => {
      const { rerender } = render(<LanternPowerRing size="sm" />);
      let ring = screen.getByTestId("lantern-power-ring");
      expect(ring).toHaveStyle({ width: "28px", height: "28px" });

      rerender(<LanternPowerRing size="lg" />);
      ring = screen.getByTestId("lantern-power-ring");
      expect(ring).toHaveStyle({ width: "48px", height: "48px" });

      rerender(<LanternPowerRing size={52} />);
      ring = screen.getByTestId("lantern-power-ring");
      expect(ring).toHaveStyle({ width: "52px", height: "52px" });
    });

    it("has progressbar accessibility role and triggers onClick callback", () => {
      const handleClick = jest.fn();
      render(<LanternPowerRing chargePercent={90} onClick={handleClick} />);

      const ring = screen.getByRole("progressbar");
      expect(ring).toHaveAttribute("aria-valuenow", "90");
      expect(ring).toHaveAttribute("aria-valuemin", "0");
      expect(ring).toHaveAttribute("aria-valuemax", "100");
      expect(ring).toHaveAttribute(
        "aria-label",
        "Lantern Power Ring: 90% - Willpower Master",
      );

      fireEvent.click(ring);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });
});
