import {
  calculateSitStandRatio,
  evaluatePostureCompliance,
  estimateStandingCaloriesBurned,
  formatDurationHoursMinutes,
  buildDailyPostureRecord,
  computeWeeklyDeskSummary,
  generateSampleWeeklyPostureHistory,
  syncLiveSessionToDailyRecords,
  SIT_STAND_TARGET_PRESETS,
} from "@/lib/wellness/deskPostureAnalytics";

describe("deskPostureAnalytics domain engine", () => {
  describe("calculateSitStandRatio", () => {
    it("returns balanced 50/50 baseline when total seconds is zero", () => {
      const result = calculateSitStandRatio(0, 0);
      expect(result.ratio).toBe(1);
      expect(result.display).toBe("1.0 : 1");
      expect(result.sittingPct).toBe(50);
      expect(result.standingPct).toBe(50);
      expect(result.totalHours).toBe(0);
    });

    it("calculates accurate ratio and percentages for typical workday durations", () => {
      // 4 hours sitting (14400s), 2 hours standing (7200s) -> 2.0 : 1
      const result = calculateSitStandRatio(14400, 7200);
      expect(result.ratio).toBe(2);
      expect(result.display).toBe("2.0 : 1");
      expect(result.sittingPct).toBe(67);
      expect(result.standingPct).toBe(33);
      expect(result.sittingHours).toBe(4);
      expect(result.standingHours).toBe(2);
      expect(result.totalHours).toBe(6);
    });

    it("formats zero standing seconds as minutes-to-zero display", () => {
      const result = calculateSitStandRatio(3600, 0);
      expect(result.ratio).toBe(60);
      expect(result.display).toBe("60m : 0m");
      expect(result.sittingPct).toBe(100);
      expect(result.standingPct).toBe(0);
    });

    it("safely coerces NaN, negative, and non-finite inputs to zero without NaN propagation", () => {
      const nanResult = calculateSitStandRatio(NaN, NaN);
      expect(nanResult.ratio).toBe(1);
      expect(nanResult.display).toBe("1.0 : 1");
      expect(nanResult.sittingPct).toBe(50);
      expect(nanResult.standingPct).toBe(50);

      const negResult = calculateSitStandRatio(-1000, -500);
      expect(negResult.ratio).toBe(1);
      expect(negResult.display).toBe("1.0 : 1");

      const nullResult = calculateSitStandRatio(null as any, undefined as any);
      expect(nullResult.ratio).toBe(1);
      expect(nullResult.display).toBe("1.0 : 1");
    });
  });

  describe("evaluatePostureCompliance", () => {
    it("classifies sessions under 10 minutes as low_activity", () => {
      expect(evaluatePostureCompliance(300, 200)).toBe("low_activity");
      expect(evaluatePostureCompliance(0, 0)).toBe("low_activity");
    });

    it("evaluates optimal and good compliance bands based on target ratio", () => {
      // 40m sitting (2400s) + 20m standing (1200s) = 33% standing -> optimal for 2:1
      expect(evaluatePostureCompliance(2400, 1200, 2.0)).toBe("optimal");

      // 45m sitting (2700s) + 15m standing (900s) = 25% standing -> good for 2:1
      expect(evaluatePostureCompliance(2700, 900, 2.0)).toBe("good");
    });

    it("identifies needs_more_standing when standing ratio is too low", () => {
      // 55m sitting (3300s) + 5m standing (300s) = ~8.3% standing
      expect(evaluatePostureCompliance(3300, 300, 2.0)).toBe("needs_more_standing");
    });

    it("identifies excessive_standing when standing for long continuous periods", () => {
      // 10m sitting (600s) + 50m standing (3000s) = ~83% standing
      expect(evaluatePostureCompliance(600, 3000, 2.0)).toBe("excessive_standing");
    });

    it("safely handles non-finite or negative targetRatio by defaulting to 2.0", () => {
      expect(evaluatePostureCompliance(2400, 1200, -1)).toBe("optimal");
      expect(evaluatePostureCompliance(2400, 1200, NaN)).toBe("optimal");
      expect(evaluatePostureCompliance(2400, 1200, 0)).toBe("optimal");
    });
  });

  describe("estimateStandingCaloriesBurned", () => {
    it("estimates metabolic calories burned (~0.65 kcal/minute)", () => {
      expect(estimateStandingCaloriesBurned(3600)).toBe(39); // 60 min * 0.65 = 39
      expect(estimateStandingCaloriesBurned(1800)).toBe(20); // 30 min * 0.65 = 19.5 -> 20
    });

    it("returns zero for negative or non-finite durations", () => {
      expect(estimateStandingCaloriesBurned(0)).toBe(0);
      expect(estimateStandingCaloriesBurned(-500)).toBe(0);
      expect(estimateStandingCaloriesBurned(NaN)).toBe(0);
    });
  });

  describe("formatDurationHoursMinutes", () => {
    it("formats combined hours and minutes correctly", () => {
      expect(formatDurationHoursMinutes(5400)).toBe("1h 30m");
    });

    it("formats exact hours without redundant minutes", () => {
      expect(formatDurationHoursMinutes(7200)).toBe("2h");
    });

    it("formats sub-hour durations in minutes", () => {
      expect(formatDurationHoursMinutes(1800)).toBe("30m");
      expect(formatDurationHoursMinutes(45)).toBe("0m");
    });

    it("handles non-finite or negative durations safely", () => {
      expect(formatDurationHoursMinutes(-100)).toBe("0m");
      expect(formatDurationHoursMinutes(NaN)).toBe("0m");
    });
  });

  describe("buildDailyPostureRecord", () => {
    it("builds a complete DailyPostureRecord with compliant metrics", () => {
      const record = buildDailyPostureRecord({
        date: "2026-10-26",
        dayOfWeek: "Mon",
        dayName: "Monday",
        sittingSeconds: 14400,
        standingSeconds: 7200,
        transitionsCount: 8,
        targetRatio: 2.0,
        notes: "Great posture balance",
      });

      expect(record.id).toBe("posture-2026-10-26");
      expect(record.date).toBe("2026-10-26");
      expect(record.sittingSeconds).toBe(14400);
      expect(record.standingSeconds).toBe(7200);
      expect(record.actualRatio).toBe(2);
      expect(record.complianceStatus).toBe("optimal");
      expect(record.activeCaloriesBurned).toBe(78);
      expect(record.notes).toBe("Great posture balance");
    });

    it("tolerates missing or non-finite arguments", () => {
      const record = buildDailyPostureRecord({
        date: "",
        dayOfWeek: "",
        dayName: "",
        sittingSeconds: NaN,
        standingSeconds: -100,
      });

      expect(record.id).toBe("posture-unspecified");
      expect(record.sittingSeconds).toBe(0);
      expect(record.standingSeconds).toBe(0);
      expect(record.complianceStatus).toBe("low_activity");
    });
  });

  describe("computeWeeklyDeskSummary", () => {
    it("computes full weekly summary analytics from a 7-day posture history", () => {
      const records = generateSampleWeeklyPostureHistory(2.0);
      const summary = computeWeeklyDeskSummary(records, 2.0);

      expect(summary.totalSittingSeconds).toBeGreaterThan(0);
      expect(summary.totalStandingSeconds).toBeGreaterThan(0);
      expect(summary.totalDeskSeconds).toBe(summary.totalSittingSeconds + summary.totalStandingSeconds);
      expect(["A+", "A", "B", "C", "D"]).toContain(summary.weeklyErgonomicGrade);
      expect(summary.dailyRecords.length).toBe(7);
      expect(summary.keyInsights.length).toBeGreaterThan(0);
      expect(summary.actionableRecommendations.length).toBeGreaterThan(0);
    });

    it("handles nullish or empty daily records array gracefully", () => {
      const emptySummary = computeWeeklyDeskSummary([]);
      expect(emptySummary.totalDeskSeconds).toBe(0);
      expect(emptySummary.totalSittingSeconds).toBe(0);
      expect(emptySummary.totalStandingSeconds).toBe(0);
      expect(emptySummary.weeklyErgonomicGrade).toBe("D");
      expect(emptySummary.dailyRecords).toEqual([]);

      const nullSummary = computeWeeklyDeskSummary(null as any);
      expect(nullSummary.totalDeskSeconds).toBe(0);
      expect(nullSummary.weeklyErgonomicGrade).toBe("D");
    });

    it("filters out null or malformed items in dailyRecords", () => {
      const records = [null as any, undefined as any];
      const summary = computeWeeklyDeskSummary(records);
      expect(summary.dailyRecords).toEqual([]);
      expect(summary.weeklyErgonomicGrade).toBe("D");
    });
  });

  describe("syncLiveSessionToDailyRecords", () => {
    it("updates existing record for today with current live session durations", () => {
      const initialRecords = generateSampleWeeklyPostureHistory(2.0);
      const updated = syncLiveSessionToDailyRecords(initialRecords, 20000, 10000, 12, 2.0);

      expect(updated.length).toBe(7);
      const todayRecord = updated.find((r) => r.sittingSeconds >= 20000);
      expect(todayRecord).toBeDefined();
      expect(todayRecord!.standingSeconds).toBeGreaterThanOrEqual(10000);
    });

    it("handles nullish existing records array by generating fresh sample history", () => {
      const updated = syncLiveSessionToDailyRecords(null, 5000, 2500, 5);
      expect(updated.length).toBe(7);
    });

    it("safely handles NaN and negative live durations", () => {
      const initialRecords = generateSampleWeeklyPostureHistory(2.0);
      const updated = syncLiveSessionToDailyRecords(initialRecords, NaN, -500, NaN);
      expect(updated.length).toBe(7);
    });
  });

  describe("SIT_STAND_TARGET_PRESETS", () => {
    it("contains three valid clinical presets", () => {
      expect(SIT_STAND_TARGET_PRESETS.length).toBe(3);
      expect(SIT_STAND_TARGET_PRESETS.map((p) => p.id)).toEqual([
        "beginner_3_1",
        "recommended_2_1",
        "active_1_1",
      ]);
    });
  });
});
