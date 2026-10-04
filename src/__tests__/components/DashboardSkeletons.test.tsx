import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MetricCardSkeleton,
  ChartSkeleton,
} from "@/components/analytics/DashboardSkeletons";
import AnalyticsDashboard from "@/app/analytics/AnalyticsDashboard";

// The receipt modal pulls in a hook that ships as untransformed ESM; the
// dashboard only needs the loading branch here, so it is stubbed out.
jest.mock("@/components/receipt/ReceiptVerificationModal", () => ({
  ReceiptVerificationModal: () => null,
}));

describe("DashboardSkeletons", () => {
  it("builds a metric card placeholder from shimmer blocks", () => {
    const { container } = render(<MetricCardSkeleton />);
    expect(container.querySelectorAll(".ws-skeleton")).toHaveLength(3);
  });

  it("builds a chart placeholder with a configurable body height", () => {
    const { container } = render(<ChartSkeleton height="h-4" />);
    expect(container.querySelectorAll(".ws-skeleton").length).toBeGreaterThan(
      0,
    );
    expect(container.querySelector(".ws-skeleton.h-4")).not.toBeNull();
  });
});

describe("AnalyticsDashboard loading state", () => {
  beforeEach(() => {
    // Keep the initial fetch pending so the component stays in its loading
    // branch for the duration of the assertion.
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  });

  it("renders shimmer placeholders before the telemetry request resolves", () => {
    const { container } = render(<AnalyticsDashboard />);
    expect(container.querySelectorAll(".ws-skeleton").length).toBeGreaterThan(
      0,
    );
  });
});
