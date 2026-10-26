import {
  calculateDistanceKm,
  estimateCommuteForMode,
  calculateAllCommuteEstimates,
  COMMUTE_MODES,
  type CommuteMode,
} from "@/lib/commute/carbonEstimator";

describe("carbonEstimator (#6796)", () => {
  describe("calculateDistanceKm", () => {
    it("returns 0 for identical coordinates", () => {
      expect(calculateDistanceKm(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
    });

    it("returns 0 for non-finite coordinates without throwing", () => {
      expect(calculateDistanceKm(NaN, -122.4194, 37.7749, -122.4194)).toBe(0);
      expect(calculateDistanceKm(37.7749, Infinity, 37.7749, -122.4194)).toBe(0);
      expect(calculateDistanceKm(null as any, undefined as any, NaN, 10)).toBe(0);
    });

    it("handles antipodal points without producing NaN", () => {
      // (90, 0) and (-90, 0)
      const dist = calculateDistanceKm(90, 0, -90, 0);
      expect(Number.isFinite(dist)).toBe(true);
      expect(dist).toBeGreaterThan(0);
    });

    it("calculates distance with urban road network factor (~1.25x)", () => {
      // SF to San Jose (~65-75 km straight line)
      const dist = calculateDistanceKm(37.7749, -122.4194, 37.3382, -121.8863);
      expect(dist).toBeGreaterThan(70);
      expect(dist).toBeLessThan(120);
    });
  });

  describe("estimateCommuteForMode", () => {
    it("reports 0 min and 0 emissions for 0 km distance (on-site)", () => {
      const walking = estimateCommuteForMode(0, "walking");
      expect(walking.distanceKm).toBe(0);
      expect(walking.durationMinutes).toBe(0);
      expect(walking.durationFormatted).toBe("0 min");
      expect(walking.co2GramsPerTrip).toBe(0);
      expect(walking.co2KgWeekly).toBe(0);
      expect(walking.caloriesBurnedRoundTrip).toBe(0);

      const transit = estimateCommuteForMode(0, "transit");
      expect(transit.durationMinutes).toBe(0);
      expect(transit.durationFormatted).toBe("0 min");
    });

    it("safely normalizes negative or non-finite distances to 0", () => {
      const resNeg = estimateCommuteForMode(-10, "cycling");
      expect(resNeg.distanceKm).toBe(0);
      expect(resNeg.durationMinutes).toBe(0);

      const resNaN = estimateCommuteForMode(NaN, "car");
      expect(resNaN.distanceKm).toBe(0);
      expect(resNaN.durationMinutes).toBe(0);
    });

    it("computes travel time and formatted duration for positive distances", () => {
      // 10 km cycling at 16 km/h -> ~37.5 min + 2 min buffer = ~40 min
      const cycling = estimateCommuteForMode(10, "cycling");
      expect(cycling.durationMinutes).toBeGreaterThanOrEqual(35);
      expect(cycling.durationFormatted).toContain("min");
      expect(cycling.caloriesBurnedRoundTrip).toBe(10 * 2 * 35); // 700 cal
    });

    it("formats duration with hours and minutes when >= 60 minutes", () => {
      // 10 km walking at 4.8 km/h -> ~125 min -> "2h 5m"
      const walking = estimateCommuteForMode(10, "walking");
      expect(walking.durationMinutes).toBeGreaterThanOrEqual(60);
      expect(walking.durationFormatted).toMatch(/\d+h \d+m/);
    });

    it("handles case-mismatched or unknown modes safely", () => {
      const upper = estimateCommuteForMode(5, "WALKING");
      expect(upper.mode).toBe("walking");
      expect(upper.modeLabel).toBe("Walking");

      const unknown = estimateCommuteForMode(5, "spaceship" as any);
      expect(unknown.mode).toBe("transit"); // fallback to transit
    });

    it("sanitizes workDaysPerWeek properly into [1, 7]", () => {
      const resNaN = estimateCommuteForMode(10, "transit", NaN);
      expect(Number.isFinite(resNaN.co2KgWeekly)).toBe(true);

      const resHigh = estimateCommuteForMode(10, "transit", 15);
      expect(Number.isFinite(resHigh.co2KgWeekly)).toBe(true);
      // 15 is clamped to 7 days
      const res7 = estimateCommuteForMode(10, "transit", 7);
      expect(resHigh.co2KgWeekly).toBe(res7.co2KgWeekly);
    });

    it("classifies eco tiers correctly", () => {
      const walking = estimateCommuteForMode(5, "walking");
      expect(walking.ecoTier).toBe("zero_emission");
      expect(walking.ecoScorePercentage).toBe(100);

      const transit = estimateCommuteForMode(5, "transit");
      expect(transit.ecoTier).toBe("low_carbon");

      const car = estimateCommuteForMode(5, "car");
      expect(car.ecoTier).toBe("high_emission");
      expect(car.ecoScorePercentage).toBe(0);
    });
  });

  describe("calculateAllCommuteEstimates", () => {
    it("returns estimates for all 6 supported modes", () => {
      const estimates = calculateAllCommuteEstimates(
        37.7749,
        -122.4194,
        37.7849,
        -122.4094,
        5,
      );

      const modes: CommuteMode[] = [
        "walking",
        "cycling",
        "transit",
        "ev",
        "motorcycle",
        "car",
      ];
      modes.forEach((m) => {
        expect(estimates[m]).toBeDefined();
        expect(estimates[m].mode).toBe(m);
        expect(estimates[m].distanceKm).toBeGreaterThan(0);
      });
    });

    it("handles null or missing coordinates gracefully", () => {
      const estimates = calculateAllCommuteEstimates(null, undefined, NaN, null);
      expect(estimates.walking.distanceKm).toBe(0);
      expect(estimates.transit.durationMinutes).toBe(0);
    });
  });
});
