import {
  normalizeAngle,
  shortestArcDelta,
  interpolateAngleShortestArc,
  calculateRelativeAzimuth,
} from "@/lib/geometry/bearing";

describe("Bearing & Angle Normalization Utilities (#4373)", () => {
  describe("normalizeAngle", () => {
    it("preserves angles already in [0, 360) range", () => {
      expect(normalizeAngle(0)).toBe(0);
      expect(normalizeAngle(45)).toBe(45);
      expect(normalizeAngle(180)).toBe(180);
      expect(normalizeAngle(359.9)).toBeCloseTo(359.9, 5);
    });

    it("normalizes negative angles correctly into [0, 360)", () => {
      expect(normalizeAngle(-45)).toBe(315);
      expect(normalizeAngle(-180)).toBe(180);
      expect(normalizeAngle(-360)).toBe(0);
      expect(normalizeAngle(-720)).toBe(0);
      expect(normalizeAngle(-370)).toBe(350);
    });

    it("normalizes angles >= 360 correctly into [0, 360)", () => {
      expect(normalizeAngle(360)).toBe(0);
      expect(normalizeAngle(370)).toBe(10);
      expect(normalizeAngle(720)).toBe(0);
      expect(normalizeAngle(750)).toBe(30);
    });

    it("handles non-finite and NaN values gracefully by returning 0", () => {
      expect(normalizeAngle(NaN)).toBe(0);
      expect(normalizeAngle(Infinity)).toBe(0);
      expect(normalizeAngle(-Infinity)).toBe(0);
    });
  });

  describe("shortestArcDelta", () => {
    it("calculates direct angular differences within [-180, 180]", () => {
      expect(shortestArcDelta(0, 90)).toBe(90);
      expect(shortestArcDelta(90, 0)).toBe(-90);
      expect(shortestArcDelta(45, 135)).toBe(90);
    });

    it("wraps around the 0/360 degree boundary along the shortest path", () => {
      // Rotating from 350° to 10° should be +20° clockwise, NOT -340°
      expect(shortestArcDelta(350, 10)).toBe(20);
      // Rotating from 10° to 350° should be -20° counter-clockwise
      expect(shortestArcDelta(10, 350)).toBe(-20);
      // Rotating from 355° to 5° should be +10°
      expect(shortestArcDelta(355, 5)).toBe(10);
    });

    it("handles exactly 180 degree differences", () => {
      expect(Math.abs(shortestArcDelta(0, 180))).toBe(180);
      expect(Math.abs(shortestArcDelta(90, 270))).toBe(180);
    });
  });

  describe("interpolateAngleShortestArc", () => {
    it("interpolates across 0/360 boundary smoothly", () => {
      // Midway between 350° and 10° is 0°
      expect(interpolateAngleShortestArc(350, 10, 0.5)).toBe(0);
      // Midway between 10° and 350° is 0°
      expect(interpolateAngleShortestArc(10, 350, 0.5)).toBe(0);
      // Quarter way from 350° to 10° is 355°
      expect(interpolateAngleShortestArc(350, 10, 0.25)).toBe(355);
    });

    it("clamps interpolation parameter t to [0, 1]", () => {
      expect(interpolateAngleShortestArc(0, 90, -0.5)).toBe(0);
      expect(interpolateAngleShortestArc(0, 90, 1.5)).toBe(90);
    });
  });

  describe("calculateRelativeAzimuth", () => {
    it("calculates relative clockwise angle between target and heading", () => {
      // Facing North (0°), target East (90°) -> 90°
      expect(calculateRelativeAzimuth(90, 0)).toBe(90);
      // Facing East (90°), target North (0°) -> 270° (or -90° normalized)
      expect(calculateRelativeAzimuth(0, 90)).toBe(270);
      // Facing South (180°), target South (180°) -> 0°
      expect(calculateRelativeAzimuth(180, 180)).toBe(0);
    });

    it("handles non-finite inputs gracefully", () => {
      expect(calculateRelativeAzimuth(NaN, 100)).toBe(0);
      expect(calculateRelativeAzimuth(100, NaN)).toBe(0);
    });
  });
});
