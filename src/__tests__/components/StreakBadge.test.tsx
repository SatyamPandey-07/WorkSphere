import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  StreakBadge,
  getWillpowerBatteryTier,
} from "@/components/gamification/StreakBadge";

describe("StreakBadge", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        currentStreak: 5,
        longestStreak: 12,
        unlockedMilestones: [3, 5],
      }),
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Default variant", () => {
    it("renders with tabIndex 0, role status, and accessible tooltip role", async () => {
      render(<StreakBadge />);

      await waitFor(() => {
        expect(screen.getByText("5")).toBeInTheDocument();
      });

      const badge = screen.getByRole("status");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("tabindex", "0");
      expect(badge).toHaveAttribute("aria-label", "5-day work streak");

      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveClass("group-focus-within:opacity-100");
    });
  });

  describe("getWillpowerBatteryTier calculation", () => {
    it("calculates 0% charge for 0 or negative days", () => {
      expect(getWillpowerBatteryTier(0)).toEqual({
        tier: 0,
        chargePercentage: 0,
        tierLabel: "Depleted",
        isOverdrive: false,
      });
      expect(getWillpowerBatteryTier(-2).tier).toBe(0);
    });

    it("calculates 25% charge for 1-3 days", () => {
      [1, 2, 3].forEach((streak) => {
        const result = getWillpowerBatteryTier(streak);
        expect(result.tier).toBe(1);
        expect(result.chargePercentage).toBe(25);
        expect(result.isOverdrive).toBe(false);
      });
    });

    it("calculates 50% charge for 4-7 days", () => {
      [4, 5, 7].forEach((streak) => {
        const result = getWillpowerBatteryTier(streak);
        expect(result.tier).toBe(2);
        expect(result.chargePercentage).toBe(50);
        expect(result.isOverdrive).toBe(false);
      });
    });

    it("calculates 75% charge for 8-14 days", () => {
      [8, 10, 14].forEach((streak) => {
        const result = getWillpowerBatteryTier(streak);
        expect(result.tier).toBe(3);
        expect(result.chargePercentage).toBe(75);
        expect(result.isOverdrive).toBe(false);
      });
    });

    it("calculates 100% Emerald Overdrive for 15+ days", () => {
      [15, 20, 100].forEach((streak) => {
        const result = getWillpowerBatteryTier(streak);
        expect(result.tier).toBe(4);
        expect(result.chargePercentage).toBe(100);
        expect(result.tierLabel).toBe("Emerald Overdrive");
        expect(result.isOverdrive).toBe(true);
      });
    });
  });

  describe("Willpower Battery Variant", () => {
    it("renders Green Lantern Power Battery SVG with 4-tiered fill bars and accessible label", async () => {
      render(<StreakBadge variant="willpower-battery" streak={5} longestStreak={10} />);

      const badge = screen.getByRole("status");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute(
        "aria-label",
        "5-day streak, 50% Willpower Battery Charge"
      );

      // Verify SVG battery elements
      expect(screen.getByTestId("willpower-battery-svg")).toBeInTheDocument();
      expect(screen.getByTestId("battery-segment-1")).toBeInTheDocument();
      expect(screen.getByTestId("battery-segment-2")).toBeInTheDocument();
      expect(screen.getByTestId("battery-segment-3")).toBeInTheDocument();
      expect(screen.getByTestId("battery-segment-4")).toBeInTheDocument();
      expect(screen.getByTestId("power-core-center")).toBeInTheDocument();

      // Verify percentage display
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("renders Emerald Overdrive mode with animated pulse and overdrive label for 15+ days", () => {
      render(<StreakBadge variant="willpower-battery" streak={16} longestStreak={20} />);

      const badge = screen.getByRole("status");
      expect(badge).toHaveAttribute(
        "aria-label",
        "16-day streak, 100% Willpower Battery Charge (Emerald Overdrive)"
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.getByText(/Emerald Overdrive/i)).toBeInTheDocument();
    });

    it("renders accessible tooltip with Willpower Energy information", () => {
      render(<StreakBadge variant="willpower-battery" streak={2} longestStreak={7} />);

      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(screen.getByText("Willpower Energy: 25%")).toBeInTheDocument();
      expect(screen.getByText(/Charging \(2 Days Consecutive\)/i)).toBeInTheDocument();
    });
  });
});
