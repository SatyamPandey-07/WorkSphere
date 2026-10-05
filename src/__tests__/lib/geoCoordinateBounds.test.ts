import {
  calculateHaversineDistance,
  clampLatitude,
  clampLongitude,
  isValidCoordinate,
} from "@/lib/utils";
import { haversineKm, haversineMiles } from "@/lib/distance";
import { calculateBearing } from "@/lib/geo";

describe("Geographic Coordinate Bounds & Clamping (#3934)", () => {
  describe("clampLatitude", () => {
    it("preserves latitude values within valid range [-90, 90]", () => {
      expect(clampLatitude(0)).toBe(0);
      expect(clampLatitude(45.5)).toBe(45.5);
      expect(clampLatitude(-45.5)).toBe(-45.5);
      expect(clampLatitude(90)).toBe(90);
      expect(clampLatitude(-90)).toBe(-90);
    });

    it("clamps latitude exceeding 90 to 90", () => {
      expect(clampLatitude(91)).toBe(90);
      expect(clampLatitude(120)).toBe(90);
      expect(clampLatitude(999)).toBe(90);
      expect(clampLatitude(Infinity)).toBe(90);
    });

    it("clamps latitude below -90 to -90", () => {
      expect(clampLatitude(-91)).toBe(-90);
      expect(clampLatitude(-120)).toBe(-90);
      expect(clampLatitude(-999)).toBe(-90);
      expect(clampLatitude(-Infinity)).toBe(-90);
    });

    it("returns NaN for NaN input", () => {
      expect(clampLatitude(NaN)).toBeNaN();
    });
  });

  describe("clampLongitude", () => {
    it("preserves longitude values within valid range [-180, 180]", () => {
      expect(clampLongitude(0)).toBe(0);
      expect(clampLongitude(120.5)).toBe(120.5);
      expect(clampLongitude(-120.5)).toBe(-120.5);
      expect(clampLongitude(180)).toBe(180);
      expect(clampLongitude(-180)).toBe(-180);
    });

    it("clamps longitude exceeding 180 to 180", () => {
      expect(clampLongitude(181)).toBe(180);
      expect(clampLongitude(240)).toBe(180);
      expect(clampLongitude(999)).toBe(180);
      expect(clampLongitude(Infinity)).toBe(180);
    });

    it("clamps longitude below -180 to -180", () => {
      expect(clampLongitude(-181)).toBe(-180);
      expect(clampLongitude(-240)).toBe(-180);
      expect(clampLongitude(-999)).toBe(-180);
      expect(clampLongitude(-Infinity)).toBe(-180);
    });

    it("returns NaN for NaN input", () => {
      expect(clampLongitude(NaN)).toBeNaN();
    });
  });

  describe("isValidCoordinate", () => {
    it("returns true for coordinates within valid bounds", () => {
      expect(isValidCoordinate(0, 0)).toBe(true);
      expect(isValidCoordinate(90, 180)).toBe(true);
      expect(isValidCoordinate(-90, -180)).toBe(true);
      expect(isValidCoordinate(40.7128, -74.006)).toBe(true);
    });

    it("returns false for out-of-bounds coordinates", () => {
      expect(isValidCoordinate(91, 0)).toBe(false);
      expect(isValidCoordinate(-91, 0)).toBe(false);
      expect(isValidCoordinate(0, 181)).toBe(false);
      expect(isValidCoordinate(0, -181)).toBe(false);
    });

    it("returns false for NaN or non-finite inputs", () => {
      expect(isValidCoordinate(NaN, 0)).toBe(false);
      expect(isValidCoordinate(0, NaN)).toBe(false);
      expect(isValidCoordinate(Infinity, 0)).toBe(false);
      expect(isValidCoordinate(0, -Infinity)).toBe(false);
      expect(isValidCoordinate(null as any, 0)).toBe(false);
      expect(isValidCoordinate(undefined as any, 0)).toBe(false);
    });
  });

  describe("calculateHaversineDistance with out-of-bounds coordinates", () => {
    it("clamps latitude exceeding 90 to 90 without returning NaN", () => {
      // (95, 0) should be clamped to (90, 0)
      const clampedDist = calculateHaversineDistance(95, 0, 90, 0);
      expect(clampedDist).toBe(0);
      expect(isNaN(clampedDist)).toBe(false);

      const normalDist = calculateHaversineDistance(90, 0, 0, 0);
      const outOfBoundsDist = calculateHaversineDistance(110, 0, 0, 0);
      expect(outOfBoundsDist).toBeCloseTo(normalDist, 5);
    });

    it("clamps latitude below -90 to -90 without returning NaN", () => {
      // (-95, 0) should be clamped to (-90, 0)
      const clampedDist = calculateHaversineDistance(-95, 0, -90, 0);
      expect(clampedDist).toBe(0);
      expect(isNaN(clampedDist)).toBe(false);

      const normalDist = calculateHaversineDistance(-90, 0, 0, 0);
      const outOfBoundsDist = calculateHaversineDistance(-120, 0, 0, 0);
      expect(outOfBoundsDist).toBeCloseTo(normalDist, 5);
    });

    it("clamps longitude exceeding bounds [-180, 180] properly", () => {
      const normalDist = calculateHaversineDistance(0, 180, 0, 0);
      const outOfBoundsDist = calculateHaversineDistance(0, 200, 0, 0);
      expect(outOfBoundsDist).toBeCloseTo(normalDist, 5);

      const normalDistNeg = calculateHaversineDistance(0, -180, 0, 0);
      const outOfBoundsDistNeg = calculateHaversineDistance(0, -220, 0, 0);
      expect(outOfBoundsDistNeg).toBeCloseTo(normalDistNeg, 5);
    });

    it("returns NaN for invalid non-numeric or NaN coordinates", () => {
      expect(calculateHaversineDistance(NaN, 0, 10, 10)).toBeNaN();
      expect(calculateHaversineDistance(0, NaN, 10, 10)).toBeNaN();
      expect(calculateHaversineDistance(0, 0, NaN, 10)).toBeNaN();
      expect(calculateHaversineDistance(0, 0, 10, NaN)).toBeNaN();
      expect(calculateHaversineDistance(undefined as any, 0, 10, 10)).toBeNaN();
    });
  });

  describe("haversineKm & haversineMiles integration", () => {
    it("clamps coordinates in haversineKm", () => {
      const dist = haversineKm(95, 0, 90, 0);
      expect(dist).toBe(0);

      const dist2 = haversineKm(-100, 0, 0, 0);
      expect(dist2).toBeCloseTo(haversineKm(-90, 0, 0, 0), 5);
    });

    it("clamps coordinates in haversineMiles", () => {
      const miles = haversineMiles(95, 0, 90, 0);
      expect(miles).toBe(0);

      const miles2 = haversineMiles(100, 0, 0, 0);
      expect(miles2).toBeCloseTo(haversineMiles(90, 0, 0, 0), 5);
    });
  });

  describe("calculateBearing with out-of-bounds coordinates", () => {
    it("clamps latitude exceeding 90 or below -90 cleanly", () => {
      const normalBearing = calculateBearing(90, 0, 0, 0);
      const clampedBearing = calculateBearing(110, 0, 0, 0);
      expect(clampedBearing).toBe(normalBearing);

      const southNormal = calculateBearing(-90, 0, 0, 0);
      const southClamped = calculateBearing(-120, 0, 0, 0);
      expect(southClamped).toBe(southNormal);
    });

    it("returns NaN for NaN coordinates in calculateBearing", () => {
      expect(calculateBearing(NaN, 0, 10, 0)).toBeNaN();
      expect(calculateBearing(0, NaN, 10, 0)).toBeNaN();
      expect(calculateBearing(0, 0, NaN, 0)).toBeNaN();
      expect(calculateBearing(0, 0, 10, NaN)).toBeNaN();
      expect(calculateBearing(undefined as any, 0, 10, 0)).toBeNaN();
    });
  });
});
