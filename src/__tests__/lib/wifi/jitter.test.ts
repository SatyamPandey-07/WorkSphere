import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  calculateJitterMs,
  classifyJitterTier,
  computeSmoothedJitter,
  summarizePingTelemetry,
} from "@/lib/wifi/jitter";
import { VenueWifiStats } from "@/components/venues/VenueWifiStats";

describe("jitter calculation and WiFi stability gauge", () => {
  it("returns 0ms jitter for empty, single-sample, or flat ping arrays", () => {
    expect(calculateJitterMs([])).toBe(0);
    expect(calculateJitterMs([24])).toBe(0);
    expect(calculateJitterMs([18, 18, 18, 18])).toBe(0);
  });

  it("captures spike outliers accurately across consecutive ping samples", () => {
    const jitter = calculateJitterMs([18, 20, 140, 19, 21]);
    expect(jitter).toBe(61.3);
    expect(classifyJitterTier(jitter).tier).toBe("poor");
  });

  it("classifies <15ms as excellent, 15-45ms as fair, and >45ms as poor", () => {
    expect(summarizePingTelemetry([12, 16, 14, 18]).tier).toBe("excellent");
    expect(summarizePingTelemetry([20, 42, 18, 45]).tier).toBe("fair");
  });

  it("renders stability badge and toggles informative tooltip on VenueWifiStats", () => {
    render(
      React.createElement(VenueWifiStats, {
        downloadMbps: 220,
        uploadMbps: 180,
        ssid: "WorkSphere_5G",
        pingSamplesMs: [14, 16, 15, 17, 15],
      }),
    );

    expect(screen.getByTestId("wifi-stability-badge").textContent).toBe(
      "Excellent for Video Calls",
    );
    expect(screen.queryByTestId("jitter-tooltip-popover")).toBeNull();

    fireEvent.click(screen.getByTestId("jitter-tooltip-trigger"));
    expect(screen.getByTestId("jitter-tooltip-popover")).toBeTruthy();
  });

  describe("computeSmoothedJitter (#10004)", () => {
    it("returns 0 for empty or single element array", () => {
      expect(computeSmoothedJitter([])).toBe(0);
      expect(computeSmoothedJitter([50])).toBe(0);
    });

    it("smoothes volatile ping series using exponential moving average", () => {
      const volatilePings = [20, 45, 18, 50, 22, 48, 19, 52];
      const rawJitter = calculateJitterMs(volatilePings);
      const smoothedJitter = computeSmoothedJitter(volatilePings, {
        alpha: 0.2,
      });

      expect(rawJitter).toBe(28.6);
      expect(smoothedJitter).toBe(28.4);
    });

    it("filters out 3-sigma extreme outlier ping spikes", () => {
      // 10 steady pings around 20ms, with one massive 1200ms synthetic spike
      const pingsWithSpike = [20, 21, 19, 22, 20, 1200, 20, 21, 19, 20];
      const rawJitter = calculateJitterMs(pingsWithSpike);
      const smoothedJitterClamped = computeSmoothedJitter(pingsWithSpike, {
        alpha: 0.2,
        outlierSigmaMultiplier: 2.0,
        clampOutliers: true,
      });

      // Raw jitter is heavily skewed by the 1200ms spike (~262ms)
      expect(rawJitter).toBeGreaterThan(200);
      // Smoothed jitter dampens and clamps the outlier significantly
      expect(smoothedJitterClamped).toBeLessThan(rawJitter);
    });

    it("summarizePingTelemetry exposes both raw and smoothed jitter values", () => {
      const summary = summarizePingTelemetry([25, 30, 28, 35, 27]);
      expect(summary.jitterMs).toBeDefined();
      expect(summary.smoothedJitterMs).toBeDefined();
      expect(summary.sampleCount).toBe(5);
    });
  });
});
