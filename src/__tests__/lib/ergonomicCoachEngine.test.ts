import {
  ErgonomicCoachEngine,
  MICRO_STRETCH_CATALOG,
  ErgonomicSessionState,
} from "@/lib/wellness/ergonomicCoachEngine";

describe("ErgonomicCoachEngine", () => {
  const createMockSession = (overrides: Partial<ErgonomicSessionState> = {}): ErgonomicSessionState => ({
    sessionId: "test-session",
    deskType: "height_adjustable_sit_stand",
    currentPostureState: "sitting",
    sessionStartTime: Date.now() - 3600000, // 1 hour ago
    lastPostureStateChange: Date.now() - 1800000, // 30 min ago
    totalSittingSeconds: 2400,
    totalStandingSeconds: 1200,
    completedStretches: ["neck-chin-tuck", "thoracic-open-book"],
    postureCheckIns: [{ timestamp: Date.now() - 600000, rating: "aligned" }],
    waterIntakeMl: 300,
    waterTargetMl: 2000,
    eyeBreaksCompleted: 3,
    skippedBreaksCount: 0,
    ...overrides,
  });

  describe("calculateStrainScore", () => {
    it("returns an optimal score for balanced movement and compliance", () => {
      const session = createMockSession();
      const score = ErgonomicCoachEngine.calculateStrainScore(session);

      expect(score.score).toBeGreaterThanOrEqual(70);
      expect(["optimal", "good"]).toContain(score.tier);
      expect(score.factors.postureBalanceScore).toBeGreaterThan(0);
      expect(score.factors.stretchComplianceScore).toBeGreaterThan(0);
      expect(score.factors.hydrationScore).toBeGreaterThan(0);
      expect(score.factors.eyeRestScore).toBeGreaterThan(0);
      expect(score.recommendation).toBeDefined();
      expect(score.nextSuggestedAction).toBeDefined();
    });

    it("safely handles nullish session state", () => {
      const score = ErgonomicCoachEngine.calculateStrainScore(null);
      expect(score.score).toBe(100);
      expect(score.tier).toBe("optimal");
      expect(score.factors.postureBalanceScore).toBe(100);
    });

    it("penalizes prolonged uninterrupted sitting on standard desk", () => {
      const session = createMockSession({
        deskType: "standard_seated",
        currentPostureState: "sitting",
        sessionStartTime: Date.now() - 7200000, // 2 hours
        lastPostureStateChange: Date.now() - 7200000, // 2 hours sitting continuously
        postureCheckIns: [],
      });

      const score = ErgonomicCoachEngine.calculateStrainScore(session);
      expect(score.factors.postureBalanceScore).toBeLessThan(100);
    });

    it("penalizes slouching and stiffness in posture check-ins", () => {
      const session = createMockSession({
        postureCheckIns: [
          { timestamp: Date.now() - 1000, rating: "slouching" },
          { timestamp: Date.now() - 500, rating: "stiff" },
        ],
      });

      const score = ErgonomicCoachEngine.calculateStrainScore(session);
      expect(score.factors.postureBalanceScore).toBeLessThanOrEqual(85);
    });

    it("penalizes low standing ratio on height adjustable desks", () => {
      const session = createMockSession({
        deskType: "height_adjustable_sit_stand",
        totalSittingSeconds: 3600,
        totalStandingSeconds: 60, // < 2% standing
      });

      const score = ErgonomicCoachEngine.calculateStrainScore(session);
      expect(score.factors.postureBalanceScore).toBeLessThanOrEqual(70);
    });

    it("safely tolerates missing or non-array check-ins and non-finite numbers", () => {
      const session = createMockSession({
        sessionStartTime: NaN,
        lastPostureStateChange: NaN,
        totalSittingSeconds: NaN,
        totalStandingSeconds: NaN,
        waterIntakeMl: NaN,
        eyeBreaksCompleted: NaN,
        completedStretches: null as any,
        postureCheckIns: null as any,
      });

      const score = ErgonomicCoachEngine.calculateStrainScore(session);
      expect(Number.isFinite(score.score)).toBe(true);
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
    });
  });

  describe("getRecommendedStretch", () => {
    it("prioritizes neck-chin-tuck when recent check-in detected slouching", () => {
      const session = createMockSession({
        postureCheckIns: [{ timestamp: Date.now(), rating: "slouching" }],
      });
      const routine = ErgonomicCoachEngine.getRecommendedStretch(session);
      expect(routine.id).toBe("neck-chin-tuck");
    });

    it("prioritizes thoracic-open-book when recent check-in detected stiffness", () => {
      const session = createMockSession({
        postureCheckIns: [{ timestamp: Date.now(), rating: "stiff" }],
      });
      const routine = ErgonomicCoachEngine.getRecommendedStretch(session);
      expect(routine.id).toBe("thoracic-open-book");
    });

    it("prioritizes hip flexor lunge for sustained sitting (> 45 min)", () => {
      const session = createMockSession({
        currentPostureState: "sitting",
        lastPostureStateChange: Date.now() - 3000000, // 50 mins ago
        postureCheckIns: [{ timestamp: Date.now(), rating: "aligned" }],
      });
      const routine = ErgonomicCoachEngine.getRecommendedStretch(session);
      expect(routine.id).toBe("standing-hip-flexor-lunge");
    });

    it("falls back to rotation or first routine for nullish state", () => {
      expect(ErgonomicCoachEngine.getRecommendedStretch(null)).toBe(MICRO_STRETCH_CATALOG[0]);
    });
  });

  describe("MICRO_STRETCH_CATALOG", () => {
    it("contains 6 complete biomechanical micro-stretches", () => {
      expect(MICRO_STRETCH_CATALOG.length).toBe(6);
      MICRO_STRETCH_CATALOG.forEach((stretch) => {
        expect(stretch.id).toBeDefined();
        expect(stretch.name).toBeDefined();
        expect(stretch.category).toBeDefined();
        expect(stretch.targetMuscles.length).toBeGreaterThan(0);
        expect(stretch.instructions.length).toBeGreaterThan(0);
        expect(stretch.ergonomicBenefit).toBeDefined();
      });
    });
  });

  describe("delegation methods", () => {
    it("delegates calculateSitStandRatio correctly", () => {
      const ratio = ErgonomicCoachEngine.calculateSitStandRatio(3600, 1800);
      expect(ratio.ratio).toBe(2);
    });

    it("delegates computeWeeklySummary correctly", () => {
      const summary = ErgonomicCoachEngine.computeWeeklySummary();
      expect(summary.totalDeskSeconds).toBeGreaterThan(0);
    });
  });
});
