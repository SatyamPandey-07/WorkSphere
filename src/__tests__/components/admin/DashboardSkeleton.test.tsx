import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DashboardSkeleton } from "@/components/admin/DashboardSkeleton";

describe("DashboardSkeleton Component (#6929)", () => {
  it("renders with default props and accessibility attributes", () => {
    render(<DashboardSkeleton />);

    const root = screen.getByTestId("admin-dashboard-skeleton");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("role", "status");
    expect(root).toHaveAttribute("aria-busy", "true");
    expect(root).toHaveAttribute("aria-label", "Loading admin dashboard");

    expect(screen.getByTestId("admin-skeleton-header")).toBeInTheDocument();
    expect(screen.getByTestId("admin-skeleton-title")).toBeInTheDocument();
    expect(screen.getByTestId("admin-skeleton-actions")).toBeInTheDocument();

    const cards = screen.getAllByTestId("admin-skeleton-card");
    expect(cards).toHaveLength(4);

    const charts = screen.getAllByTestId("admin-skeleton-chart");
    expect(charts).toHaveLength(2);

    expect(screen.getByTestId("admin-skeleton-table")).toBeInTheDocument();
  });

  it("renders custom number of stat cards", () => {
    render(<DashboardSkeleton cardCount={6} />);

    const cards = screen.getAllByTestId("admin-skeleton-card");
    expect(cards).toHaveLength(6);
  });

  it("renders custom number of chart placeholders", () => {
    render(<DashboardSkeleton chartCount={3} />);

    const charts = screen.getAllByTestId("admin-skeleton-chart");
    expect(charts).toHaveLength(3);
  });

  it("hides action button skeletons when showActions is false", () => {
    render(<DashboardSkeleton showActions={false} />);

    expect(screen.queryByTestId("admin-skeleton-actions")).not.toBeInTheDocument();
  });

  it("handles 0 cards and 0 charts safely", () => {
    render(<DashboardSkeleton cardCount={0} chartCount={0} />);

    expect(screen.queryByTestId("admin-skeleton-cards")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-skeleton-charts")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-skeleton-table")).toBeInTheDocument();
  });

  it("applies custom className and testId", () => {
    render(
      <DashboardSkeleton
        className="custom-admin-skeleton"
        testId="custom-skeleton-id"
      />
    );

    const root = screen.getByTestId("custom-skeleton-id");
    expect(root).toHaveClass("custom-admin-skeleton");
  });
});
