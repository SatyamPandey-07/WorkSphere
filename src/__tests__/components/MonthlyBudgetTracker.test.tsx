import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MonthlyBudgetTracker,
  getBudgetProgressColor,
} from "@/components/billing/MonthlyBudgetTracker";
import type { BudgetSummary } from "@/lib/billing/budgetService";

describe("MonthlyBudgetTracker Component & Progress Bar", () => {
  const createMockSummary = (
    overrides: Partial<BudgetSummary> = {},
  ): BudgetSummary => ({
    month: "2026-10",
    monthlyLimit: 1000,
    totalSpent: 450,
    remainingBudget: 550,
    utilizationPercentage: 45,
    projectedMonthEndSpend: 920,
    burnRatePerDay: 30,
    isNearLimit: false,
    isOverLimit: false,
    departments: [
      {
        id: "d1",
        name: "Engineering",
        allocatedAmount: 600,
        spentAmount: 300,
        color: "#3b82f6",
      },
    ],
    recentExpenses: [
      {
        id: "e1",
        venueName: "WeWork Downtown",
        category: "Desk Pass",
        department: "Engineering",
        amount: 50,
        date: "2026-10-10",
      },
    ],
    ...overrides,
  });

  describe("Percentage Threshold Color Function", () => {
    it("returns emerald gradient when utilization is under 70%", () => {
      const colorInfo = getBudgetProgressColor(50);
      expect(colorInfo.threshold).toBe("emerald");
      expect(colorInfo.gradientClass).toContain("emerald");
    });

    it("returns amber gradient when utilization is between 70% and 90%", () => {
      const color70 = getBudgetProgressColor(70);
      expect(color70.threshold).toBe("amber");
      expect(color70.gradientClass).toContain("amber");

      const color85 = getBudgetProgressColor(85);
      expect(color85.threshold).toBe("amber");
      expect(color85.gradientClass).toContain("amber");

      const color90 = getBudgetProgressColor(90);
      expect(color90.threshold).toBe("amber");
      expect(color90.gradientClass).toContain("amber");
    });

    it("returns rose gradient when utilization is greater than 90%", () => {
      const color91 = getBudgetProgressColor(91);
      expect(color91.threshold).toBe("rose");
      expect(color91.gradientClass).toContain("rose");

      const color110 = getBudgetProgressColor(110);
      expect(color110.threshold).toBe("rose");
      expect(color110.gradientClass).toContain("rose");
    });
  });

  describe("Acceptance Criteria 1: Accessible progress bar with role and aria attributes", () => {
    it("renders horizontal progressbar with role, aria-valuenow, and value bounds", () => {
      const summary = createMockSummary({
        totalSpent: 450,
        monthlyLimit: 1000,
        utilizationPercentage: 45,
      });

      render(<MonthlyBudgetTracker initialSummary={summary} />);

      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toBeInTheDocument();
      expect(progressbar).toHaveAttribute("aria-valuenow", "45");
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "100");
      expect(progressbar).toHaveAttribute(
        "aria-valuetext",
        "45% of monthly budget spent",
      );
    });
  });

  describe("Acceptance Criteria 2: Dynamic color gradient based on percentage thresholds", () => {
    it("displays emerald gradient when utilization is under 70%", () => {
      const summary = createMockSummary({
        totalSpent: 650,
        monthlyLimit: 1000,
        utilizationPercentage: 65,
      });

      render(<MonthlyBudgetTracker initialSummary={summary} />);

      const progressbar = screen.getByRole("progressbar");
      const fillBar = progressbar.firstElementChild;
      expect(fillBar?.className).toContain("emerald");
      expect(screen.getByTestId("budget-percentage")).toHaveTextContent(
        "65% used",
      );
    });

    it("displays amber gradient when utilization is between 70% and 90%", () => {
      const summary = createMockSummary({
        totalSpent: 800,
        monthlyLimit: 1000,
        utilizationPercentage: 80,
      });

      render(<MonthlyBudgetTracker initialSummary={summary} />);

      const progressbar = screen.getByRole("progressbar");
      const fillBar = progressbar.firstElementChild;
      expect(fillBar?.className).toContain("amber");
      expect(screen.getByTestId("budget-percentage")).toHaveTextContent(
        "80% used",
      );
    });

    it("displays rose gradient when utilization exceeds 90%", () => {
      const summary = createMockSummary({
        totalSpent: 950,
        monthlyLimit: 1000,
        utilizationPercentage: 95,
      });

      render(<MonthlyBudgetTracker initialSummary={summary} />);

      const progressbar = screen.getByRole("progressbar");
      const fillBar = progressbar.firstElementChild;
      expect(fillBar?.className).toContain("rose");
      expect(screen.getByTestId("budget-percentage")).toHaveTextContent(
        "95% used",
      );
    });
  });

  describe("Acceptance Criteria 3: Display remaining allowance amount and projected end-of-month spend", () => {
    it("displays remaining allowance and projected end-of-month spend clearly", () => {
      const summary = createMockSummary({
        totalSpent: 400,
        monthlyLimit: 1000,
        remainingBudget: 600,
        projectedMonthEndSpend: 850,
        burnRatePerDay: 28,
      });

      render(<MonthlyBudgetTracker initialSummary={summary} />);

      expect(screen.getByText("Remaining Allowance")).toBeInTheDocument();
      expect(screen.getByTestId("remaining-allowance")).toHaveTextContent(
        "$600",
      );

      expect(
        screen.getByText("Projected End-of-Month Spend:"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("projected-month-end-spend")).toHaveTextContent(
        "$850",
      );
    });
  });

  describe("API Fetch loading fallback", () => {
    it("fetches budget from /api/budget when no initialSummary is provided", async () => {
      const summary = createMockSummary({
        totalSpent: 300,
        remainingBudget: 700,
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, summary }),
      } as any);

      await act(async () => {
        render(<MonthlyBudgetTracker />);
      });

      expect(global.fetch).toHaveBeenCalledWith("/api/budget");
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.getByTestId("remaining-allowance")).toHaveTextContent(
        "$700",
      );
    });
  });
});
