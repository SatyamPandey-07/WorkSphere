import {
  calculateMedian,
  calculateMAD,
  calculateModifiedZScore,
  calculateStandardDeviation,
  TelemetryAnomalyDetector,
  VenueTelemetryAnomalyManager,
  globalAnomalyManager,
} from "@/lib/telemetryAnomalyDetector";

describe("telemetryAnomalyDetector", () => {
  describe("Mathematical Helpers", () => {
    describe("calculateMedian", () => {
      it("returns 0 for empty array", () => {
        expect(calculateMedian([])).toBe(0);
      });

      it("returns element for single-element array", () => {
        expect(calculateMedian([42])).toBe(42);
      });

      it("calculates median for odd-length array", () => {
        expect(calculateMedian([3, 1, 9, 7, 5])).toBe(5);
      });

      it("calculates median for even-length array", () => {
        expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
      });
    });

    describe("calculateMAD", () => {
      it("returns 0 for arrays with length <= 1", () => {
        expect(calculateMAD([])).toBe(0);
        expect(calculateMAD([5])).toBe(0);
      });

      it("returns 0 for identical numbers", () => {
        expect(calculateMAD([10, 10, 10, 10])).toBe(0);
      });

      it("calculates Median Absolute Deviation accurately", () => {
        // [1, 2, 3, 4, 5, 6, 7] -> median = 4. Deviations = [3, 2, 1, 0, 1, 2, 3] -> sorted = [0, 1, 1, 2, 2, 3, 3] -> median = 2
        expect(calculateMAD([1, 2, 3, 4, 5, 6, 7])).toBe(2);
      });
    });

    describe("calculateModifiedZScore", () => {
      it("returns 0 when value equals median", () => {
        expect(calculateModifiedZScore(50, 50, 5)).toBe(0);
        expect(calculateModifiedZScore(50, 50, 0)).toBe(0);
      });

      it("returns Infinity when MAD is 0 and value differs from median", () => {
        expect(calculateModifiedZScore(60, 50, 0)).toBe(Infinity);
      });

      it("applies standard Boris Iglewicz Modified Z formula", () => {
        // 0.6745 * |60 - 50| / 2 = 0.6745 * 10 / 2 = 3.3725
        const score = calculateModifiedZScore(60, 50, 2);
        expect(score).toBeCloseTo(3.3725, 3);
      });
    });

    describe("calculateStandardDeviation", () => {
      it("returns 0 for arrays with length <= 1", () => {
        expect(calculateStandardDeviation([])).toBe(0);
        expect(calculateStandardDeviation([100])).toBe(0);
      });

      it("computes sample standard deviation accurately", () => {
        const std = calculateStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9]);
        expect(std).toBeCloseTo(2.138, 2);
      });
    });
  });

  describe("TelemetryAnomalyDetector Core", () => {
    describe("Physical Bounds Checks", () => {
      it("flags noise readings outside physical bounds as sensor_fault", () => {
        const detector = new TelemetryAnomalyDetector("noise_db");

        const lowFault = detector.record(5); // Below 10 dB minimum
        expect(lowFault.isAnomaly).toBe(true);
        expect(lowFault.severity).toBe("sensor_fault");

        const highFault = detector.record(150); // Above 135 dB threshold
        expect(highFault.isAnomaly).toBe(true);
        expect(highFault.severity).toBe("sensor_fault");
      });

      it("flags occupancy percentage < 0 or > 100 as sensor_fault", () => {
        const detector = new TelemetryAnomalyDetector("occupancy_percent");

        expect(detector.record(-5).severity).toBe("sensor_fault");
        expect(detector.record(120).severity).toBe("sensor_fault");
      });

      it("flags NaN and non-finite values as sensor_fault", () => {
        const detector = new TelemetryAnomalyDetector("noise_db");
        expect(detector.record(NaN).severity).toBe("sensor_fault");
        expect(detector.record(Infinity).severity).toBe("sensor_fault");
      });

      it("does not pollute the sliding window with sensor faults", () => {
        const detector = new TelemetryAnomalyDetector("noise_db");
        detector.record(45);
        detector.record(160); // sensor_fault
        detector.record(48);

        expect(detector.getHistory().length).toBe(2);
      });
    });

    describe("Rate of Change (Gradient) Surge Detection", () => {
      it("detects rapid acoustic spikes exceeding maxRateOfChangePerSec", () => {
        const detector = new TelemetryAnomalyDetector("noise_db", {
          maxRateOfChangePerSec: 20,
        });

        const t0 = 1000000;
        detector.record(45, t0);

        // Jump of 30 dB in 0.5 seconds = 60 dB/sec rate of change
        const surge = detector.record(75, t0 + 500);
        expect(surge.isAnomaly).toBe(true);
        expect(surge.severity).toBe("critical_surge");
        expect(surge.rateOfChange).toBe(60);
      });

      it("allows gradual noise drift without triggering rate-of-change alert", () => {
        const detector = new TelemetryAnomalyDetector("noise_db", {
          maxRateOfChangePerSec: 20,
        });

        const t0 = 1000000;
        detector.record(45, t0);
        // 5 dB increase over 2 seconds = 2.5 dB/sec
        const result = detector.record(50, t0 + 2000);
        expect(result.rateOfChange).toBe(2.5);
      });
    });

    describe("Statistical Anomaly Detection (Z-score & EMA)", () => {
      it("returns normal when sample count is less than minSamplesForDetection", () => {
        const detector = new TelemetryAnomalyDetector("noise_db", {
          minSamplesForDetection: 5,
        });

        expect(detector.record(45).severity).toBe("normal");
        expect(detector.record(46).severity).toBe("normal");
        expect(detector.record(47).severity).toBe("normal");
      });

      it("detects mild statistical deviation when Modified Z-score exceeds threshold", () => {
        const detector = new TelemetryAnomalyDetector("generic", {
          minSamplesForDetection: 5,
          modifiedZScoreThreshold: 3.0,
          windowSize: 20,
        });

        // Seed with steady baseline
        for (let i = 0; i < 10; i++) {
          detector.record(50);
        }

        // Test inspect without mutating
        const candidate = detector.inspect(60);
        expect(candidate.isAnomaly).toBe(true);
      });

      it("classifies extreme spikes as critical_surge", () => {
        const detector = new TelemetryAnomalyDetector("wifi_latency_ms", {
          minSamplesForDetection: 5,
          modifiedZScoreThreshold: 3.5,
        });

        // Seed normal WiFi latency around 25-30ms
        const baseline = [25, 26, 28, 27, 26, 25, 27, 26];
        for (const val of baseline) {
          detector.record(val);
        }

        // Massive latency spike to 450ms
        const spike = detector.record(450);
        expect(spike.isAnomaly).toBe(true);
        expect(spike.severity).toBe("critical_surge");
        expect(spike.zScore).toBeGreaterThan(5);
      });
    });

    describe("Sliding Window & Baseline Statistics", () => {
      it("enforces sliding window capacity limit", () => {
        const detector = new TelemetryAnomalyDetector("generic", {
          windowSize: 5,
        });

        for (let i = 1; i <= 8; i++) {
          detector.record(i);
        }

        const history = detector.getHistory();
        expect(history.length).toBe(5);
        expect(history.map((h) => h.value)).toEqual([4, 5, 6, 7, 8]);
      });

      it("provides accurate aggregate baseline statistics", () => {
        const detector = new TelemetryAnomalyDetector("generic");
        const values = [10, 20, 30, 40, 50];
        for (const v of values) {
          detector.record(v);
        }

        const stats = detector.getBaseline();
        expect(stats.sampleCount).toBe(5);
        expect(stats.median).toBe(30);
        expect(stats.mean).toBe(30);
        expect(stats.min).toBe(10);
        expect(stats.max).toBe(50);
        expect(stats.ema).toBeDefined();
      });

      it("resets window and baseline when reset() is called", () => {
        const detector = new TelemetryAnomalyDetector("generic");
        detector.record(10);
        detector.record(20);
        detector.reset();

        const stats = detector.getBaseline();
        expect(stats.sampleCount).toBe(0);
        expect(stats.median).toBeNull();
      });
    });
  });

  describe("VenueTelemetryAnomalyManager", () => {
    let manager: VenueTelemetryAnomalyManager;

    beforeEach(() => {
      manager = new VenueTelemetryAnomalyManager();
    });

    it("partitions detectors by venue and metric type", () => {
      const noiseDet = manager.getDetector("venue_1", "noise_db");
      const occDet = manager.getDetector("venue_1", "occupancy_percent");
      const otherNoiseDet = manager.getDetector("venue_2", "noise_db");

      expect(noiseDet).not.toBe(occDet);
      expect(noiseDet).not.toBe(otherNoiseDet);
      expect(manager.getDetector("venue_1", "noise_db")).toBe(noiseDet);
    });

    it("processes telemetry through venue-specific detector", () => {
      const result = manager.processTelemetry("venue_abc", "noise_db", 48);
      expect(result.value).toBe(48);
      expect(result.isAnomaly).toBe(false);
    });

    it("clears venue detectors cleanly without affecting other venues", () => {
      manager.processTelemetry("v1", "noise_db", 50);
      manager.processTelemetry("v2", "noise_db", 50);

      manager.clearVenue("v1");
      expect(manager.getDetector("v1", "noise_db").getBaseline().sampleCount).toBe(0);
      expect(manager.getDetector("v2", "noise_db").getBaseline().sampleCount).toBe(1);
    });

    it("exports default globalAnomalyManager singleton", () => {
      expect(globalAnomalyManager).toBeInstanceOf(VenueTelemetryAnomalyManager);
    });
  });
});
