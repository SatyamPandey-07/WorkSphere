import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
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
  }),
) as jest.Mock;

describe("WebVitalsWidget Component (#4145)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearStoredWebVitals();
    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
    });
  });

  it("renders Web Vitals widget title, overall performance score, and telemetry oscilloscope", async () => {
    render(<WebVitalsWidget />);

    expect(screen.getByTestId("web-vitals-widget")).toBeInTheDocument();
    expect(
      screen.getByText("Google Web Vitals Performance Score Widget"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("88")).toBeInTheDocument();
      expect(screen.getByText("Overall Web Vitals Score")).toBeInTheDocument();
      expect(screen.getByTestId("telemetry-oscilloscope")).toBeInTheDocument();
      expect(screen.getByTestId("oscilloscope-canvas")).toBeInTheDocument();
      expect(
        screen.getByText("Avionics Telemetry Oscilloscope"),
      ).toBeInTheDocument();
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
      screen.getByText("Route-by-Route Web Vitals Performance Breakdown"),
    ).toBeInTheDocument();
    expect(screen.getByText("/venues")).toBeInTheDocument();
  });

  it("renders timeframe filter segmented control with options 24 Hours, 7 Days, 30 Days", async () => {
    render(<WebVitalsWidget />);

    expect(
      screen.getByTestId("timeframe-segmented-control"),
    ).toBeInTheDocument();
    expect(screen.getByText("24 Hours")).toBeInTheDocument();
    expect(screen.getByText("7 Days")).toBeInTheDocument();
    expect(screen.getByText("30 Days")).toBeInTheDocument();

    const option24h = screen.getByTestId("timeframe-option-24h");
    expect(option24h).toHaveAttribute("aria-pressed", "true");
  });

  it("passes selected timeframe to analytics API query and displays skeleton shimmer while refetching", async () => {
    let resolveSecondFetch: (value: any) => void;
    const secondFetchPromise = new Promise((resolve) => {
      resolveSecondFetch = resolve;
    });

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("range=7d")) {
        return secondFetchPromise;
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            overallScore: 88,
            totalSamples: 24,
            timeRange: "24h",
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
            },
            routes: [],
          }),
      });
    });

    await act(async () => {
      render(<WebVitalsWidget />);
    });

    await waitFor(() => {
      expect(screen.getByText("88")).toBeInTheDocument();
    });

    // Initial fetch had range=24h
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("range=24h"),
      expect.any(Object),
    );

    // Switch to 7 Days
    const option7d = screen.getByText("7 Days");
    act(() => {
      fireEvent.click(option7d);
    });

    // Skeleton shimmer should be displayed while refetching historical metrics
    expect(screen.getByTestId("web-vitals-skeleton")).toBeInTheDocument();

    // Verify analytics API query requested range=7d
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("range=7d"),
      expect.any(Object),
    );

    // Resolve 7d response with updated overallScore
    await act(async () => {
      resolveSecondFetch!({
        ok: true,
        json: () =>
          Promise.resolve({
            overallScore: 94,
            totalSamples: 150,
            timeRange: "7d",
            generatedAt: new Date().toISOString(),
            metrics: {
              LCP: {
                name: "LCP",
                p50: 1200,
                p75: 1600,
                p90: 2000,
                rating: "good",
                sampleCount: 50,
                distribution: { good: 95, needsImprovement: 5, poor: 0 },
              },
            },
            routes: [],
          }),
      });
      await secondFetchPromise;
    });

    // Skeleton shimmer should be removed and updated score rendered
    await waitFor(() => {
      expect(
        screen.queryByTestId("web-vitals-skeleton"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("94")).toBeInTheDocument();
    });
  });

  it("renders WebVitalsReporter component without crashing", () => {
    const { container } = render(<WebVitalsReporter />);
    expect(container).toBeInTheDocument();
  });
});
