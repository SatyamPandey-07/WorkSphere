import { describe, it, expect, beforeEach } from "vitest";
import {
  NoiseAggregator,
  calculateMedian,
  calculateMAD,
  getNoiseCategory,
} from "@/lib/telemetry/noiseAggregator";

describe("NoiseAggregator: Hampel Outlier Rejection & Exponential Decay Smoothing (#3472)", () => {
  let aggregator: NoiseAggregator;

  beforeEach(() => {
    aggregator = new NoiseAggregator({
      windowSize: 10,
      kScaleFactor: 3.0,
      alpha: 0.15,
    });
  });

  describe("Mathematical Utilities: Median & MAD", () => {
    it("computes median accurately for odd and even length arrays", () => {
      expect(calculateMedian([1, 2, 3, 4, 5])).toBe(3);
      expect(calculateMedian([5, 1, 3, 2, 4])).toBe(3);
      expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
      expect(calculateMedian([])).toBe(0);
      expect(calculateMedian([45])).toBe(45);
    });

    it("computes Median Absolute Deviation (MAD) accurately", () => {
      // Data: [1, 2, 3, 4, 5], median = 3
      // Deviations from 3: [|1-3|=2, |2-3|=1, |3-3|=0, |4-3|=1, |5-3|=2] -> [0, 1, 1, 2, 2]
      // Median of deviations = 1
      expect(calculateMAD([1, 2, 3, 4, 5])).toBe(1);
    });

    it("handles identical constant values in MAD calculation without zero division", () => {
      expect(calculateMAD([45, 45, 45, 45, 45])).toBe(0);
    });

    it("categorizes acoustic levels accurately into quiet, moderate, and loud", () => {
      expect(getNoiseCategory(42)).toBe("quiet");
      expect(getNoiseCategory(49.9)).toBe("quiet");
      expect(getNoiseCategory(50.0)).toBe("moderate");
      expect(getNoiseCategory(65)).toBe("moderate");
      expect(getNoiseCategory(69.9)).toBe("moderate");
      expect(getNoiseCategory(70.0)).toBe("loud");
      expect(getNoiseCategory(95)).toBe("loud");
    });
  });

  describe("Hampel Filter: Synthetic Spike Rejection", () => {
    it("rejects synthetic 90 dB impulse spikes in 45 dB ambient quiet rooms", () => {
      const now = Date.now();

      // Establish steady 45 dB ambient baseline across 8 samples
      for (let i = 0; i < 8; i++) {
        const result = aggregator.processSample({
          decibel: 45 + (i % 2 === 0 ? 0.5 : -0.5),
          timestamp: now + i * 1000,
        });
        expect(result.isOutlier).toBe(false);
        expect(result.noiseCategory).toBe("quiet");
      }

      // Simulate physical artifact: dropping phone or mic cough (90 dB spike)
      const spikeResult = aggregator.processSample({
        decibel: 90.0,
        timestamp: now + 9000,
      });

      expect(spikeResult.isOutlier).toBe(true);
      // Filtered reading should fall back to median (~45 dB), not 90 dB
      expect(spikeResult.filteredDecibel).toBeCloseTo(45, 0);
      // EMA should remain in quiet category despite 90 dB impulse
      expect(spikeResult.noiseCategory).toBe("quiet");
      expect(spikeResult.emaDecibel).toBeLessThan(50);
    });

    it("logs rejected spikes into telemetry quality metric store", () => {
      const now = Date.now();

      for (let i = 0; i < 6; i++) {
        aggregator.processSample({
          decibel: 44 + (i % 2),
          timestamp: now + i * 1000,
        });
      }

      aggregator.processSample(
        { decibel: 95.0, timestamp: now + 7000 },
        "venue-quiet-hub",
      );

      const logs = aggregator.getOutlierLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].venueId).toBe("venue-quiet-hub");
      expect(logs[0].rawDecibel).toBe(95.0);
      expect(logs[0].reason).toContain("Hampel outlier rejection");
    });

    it("rejects multiple momentary spikes without corrupting sliding window", () => {
      const now = Date.now();

      // 40 dB baseline
      for (let i = 0; i < 6; i++) {
        aggregator.processSample({ decibel: 40, timestamp: now + i * 1000 });
      }

      // First spike (phone dropped)
      const s1 = aggregator.processSample({ decibel: 88, timestamp: now + 7000 });
      expect(s1.isOutlier).toBe(true);

      // Normal sample
      const n1 = aggregator.processSample({ decibel: 41, timestamp: now + 8000 });
      expect(n1.isOutlier).toBe(false);

      // Second spike (loud clap / cough)
      const s2 = aggregator.processSample({ decibel: 92, timestamp: now + 9000 });
      expect(s2.isOutlier).toBe(true);

      expect(aggregator.getOutlierLogs()).toHaveLength(2);
    });
  });

  describe("Exponential Moving Average (EMA, α=0.15) Tracking", () => {
    it("smoothly tracks sustained acoustic transitions from quiet (45 dB) to loud (75 dB)", () => {
      const now = Date.now();

      // 10 samples at 45 dB (quiet)
      for (let i = 0; i < 10; i++) {
        aggregator.processSample({ decibel: 45, timestamp: now + i * 1000 });
      }

      // Sustained transition: venue starts an event, noise jumps and stays at 75 dB
      let finalResult = null;
      for (let i = 10; i < 30; i++) {
        finalResult = aggregator.processSample({
          decibel: 75,
          timestamp: now + i * 1000,
        });
      }

      // After 20 sustained samples, EMA should have transitioned toward 75 dB
      expect(finalResult).not.toBeNull();
      expect(finalResult!.emaDecibel).toBeGreaterThan(70);
      expect(finalResult!.noiseCategory).toBe("loud");
    });

    it("applies exponential weighting formula α*sample + (1-α)*ema accurately", () => {
      const customAggregator = new NoiseAggregator({
        alpha: 0.15,
        windowSize: 5,
      });

      // Sample 1: initial 50
      const r1 = customAggregator.processSample({ decibel: 50, timestamp: 1 });
      expect(r1.emaDecibel).toBe(50);

      // Sample 2: 60 -> EMA = 0.15 * 60 + 0.85 * 50 = 9 + 42.5 = 51.5
      const r2 = customAggregator.processSample({ decibel: 60, timestamp: 2 });
      expect(r2.emaDecibel).toBeCloseTo(51.5, 1);
    });

    it("resets internal aggregator state cleanly", () => {
      aggregator.processSample({ decibel: 50, timestamp: 1 });
      aggregator.processSample({ decibel: 90, timestamp: 2 });
      expect(aggregator.getOutlierLogs().length).toBeGreaterThanOrEqual(0);

      aggregator.reset();
      expect(aggregator.getOutlierLogs()).toHaveLength(0);

      const fresh = aggregator.processSample({ decibel: 42, timestamp: 3 });
      expect(fresh.emaDecibel).toBe(42);
    });
  });

  describe("Faulty Microphone Sensor Input Validation (#5032)", () => {
    it("discards negative decibel readings (dB < 0) from uncalibrated mic hardware", () => {
      const now = Date.now();

      // Seed with valid baseline samples
      aggregator.processSample({ decibel: 45, timestamp: now });
      aggregator.processSample({ decibel: 46, timestamp: now + 1000 });

      // Process faulty negative reading (-25 dB)
      const res = aggregator.processSample(
        { decibel: -25, timestamp: now + 2000 },
        "sensor-mic-01",
      );

      expect(res.isOutlier).toBe(true);
      expect(res.rawDecibel).toBe(-25);
      expect(res.emaDecibel).toBeGreaterThanOrEqual(0);

      const logs = aggregator.getOutlierLogs();
      expect(logs.some((l) => l.rawDecibel === -25 && l.reason.includes("negative"))).toBe(true);
    });

    it("discards non-finite values (NaN, Infinity) without corrupting rolling average", () => {
      const now = Date.now();

      aggregator.processSample({ decibel: 50, timestamp: now });
      aggregator.processSample({ decibel: 52, timestamp: now + 1000 });

      const nanRes = aggregator.processSample({ decibel: NaN, timestamp: now + 2000 });
      expect(nanRes.isOutlier).toBe(true);

      const infRes = aggregator.processSample({ decibel: Infinity, timestamp: now + 3000 });
      expect(infRes.isOutlier).toBe(true);

      const nextValid = aggregator.processSample({ decibel: 51, timestamp: now + 4000 });
      expect(nextValid.isOutlier).toBe(false);
      expect(nextValid.emaDecibel).toBeCloseTo(51, 0);
    });
  });
});
