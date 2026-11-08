import {
  CircadianOptimizer,
  calculateRecommendedColorTemperature,
  clampLux,
  clampCCT,
  MIN_LUX,
  MAX_LUX,
  MIN_CCT,
  MAX_CCT,
} from "@/core/sensors/CircadianOptimizer";

describe("CircadianOptimizer - Ambient Light to Color Temperature Clamping (#core/sensors)", () => {
  let optimizer: CircadianOptimizer;

  beforeEach(() => {
    optimizer = new CircadianOptimizer();
  });

  describe("Illuminance (Lux) Input Clamping", () => {
    it("clamps values below 10 lux to MIN_LUX (10 lux)", () => {
      expect(clampLux(-50)).toBe(MIN_LUX);
      expect(clampLux(0)).toBe(MIN_LUX);
      expect(clampLux(1)).toBe(MIN_LUX);
      expect(clampLux(5)).toBe(MIN_LUX);
      expect(clampLux(9.9)).toBe(MIN_LUX);
      expect(clampLux(10)).toBe(MIN_LUX);
    });

    it("clamps values above 100,000 lux to MAX_LUX (100,000 lux)", () => {
      expect(clampLux(100_000)).toBe(MAX_LUX);
      expect(clampLux(120_000)).toBe(MAX_LUX);
      expect(clampLux(250_000)).toBe(MAX_LUX);
      expect(clampLux(1_000_000)).toBe(MAX_LUX);
    });

    it("preserves valid values between 10 lux and 100,000 lux", () => {
      expect(clampLux(50)).toBe(50);
      expect(clampLux(300)).toBe(300);
      expect(clampLux(500)).toBe(500);
      expect(clampLux(50_000)).toBe(50_000);
    });

    it("handles non-finite values safely", () => {
      expect(clampLux(NaN)).toBe(MIN_LUX);
      expect(clampLux(Infinity)).toBe(MIN_LUX);
      expect(clampLux(-Infinity)).toBe(MIN_LUX);
    });
  });

  describe("Color Temperature (CCT) Output Clamping", () => {
    it("strictly clamps CCT values between 2200K and 6500K", () => {
      expect(clampCCT(1500)).toBe(MIN_CCT);
      expect(clampCCT(2000)).toBe(MIN_CCT);
      expect(clampCCT(2200)).toBe(MIN_CCT);
      expect(clampCCT(6500)).toBe(MAX_CCT);
      expect(clampCCT(7000)).toBe(MAX_CCT);
      expect(clampCCT(12000)).toBe(MAX_CCT);
      expect(clampCCT(20000)).toBe(MAX_CCT);
    });

    it("handles non-finite CCT values safely", () => {
      expect(clampCCT(NaN)).toBe(MIN_CCT);
      expect(clampCCT(Infinity)).toBe(MIN_CCT);
    });
  });

  describe("Dark Room Lux Values (< 50 lux) - Preventing >12,000K Spikes", () => {
    it("never produces erratic values (>12,000K) for lux values below 50 lux", () => {
      const darkLuxValues = [-10, 0, 1, 5, 10, 15, 20, 25, 30, 40, 49];

      darkLuxValues.forEach((lux) => {
        const cct = optimizer.calculateRecommendedColorTemperature(lux);
        expect(cct).toBeGreaterThanOrEqual(MIN_CCT);
        expect(cct).toBeLessThanOrEqual(3000); // Dark rooms should strictly stay warm (< 3000K)
        expect(cct).not.toBeGreaterThan(MAX_CCT);
      });
    });

    it("outputs exactly 2200K (warm candle) at and below 10 lux", () => {
      expect(optimizer.calculateRecommendedColorTemperature(0)).toBe(2200);
      expect(optimizer.calculateRecommendedColorTemperature(5)).toBe(2200);
      expect(optimizer.calculateRecommendedColorTemperature(10)).toBe(2200);
    });

    it("produces warm gradual progression between 10 lux and 50 lux", () => {
      const cct25 = optimizer.calculateRecommendedColorTemperature(25);
      const cct40 = optimizer.calculateRecommendedColorTemperature(40);

      expect(cct25).toBe(2628);
      expect(cct40).toBe(2847);
      expect(cct40).toBeGreaterThan(cct25);
    });
  });

  describe("Office Lighting Lux Values (300 lux - 1,000 lux)", () => {
    it("outputs neutral focused white lighting (3700K - 4400K) for typical office illuminance", () => {
      const cct300 = optimizer.calculateRecommendedColorTemperature(300);
      const cct500 = optimizer.calculateRecommendedColorTemperature(500);
      const cct1000 = optimizer.calculateRecommendedColorTemperature(1000);

      expect(cct300).toBe(3788);
      expect(cct500).toBe(4026);
      expect(cct1000).toBe(4350);

      expect(cct300).toBeGreaterThan(3500);
      expect(cct300).toBeLessThan(4000);
      expect(cct500).toBeGreaterThanOrEqual(4000);
      expect(cct500).toBeLessThanOrEqual(4500);
    });
  });

  describe("Direct Sunlight & Outdoor Lux Values (10,000 lux - 100,000+ lux)", () => {
    it("outputs bright daylight CCT up to 6500K for high outdoor illuminance", () => {
      const cct10k = optimizer.calculateRecommendedColorTemperature(10_000);
      const cct50k = optimizer.calculateRecommendedColorTemperature(50_000);
      const cct100k = optimizer.calculateRecommendedColorTemperature(100_000);
      const cct200k = optimizer.calculateRecommendedColorTemperature(200_000);

      expect(cct10k).toBe(5425);
      expect(cct50k).toBe(6176);
      expect(cct100k).toBe(6500);
      expect(cct200k).toBe(6500); // Clamped at 6500K
    });
  });

  describe("Static Methods and Recommendation Evaluation", () => {
    it("static method calculateRecommendedColorTemperature yields identical results", () => {
      expect(CircadianOptimizer.calculateRecommendedColorTemperature(500)).toBe(
        optimizer.calculateRecommendedColorTemperature(500),
      );
      expect(calculateRecommendedColorTemperature(500)).toBe(4026);
    });

    it("includes clamped recommendedCCT in evaluation result", () => {
      const darkEvaluation = optimizer.evaluate({ lux: 20, cct: 2700 }, 20);
      expect(darkEvaluation.recommendedCCT).toBeDefined();
      expect(darkEvaluation.recommendedCCT).toBeGreaterThanOrEqual(MIN_CCT);
      expect(darkEvaluation.recommendedCCT).toBeLessThan(3000);

      const brightEvaluation = optimizer.evaluate(
        { lux: 150_000, cct: 6500 },
        10,
      );
      expect(brightEvaluation.recommendedCCT).toBe(MAX_CCT);
    });
  });
});
