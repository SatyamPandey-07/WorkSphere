import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { WebVitalsWidget } from "@/components/admin/WebVitalsWidget";
import { WebVitalsReporter } from "@/components/analytics/WebVitalsReporter";
import { clearStoredWebVitals } from "@/lib/webVitalsCollector";

// Mock fetch globally
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        overallScore: 88,
        totalSamples: 24,
        timeRange: "7d",
        generatedAt: new Date().toISOString(),
        metrics: {
          LCP: {
            name: "LCP",
            p50: 1400,
            p75: 1900,
            p90: 2400,
            rating: "good",
            sampleCount: 10,
            distribution: { good: 90, needsImprovement: 10, poor: 0 },
          },
          INP: {
            name: "INP",
            p50: 60,
            p75: 120,
            p90: 180,
            rating: "good",
            sampleCount: 8,
            distribution: { good: 100, needsImprovement: 0, poor: 0 },
          },
          CLS: {
            name: "CLS",
            p50: 0.02,
            p75: 0.05,
            p90: 0.09,
            rating: "good",
            sampleCount: 6,
            distribution: { good: 100, needsImprovement: 0, poor: 0 },
          },
          FCP: {
            name: "FCP",
            p50: 900,
            p75: 1200,
            p90: 1500,
            rating: "good",
            sampleCount: 6,
            distribution: { good: 100, needsImprovement: 0, poor: 0 },
          },
          TTFB: {
            name: "TTFB",
            p50: 250,
            p75: 400,
            p90: 550,
            rating: "good",
            sampleCount: 6,
            distribution: { good: 100, needsImprovement: 0, poor: 0 },
          },
        },
        routes: [
          {
            route: "/",
            sampleCount: 12,
            score: 92,
            metrics: {
              LCP: { p75: 1800, rating: "good" },
              INP: { p75: 110, rating: "good" },
              CLS: { p75: 0.03, rating: "good" },
            },
          },
          {
            route: "/venues",
            sampleCount: 8,
            score: 84,
            metrics: {
              LCP: { p75: 2200, rating: "good" },
              INP: { p75: 150, rating: "good" },
              CLS: { p75: 0.06, rating: "good" },
            },
          },
        ],
      }),
  })
) as jest.Mock;

describe("WebVitalsWidget Component (#4145)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearStoredWebVitals();
  });

  it("renders Web Vitals widget title and overall performance score", async () => {
    render(<WebVitalsWidget />);

    expect(screen.getByTestId("web-vitals-widget")).toBeInTheDocument();
    expect(
      screen.getByText("Google Web Vitals Performance Score Widget")
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("88")).toBeInTheDocument();
      expect(screen.getByText("Overall Web Vitals Score")).toBeInTheDocument();
    });
  });

  it("renders metric cards for LCP, INP, CLS, FCP, TTFB", async () => {
    render(<WebVitalsWidget />);

    await waitFor(() => {
      expect(screen.getByTestId("vital-card-LCP")).toBeInTheDocument();
      expect(screen.getByTestId("vital-card-INP")).toBeInTheDocument();
      expect(screen.getByTestId("vital-card-CLS")).toBeInTheDocument();
    });
  });

  it("switches tabs between Status Gauges and Route Distributions", async () => {
    render(<WebVitalsWidget />);

    await waitFor(() => {
      expect(screen.getByText("Status Gauges")).toBeInTheDocument();
    });

    const routeTab = screen.getByText("Route Distributions");
    fireEvent.click(routeTab);

    expect(
      screen.getByText("Route-by-Route Web Vitals Performance Breakdown")
    ).toBeInTheDocument();
    expect(screen.getByText("/venues")).toBeInTheDocument();
  });

  it("renders WebVitalsReporter component without crashing", () => {
    const { container } = render(<WebVitalsReporter />);
    expect(container).toBeInTheDocument();
  });
});
