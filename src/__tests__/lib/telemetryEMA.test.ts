import {
  calculateEMA,
  isOutlier3Sigma,
  computeMeanAndStdDev,
  TelemetrySmoother,
  useSmoothTelemetry,
} from "@/lib/telemetry";
import { getSpeedTier } from "@/components/telemetry/WifiWidget";
import { renderHook, act } from "@testing-library/react";

describe("Telemetry EMA Smoothing and 3-Sigma Outlier Filtering (#3436)", () => {
  describe("Mathematical helpers", () => {
    it("computes mean and standard deviation correctly", () => {
      const data = [10, 20, 30, 40, 50];
      const { mean, stdDev } = computeMeanAndStdDev(data);

      expect(mean).toBe(30);
      // Population std dev for [10, 20, 30, 40, 50] is sqrt(200) approx 14.142
      expect(stdDev).toBeCloseTo(14.142, 2);
    });

    it("handles empty and single-element arrays in computeMeanAndStdDev", () => {
      expect(computeMeanAndStdDev([])).toEqual({ mean: 0, stdDev: 0 });
      expect(computeMeanAndStdDev([42])).toEqual({ mean: 42, stdDev: 0 });
    });

    it("initializes EMA directly with the first sample (prevEMA = null)", () => {
      const firstSample = 45.5;
      const smoothed = calculateEMA(firstSample, null, 0.25);
      expect(smoothed).toBe(firstSample);
    });

    it("clamps alpha to [0.1, 0.4]", () => {
      // Clamped to 0.1
      const emaLow = calculateEMA(100, 50, 0.01);
      expect(emaLow).toBe(0.1 * 100 + 0.9 * 50); // 55

      // Clamped to 0.4
      const emaHigh = calculateEMA(100, 50, 0.99);
      expect(emaHigh).toBe(0.4 * 100 + 0.6 * 50); // 70

      // Default alpha = 0.25
      const emaDefault = calculateEMA(100, 50, 0.25);
      expect(emaDefault).toBe(0.25 * 100 + 0.75 * 50); // 62.5
    });

    it("converges toward continuous constant input", () => {
      let currentEMA: number | null = 10;
      const target = 100;
      const alpha = 0.25;

      for (let i = 0; i < 20; i++) {
        currentEMA = calculateEMA(target, currentEMA, alpha);
      }

      // After 20 steps, (1 - 0.25)^20 < 0.003, should be within 0.5 of target
      expect(Math.abs(currentEMA - target)).toBeLessThan(0.5);
    });
  });

  describe("3-Sigma Outlier Filtering", () => {
    const normalHistory = [50, 51, 49, 52, 48, 50, 51, 49, 50, 52];

    it("does not flag values within 3 standard deviations", () => {
      // 53 is within 3 sigma of ~50
      expect(isOutlier3Sigma(53, normalHistory)).toBe(false);
      expect(isOutlier3Sigma(47, normalHistory)).toBe(false);
    });

    it("flags extreme ping spikes exceeding 3 standard deviations", () => {
      // 500 Mbps spike on a 50 Mbps network
      expect(isOutlier3Sigma(500, normalHistory)).toBe(true);
      // Negative drop / near-zero dropped packet spike
      expect(isOutlier3Sigma(5, normalHistory)).toBe(true);
    });

    it("requires at least 3 historical readings to evaluate outliers", () => {
      expect(isOutlier3Sigma(500, [50, 51])).toBe(false);
    });
  });

  describe("TelemetrySmoother class", () => {
    it("smooths stream of readings and discards outliers without polluting history", () => {
      const smoother = new TelemetrySmoother({ alpha: 0.25, windowSize: 10 });

      // Feed initial baseline readings around 60 Mbps
      for (const val of [60, 61, 59, 62, 58, 60, 61, 59]) {
        const res = smoother.update(val);
        expect(res.isOutlier).toBe(false);
      }

      const prevSmoothed = smoother.getSmoothed();
      expect(prevSmoothed).toBeGreaterThan(58);
      expect(prevSmoothed).toBeLessThan(62);

      // Feed corrupted ping spike: 900 Mbps
      const outlierRes = smoother.update(900);
      expect(outlierRes.isOutlier).toBe(true);
      // Smoothed value remains unchanged
      expect(outlierRes.smoothed).toBe(prevSmoothed);
      // History does NOT contain the outlier
      expect(smoother.getHistory()).not.toContain(900);

      // Normal reading resumes smoothing
      const normalRes = smoother.update(60);
      expect(normalRes.isOutlier).toBe(false);
    });

    it("handles zero values and resets cleanly", () => {
      const smoother = new TelemetrySmoother();
      smoother.update(0);
      expect(smoother.getSmoothed()).toBe(0);

      smoother.update(100);
      expect(smoother.getSmoothed()).toBeGreaterThan(0);

      smoother.reset();
      expect(smoother.getSmoothed()).toBe(0);
      expect(smoother.getHistory()).toEqual([]);
    });
  });

  describe("useSmoothTelemetry React hook", () => {
    it("initializes with raw speed and updates smoothly", () => {
      const { result, rerender } = renderHook(
        ({ speed }) => useSmoothTelemetry(speed),
        { initialProps: { speed: 80 } },
      );

      expect(result.current.smoothedSpeed).toBe(80);
      expect(result.current.isOutlier).toBe(false);

      // Update speed
      rerender({ speed: 100 });
      expect(result.current.smoothedSpeed).toBeCloseTo(85, 1);
    });

    it("flags outlier and preserves smoothed metric on spike", () => {
      const { result, rerender } = renderHook(
        ({ speed }) => useSmoothTelemetry(speed),
        { initialProps: { speed: 50 } },
      );

      // Build baseline
      for (const s of [51, 49, 50, 52, 48]) {
        rerender({ speed: s });
      }

      const stableSmoothed = result.current.smoothedSpeed;

      // Spike to 500
      rerender({ speed: 500 });
      expect(result.current.isOutlier).toBe(true);
      expect(result.current.smoothedSpeed).toBe(stableSmoothed);
    });
  });

  describe("Speed tier categorization", () => {
    it("correctly assigns speed tiers", () => {
      expect(getSpeedTier(150).tier).toBe("Ultra Fast");
      expect(getSpeedTier(50).tier).toBe("High Speed");
      expect(getSpeedTier(20).tier).toBe("Moderate");
      expect(getSpeedTier(5).tier).toBe("Basic");
    });
  });
});
