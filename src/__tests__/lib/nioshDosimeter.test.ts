import {
  calculateNioshAllowableHours,
  calculateNioshAllowableMinutes,
  calculateNioshAllowableSeconds,
  calculateNioshDose,
  calculateNioshDoseFromSeconds,
  calculateCumulativeNioshDose,
  getDoseStatus,
  recordNoiseExposure,
  getDailyNoiseExposure,
  resetDailyNoiseExposure,
  pruneOldExposureRecords,
  DOSE_WARNING_THRESHOLD,
  DOSE_DANGER_THRESHOLD,
  NIOSH_CRITERION_DB,
  NIOSH_EXCHANGE_RATE,
} from "@/lib/noise/dosimeter";

describe("NIOSH Daily Noise Dosimetry Engine", () => {
  describe("NIOSH Reference Tables & Standard Constants", () => {
    test("uses standard 85 dBA criterion level and 3 dB exchange rate", () => {
      expect(NIOSH_CRITERION_DB).toBe(85);
      expect(NIOSH_EXCHANGE_RATE).toBe(3);
    });

    test("computes exact allowable durations across standard NIOSH sound levels", () => {
      // 82 dBA -> 16 hours
      expect(calculateNioshAllowableHours(82)).toBeCloseTo(16.0, 2);
      expect(calculateNioshAllowableMinutes(82)).toBeCloseTo(960, 1);

      // 85 dBA -> 8 hours (Criterion Level)
      expect(calculateNioshAllowableHours(85)).toBeCloseTo(8.0, 2);
      expect(calculateNioshAllowableMinutes(85)).toBeCloseTo(480, 1);
      expect(calculateNioshAllowableSeconds(85)).toBe(28800);

      // 88 dBA -> 4 hours (3 dB exchange rate halving)
      expect(calculateNioshAllowableHours(88)).toBeCloseTo(4.0, 2);
      expect(calculateNioshAllowableMinutes(88)).toBeCloseTo(240, 1);

      // 91 dBA -> 2 hours
      expect(calculateNioshAllowableHours(91)).toBeCloseTo(2.0, 2);
      expect(calculateNioshAllowableMinutes(91)).toBeCloseTo(120, 1);

      // 94 dBA -> 1 hour
      expect(calculateNioshAllowableHours(94)).toBeCloseTo(1.0, 2);
      expect(calculateNioshAllowableMinutes(94)).toBeCloseTo(60, 1);

      // 97 dBA -> 30 minutes (0.5 hours)
      expect(calculateNioshAllowableHours(97)).toBeCloseTo(0.5, 2);
      expect(calculateNioshAllowableMinutes(97)).toBeCloseTo(30, 1);

      // 100 dBA -> 15 minutes (0.25 hours)
      expect(calculateNioshAllowableHours(100)).toBeCloseTo(0.25, 2);
      expect(calculateNioshAllowableMinutes(100)).toBeCloseTo(15, 1);
    });
  });

  describe("calculateNioshDose (Single Exposure Evaluation)", () => {
    test("calculates exactly 100% dose for 85 dBA across 8 hours", () => {
      const result = calculateNioshDose(85, 480);
      expect(result.dosePercentage).toBe(100.0);
      expect(result.exposureHours).toBe(8.0);
      expect(result.allowableHours).toBe(8.0);
      expect(result.twa).toBe(85.0);
      expect(result.status).toBe("danger");
      expect(result.isExceeded).toBe(true);
      expect(result.isWarning).toBe(false);
    });

    test("evaluates 3 dB exchange rate dose doubling", () => {
      // 4 hours at 88 dBA = 100% dose
      const res88 = calculateNioshDose(88, 240);
      expect(res88.dosePercentage).toBe(100.0);
      expect(res88.isExceeded).toBe(true);

      // 2 hours at 91 dBA = 100% dose
      const res91 = calculateNioshDose(91, 120);
      expect(res91.dosePercentage).toBe(100.0);
      expect(res91.isExceeded).toBe(true);
    });

    test("evaluates safe low dose under quiet working conditions", () => {
      // 55 dBA for 8 hours in library (quiet cafe)
      const res = calculateNioshDose(55, 480);
      expect(res.dosePercentage).toBeLessThan(0.15);
      expect(res.status).toBe("safe");
      expect(res.isExceeded).toBe(false);
      expect(res.isWarning).toBe(false);
    });

    test("handles zero duration and non-finite numbers gracefully", () => {
      const res = calculateNioshDose(85, 0);
      expect(res.dosePercentage).toBe(0.0);
      expect(res.exposureHours).toBe(0.0);
      expect(res.status).toBe("safe");
      expect(res.isExceeded).toBe(false);
    });
  });

  describe("Dose Threshold Status Classification", () => {
    test("classifies doses below 80% as safe", () => {
      expect(getDoseStatus(0)).toBe("safe");
      expect(getDoseStatus(50)).toBe("safe");
      expect(getDoseStatus(79.9)).toBe("safe");
    });

    test("classifies doses between 80% and 99.9% as warning", () => {
      expect(getDoseStatus(DOSE_WARNING_THRESHOLD)).toBe("warning");
      expect(getDoseStatus(85.0)).toBe("warning");
      expect(getDoseStatus(99.9)).toBe("warning");
    });

    test("classifies doses at or above 100% as danger", () => {
      expect(getDoseStatus(DOSE_DANGER_THRESHOLD)).toBe("danger");
      expect(getDoseStatus(105.5)).toBe("danger");
      expect(getDoseStatus(250.0)).toBe("danger");
    });
  });

  describe("calculateCumulativeNioshDose (Multi-Segment Dosimetry)", () => {
    test("accumulates multiple partial exposure segments according to D = 100 * sum(C_i / T_i)", () => {
      // 4 hours at 85 dBA (50% dose) + 2 hours at 88 dBA (50% dose) = 100% total dose
      const segments = [
        { decibels: 85, durationSeconds: 4 * 3600 },
        { decibels: 88, durationSeconds: 2 * 3600 },
      ];

      const cumulative = calculateCumulativeNioshDose(segments);
      expect(cumulative.dosePercentage).toBe(100.0);
      expect(cumulative.totalExposureHours).toBe(6.0);
      expect(cumulative.isExceeded).toBe(true);
      expect(cumulative.status).toBe("danger");
    });

    test("correctly calculates warning threshold for cumulative exposure", () => {
      // 7 hours at 85 dBA = 87.5% dose (Warning status)
      const segments = [{ decibels: 85, durationSeconds: 7 * 3600 }];
      const summary = calculateCumulativeNioshDose(segments);

      expect(summary.dosePercentage).toBeCloseTo(87.5, 1);
      expect(summary.status).toBe("warning");
      expect(summary.isWarning).toBe(true);
      expect(summary.isExceeded).toBe(false);
    });

    test("correctly computes Leq for varying acoustic segments", () => {
      // Equal duration at 70 dB and 80 dB
      const segments = [
        { decibels: 70, durationSeconds: 1800 },
        { decibels: 80, durationSeconds: 1800 },
      ];
      const summary = calculateCumulativeNioshDose(segments);

      // Leq = 10 * log10( (10^7 + 10^8) / 2 ) ≈ 77.4 dB
      expect(summary.leq).toBeCloseTo(77.4, 1);
    });
  });

  describe("Rolling 24-Hour Daily Noise Exposure Storage", () => {
    beforeEach(async () => {
      await resetDailyNoiseExposure();
    });

    test("records exposure readings and retrieves cumulative summary", async () => {
      const now = 1700000000000;
      await recordNoiseExposure(85, 3600, now); // 1 hour at 85 dB = 12.5% dose

      const summary = await getDailyNoiseExposure(now);
      expect(summary.dosePercentage).toBeCloseTo(12.5, 1);
      expect(summary.totalExposureSeconds).toBe(3600);
      expect(summary.sampleCount).toBe(1);
    });

    test("prunes records older than 24 hours (rolling window reset)", async () => {
      const now = 1700000000000;
      const twentyFiveHoursAgo = now - 25 * 3600 * 1000;
      const twoHoursAgo = now - 2 * 3600 * 1000;

      // Add old record (expired) and recent record
      await recordNoiseExposure(85, 4 * 3600, twentyFiveHoursAgo);
      await recordNoiseExposure(85, 2 * 3600, twoHoursAgo);

      await pruneOldExposureRecords(now - 24 * 3600 * 1000);
      const summary = await getDailyNoiseExposure(now);

      // Only the 2-hour record should be included (25% dose, not 75%)
      expect(summary.dosePercentage).toBeCloseTo(25.0, 1);
      expect(summary.totalExposureSeconds).toBe(2 * 3600);
    });

    test("resetDailyNoiseExposure clears all stored data", async () => {
      await recordNoiseExposure(90, 1800);
      let summary = await getDailyNoiseExposure();
      expect(summary.dosePercentage).toBeGreaterThan(0);

      await resetDailyNoiseExposure();
      summary = await getDailyNoiseExposure();
      expect(summary.dosePercentage).toBe(0);
      expect(summary.totalExposureSeconds).toBe(0);
    });
  });
});
