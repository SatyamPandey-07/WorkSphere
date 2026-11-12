import React from "react";
import { render } from "@testing-library/react";
import { WebVitalsReporter } from "@/components/analytics/WebVitalsReporter";
import { clearStoredWebVitals } from "@/lib/webVitalsCollector";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(() => "/venues"),
}));

describe("WebVitalsReporter Component", () => {
  let createdObservers: {
    type: string;
    callback: (entryList: { getEntries: () => any[] }) => void;
    disconnect: jest.Mock;
  }[] = [];

  let mockSendBeacon: jest.Mock;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    clearStoredWebVitals();
    createdObservers = [];

    // Mock PerformanceObserver
    (window as any).PerformanceObserver = class MockPerformanceObserver {
      callback: (entryList: { getEntries: () => any[] }) => void;
      disconnect = jest.fn();

      constructor(callback: (entryList: { getEntries: () => any[] }) => void) {
        this.callback = callback;
      }

      observe(options: { type: string; buffered?: boolean }) {
        createdObservers.push({
          type: options.type,
          callback: this.callback,
          disconnect: this.disconnect,
        });
      }
    };

    mockSendBeacon = jest.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: mockSendBeacon,
      writable: true,
      configurable: true,
    });

    mockFetch = jest.fn(() => Promise.resolve({ ok: true }));
    global.fetch = mockFetch as any;

    // Mock navigation timing on performance
    (performance as any).getEntriesByType = jest.fn((type: string) => {
      if (type === "navigation") {
        return [{ responseStart: 210 } as any];
      }
      return [];
    });
  });

  afterEach(() => {
    delete (window as any).PerformanceObserver;
    delete (performance as any).getEntriesByType;
    jest.restoreAllMocks();
  });

  it("renders null and registers observers for LCP, CLS, FCP, and INP on mount", () => {
    const { container } = render(<WebVitalsReporter />);
    expect(container.firstChild).toBeNull();

    const observedTypes = createdObservers.map((o) => o.type);
    expect(observedTypes).toContain("largest-contentful-paint");
    expect(observedTypes).toContain("layout-shift");
    expect(observedTypes).toContain("paint");
    expect(observedTypes).toContain("event");
  });

  it("reports TTFB from navigation performance entries", () => {
    const onMetricReported = jest.fn();
    render(<WebVitalsReporter onMetricReported={onMetricReported} />);

    expect(onMetricReported).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "TTFB",
        value: 210,
        route: "/venues",
      }),
    );
  });

  it("reports LCP metrics from largest-contentful-paint observer", () => {
    const onMetricReported = jest.fn();
    render(<WebVitalsReporter onMetricReported={onMetricReported} />);

    const lcpObserver = createdObservers.find((o) => o.type === "largest-contentful-paint");
    expect(lcpObserver).toBeDefined();

    lcpObserver?.callback({
      getEntries: () => [
        { startTime: 1200 },
        { startTime: 1850 },
      ],
    });

    expect(onMetricReported).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "LCP",
        value: 1850,
        rating: "good",
      }),
    );
  });

  it("accumulates and reports CLS scores, ignoring entries with hadRecentInput", () => {
    const onMetricReported = jest.fn();
    render(<WebVitalsReporter onMetricReported={onMetricReported} />);

    const clsObserver = createdObservers.find((o) => o.type === "layout-shift");
    expect(clsObserver).toBeDefined();

    // First batch: 0.05 shift, and one with recent input (should be ignored)
    clsObserver?.callback({
      getEntries: () => [
        { value: 0.05, hadRecentInput: false },
        { value: 0.12, hadRecentInput: true },
      ],
    });

    expect(onMetricReported).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "CLS",
        value: 0.05,
      }),
    );

    // Second batch: additional 0.03 shift
    clsObserver?.callback({
      getEntries: () => [{ value: 0.03, hadRecentInput: false }],
    });

    expect(onMetricReported).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "CLS",
        value: 0.08,
      }),
    );
  });

  it("reports FCP metrics from paint observer", () => {
    const onMetricReported = jest.fn();
    render(<WebVitalsReporter onMetricReported={onMetricReported} />);

    const paintObserver = createdObservers.find((o) => o.type === "paint");
    expect(paintObserver).toBeDefined();

    paintObserver?.callback({
      getEntries: () => [
        { name: "first-paint", startTime: 400 },
        { name: "first-contentful-paint", startTime: 850 },
      ],
    });

    expect(onMetricReported).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "FCP",
        value: 850,
        rating: "good",
      }),
    );
  });

  it("reports INP metrics from event interaction observer", () => {
    const onMetricReported = jest.fn();
    render(<WebVitalsReporter onMetricReported={onMetricReported} />);

    const inpObserver = createdObservers.find((o) => o.type === "event");
    expect(inpObserver).toBeDefined();

    inpObserver?.callback({
      getEntries: () => [
        { duration: 42 },
        { duration: 120 },
      ],
    });

    expect(onMetricReported).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "INP",
        value: 120,
        rating: "good",
      }),
    );
  });

  it("sends payload using navigator.sendBeacon with application/json Blob", () => {
    render(<WebVitalsReporter endpoint="/api/telemetry/vitals" />);

    expect(mockSendBeacon).toHaveBeenCalledWith(
      "/api/telemetry/vitals",
      expect.any(Blob),
    );
  });

  it("falls back to fetch with keepalive when sendBeacon is unavailable", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<WebVitalsReporter endpoint="/api/fallback/vitals" />);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/fallback/vitals",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }),
    );
  });

  it("disconnects all observers when component unmounts", () => {
    const { unmount } = render(<WebVitalsReporter />);
    expect(createdObservers.length).toBeGreaterThanOrEqual(4);

    unmount();

    for (const observer of createdObservers) {
      expect(observer.disconnect).toHaveBeenCalled();
    }
  });

  it("skips registering observers when enabled is false", () => {
    render(<WebVitalsReporter enabled={false} />);
    expect(createdObservers.length).toBe(0);
  });

  it("discards negative or non-finite metric values safely", () => {
    const onMetricReported = jest.fn();
    render(<WebVitalsReporter onMetricReported={onMetricReported} />);

    const lcpObserver = createdObservers.find((o) => o.type === "largest-contentful-paint");
    onMetricReported.mockClear();

    lcpObserver?.callback({
      getEntries: () => [{ startTime: NaN }, { startTime: -500 }],
    });

    expect(onMetricReported).not.toHaveBeenCalled();
  });
});
