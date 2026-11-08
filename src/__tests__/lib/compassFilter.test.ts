import {
  CompassKalmanFilter,
  normalizeDegrees,
  degreesToRadians,
  headingToRadians,
  radiansToDegrees,
  shortestAngularDifference,
  smoothCircularHeading,
} from "@/lib/spatial/compassFilter";

describe("compassFilter null sensor and radian conversion handling (#4792)", () => {
  describe("degreesToRadians and headingToRadians", () => {
    it("converts valid degrees to radians accurately", () => {
      expect(degreesToRadians(0)).toBeCloseTo(0, 5);
      expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2, 5);
      expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 5);
      expect(degreesToRadians(270)).toBeCloseTo(-Math.PI / 2, 5);
      expect(degreesToRadians(360)).toBeCloseTo(0, 5);
    });

    it("falls back to stationary 0 heading when sensor returns null", () => {
      const result = degreesToRadians(null);
      expect(result).toBe(0);
      expect(Number.isNaN(result)).toBe(false);
    });

    it("falls back to stationary 0 heading when sensor returns undefined or NaN", () => {
      expect(degreesToRadians(undefined)).toBe(0);
      expect(degreesToRadians(NaN)).toBe(0);
      expect(degreesToRadians(Infinity)).toBe(0);
      expect(degreesToRadians(-Infinity)).toBe(0);
    });

    it("respects custom fallback angle when sensor returns null", () => {
      expect(degreesToRadians(null, 90)).toBeCloseTo(Math.PI / 2, 5);
      expect(headingToRadians(null, 180)).toBeCloseTo(Math.PI, 5);
    });
  });

  describe("radiansToDegrees", () => {
    it("converts radians back to degrees", () => {
      expect(radiansToDegrees(0)).toBe(0);
      expect(radiansToDegrees(Math.PI / 2)).toBeCloseTo(90, 4);
      expect(radiansToDegrees(null)).toBe(0);
      expect(radiansToDegrees(undefined)).toBe(0);
      expect(radiansToDegrees(NaN)).toBe(0);
    });
  });

  describe("normalizeDegrees", () => {
    it("handles null, undefined, and non-finite values safely", () => {
      expect(normalizeDegrees(null)).toBe(0);
      expect(normalizeDegrees(undefined)).toBe(0);
      expect(normalizeDegrees(NaN)).toBe(0);
      expect(normalizeDegrees(Infinity)).toBe(0);
    });

    it("normalizes regular angles into [0, 360)", () => {
      expect(normalizeDegrees(0)).toBe(0);
      expect(normalizeDegrees(360)).toBe(0);
      expect(normalizeDegrees(-90)).toBe(270);
      expect(normalizeDegrees(450)).toBe(90);
    });
  });

  describe("shortestAngularDifference", () => {
    it("safely handles non-finite inputs", () => {
      expect(shortestAngularDifference(NaN, 90)).toBe(0);
      expect(shortestAngularDifference(90, NaN)).toBe(0);
      expect(shortestAngularDifference(0, 90)).toBe(90);
      expect(shortestAngularDifference(90, 0)).toBe(-90);
      expect(shortestAngularDifference(350, 10)).toBe(20);
    });
  });

  describe("CompassKalmanFilter null handling", () => {
    it("defaults to 0 or last known heading when sensor returns null", () => {
      const filter = new CompassKalmanFilter();

      // First reading is null (hardware without magnetometer) -> defaults to 0
      const initialNull = filter.update(null);
      expect(initialNull).toBe(0);
      expect(Number.isNaN(initialNull)).toBe(false);

      // Next reading is valid heading (90)
      const validReading = filter.update(90);
      expect(validReading).toBe(90);

      // Subsequent reading is null -> returns last known heading without degrading to NaN
      const subsequentNull = filter.update(null);
      expect(subsequentNull).toBe(90);
      expect(Number.isNaN(subsequentNull)).toBe(false);

      // Subsequent reading is NaN -> returns last known heading
      const nanReading = filter.update(NaN);
      expect(nanReading).toBe(90);
      expect(Number.isNaN(nanReading)).toBe(false);
    });
  });

  describe("smoothCircularHeading null handling", () => {
    it("safely handles null and undefined readings without returning NaN", () => {
      expect(smoothCircularHeading(null, null)).toBe(0);
      expect(smoothCircularHeading(null, 90)).toBe(90);
      expect(smoothCircularHeading(90, null)).toBe(90);
      expect(smoothCircularHeading(null, null, 0.15, 45)).toBe(45);
      expect(smoothCircularHeading(0, 90, 0.5)).toBe(45);
    });
  });
});
