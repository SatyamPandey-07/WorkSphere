import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AnalyticsStatsCard } from "@/components/admin/AnalyticsStatsCard";

describe("AnalyticsStatsCard Component (#6927)", () => {
  it("renders title and string value", () => {
    render(<AnalyticsStatsCard title="Total Bookings" value="1,248" />);

    expect(screen.getByTestId("stats-card-title")).toHaveTextContent("Total Bookings");
    expect(screen.getByTestId("stats-card-value")).toHaveTextContent("1,248");
    expect(screen.queryByTestId("stats-card-description")).not.toBeInTheDocument();
  });

  it("renders numerical value and optional description", () => {
    render(
      <AnalyticsStatsCard
        title="Active Users"
        value={450}
        description="Active within the last 24 hours"
      />
    );

    expect(screen.getByTestId("stats-card-value")).toHaveTextContent("450");
    expect(screen.getByTestId("stats-card-description")).toHaveTextContent(
      "Active within the last 24 hours"
    );
  });

  it("renders fallback dash for null, undefined, or NaN values", () => {
    const { rerender } = render(<AnalyticsStatsCard title="Pending" value={null} />);
    expect(screen.getByTestId("stats-card-value")).toHaveTextContent("—");

    rerender(<AnalyticsStatsCard title="Pending" value={undefined} />);
    expect(screen.getByTestId("stats-card-value")).toHaveTextContent("—");

    rerender(<AnalyticsStatsCard title="Pending" value={NaN} />);
    expect(screen.getByTestId("stats-card-value")).toHaveTextContent("—");
  });

  it("renders loading skeleton when loading is true", () => {
    render(
      <AnalyticsStatsCard
        title="Revenue"
        value="$50,000"
        loading={true}
        icon={<span data-testid="test-icon">icon</span>}
      />
    );

    const skeleton = screen.getByTestId("stats-card-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("stats-card-value")).not.toBeInTheDocument();
  });

  it("renders positive trend with TrendingUp icon", () => {
    render(
      <AnalyticsStatsCard
        title="MRR"
        value="$12,000"
        trend={{ value: 15.2, direction: "up", label: "vs last month" }}
      />
    );

    const trend = screen.getByTestId("stats-card-trend");
    expect(trend).toBeInTheDocument();
    expect(trend).toHaveTextContent("+15.2%");
    expect(screen.getByTestId("stats-card-trend-up")).toBeInTheDocument();
    expect(screen.getByTestId("stats-card-trend-label")).toHaveTextContent("vs last month");
    expect(trend).toHaveClass("text-emerald-400");
  });

  it("renders negative trend with TrendingDown icon", () => {
    render(
      <AnalyticsStatsCard
        title="Churn"
        value="4.2%"
        trend={{ value: "-2.1%", direction: "down", label: "vs last quarter" }}
      />
    );

    const trend = screen.getByTestId("stats-card-trend");
    expect(trend).toBeInTheDocument();
    expect(trend).toHaveTextContent("-2.1%");
    expect(screen.getByTestId("stats-card-trend-down")).toBeInTheDocument();
    expect(trend).toHaveClass("text-rose-400");
  });

  it("renders neutral trend with Minus icon", () => {
    render(
      <AnalyticsStatsCard
        title="Server Uptime"
        value="99.9%"
        trend={{ value: "0.0%", direction: "neutral", label: "unchanged" }}
      />
    );

    const trend = screen.getByTestId("stats-card-trend");
    expect(screen.getByTestId("stats-card-trend-neutral")).toBeInTheDocument();
    expect(trend).toHaveClass("text-zinc-400");
  });

  it("renders metric icon when provided", () => {
    render(
      <AnalyticsStatsCard
        title="Avg Rating"
        value="4.8"
        icon={<span data-testid="star-icon">★</span>}
      />
    );

    expect(screen.getByTestId("stats-card-icon")).toBeInTheDocument();
    expect(screen.getByTestId("star-icon")).toBeInTheDocument();
  });

  it("handles click and keyboard interactions when onClick is provided", () => {
    const handleClick = jest.fn();
    render(
      <AnalyticsStatsCard
        title="Drilldown Metric"
        value={100}
        onClick={handleClick}
      />
    );

    const card = screen.getByTestId("analytics-stats-card");
    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("tabindex", "0");

    // Click
    fireEvent.click(card);
    expect(handleClick).toHaveBeenCalledTimes(1);

    // Enter key
    fireEvent.keyDown(card, { key: "Enter" });
    expect(handleClick).toHaveBeenCalledTimes(2);

    // Space key
    fireEvent.keyDown(card, { key: " " });
    expect(handleClick).toHaveBeenCalledTimes(3);
  });

  it("applies custom className and testId", () => {
    render(
      <AnalyticsStatsCard
        title="Custom Card"
        value="99"
        className="custom-border-glow"
        testId="custom-analytics-card"
      />
    );

    const card = screen.getByTestId("custom-analytics-card");
    expect(card).toHaveClass("custom-border-glow");
  });
});
