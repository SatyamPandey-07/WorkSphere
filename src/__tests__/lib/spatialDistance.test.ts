import { describe, it, expect } from "vitest";
import {
  calculate3DDistance,
  applyDistanceSmoothing,
  formatElevationIndicator,
  isFiniteVector3,
  Vector3,
} from "../../types/ar";

describe("AR Seat Pointer Spatial Distance & Elevation Utilities (#4413)", () => {
  describe("calculate3DDistance", () => {
    it("calculates 3D Euclidean distance correctly for collinear points", () => {
      const userPos: Vector3 = { x: 0, y: 0, z: 0 };
      const targetPos: Vector3 = { x: 3, y: 4, z: 0 };

      const result = calculate3DDistance(userPos, targetPos);
      expect(result.distance3D).toBe(5);
      expect(result.horizontalDistance).toBe(3);
      expect(result.elevationDelta).toBe(4);
    });

    it("calculates 3D distance in full spatial 3D coordinates", () => {
      const userPos: Vector3 = { x: 1, y: 1, z: 1 };
      const targetPos: Vector3 = { x: 4, y: 5, z: 13 }; // dx=3, dy=4, dz=12 => sqrt(9+16+144) = sqrt(169) = 13

      const result = calculate3DDistance(userPos, targetPos);
      expect(result.distance3D).toBe(13);
      expect(result.horizontalDistance).toBeCloseTo(Math.sqrt(3 * 3 + 12 * 12), 4);
      expect(result.elevationDelta).toBe(4);
    });

    it("handles zero distance when target and user anchors overlap", () => {
      const pos: Vector3 = { x: 10.5, y: 2.0, z: -5.0 };
      const result = calculate3DDistance(pos, pos);

      expect(result.distance3D).toBe(0);
      expect(result.horizontalDistance).toBe(0);
      expect(result.elevationDelta).toBe(0);
    });

    it("handles negative elevation deltas (target on lower floor)", () => {
      const userPos: Vector3 = { x: 0, y: 6.0, z: 0 };
      const targetPos: Vector3 = { x: 0, y: 1.8, z: 0 };

      const result = calculate3DDistance(userPos, targetPos);
      expect(result.elevationDelta).toBe(-4.2);
    });
  });

  describe("applyDistanceSmoothing (Low-pass EMA Filter)", () => {
    it("returns rounded raw distance when no previous distance exists", () => {
      const smoothed = applyDistanceSmoothing(14.54, null, 0.2);
      expect(smoothed).toBe(14.5);
    });

    it("applies exponential moving average formula: S_k = alpha * X_k + (1 - alpha) * S_{k-1}", () => {
      // raw = 20, prev = 10, alpha = 0.2 => 0.2*20 + 0.8*10 = 4 + 8 = 12
      const smoothed = applyDistanceSmoothing(20, 10, 0.2);
      expect(smoothed).toBe(12);
    });

    it("filters out distance jitter across multiple iterations", () => {
      let current: number | null = null;
      const noisyInputs = [10.0, 12.0, 10.5, 11.8, 10.2];

      noisyInputs.forEach((raw) => {
        current = applyDistanceSmoothing(raw, current, 0.2);
      });

      expect(current).toBeGreaterThan(10.0);
      expect(current).toBeLessThan(11.5);
    });

    it("handles invalid or non-finite inputs gracefully", () => {
      expect(applyDistanceSmoothing(Number.NaN, 5.0)).toBe(0);
      expect(applyDistanceSmoothing(10.0, Number.NaN)).toBe(10.0);
    });
  });

  describe("formatElevationIndicator", () => {
    it("formats explicit floor level with elevation delta", () => {
      const result = formatElevationIndicator(4.2, 2);
      expect(result).toBe("Floor 2 (+4.2m)");
    });

    it("formats explicit floor level with negative elevation delta", () => {
      const result = formatElevationIndicator(-3.0, 1);
      expect(result).toBe("Floor 1 (-3.0m)");
    });

    it("formats 'Same Level' when elevation delta is under 0.5 meters", () => {
      const result = formatElevationIndicator(0.2);
      expect(result).toBe("Same Level (+0.2m)");
    });

    it("estimates floor count when explicit floor level is omitted", () => {
      const higherFloor = formatElevationIndicator(6.1);
      expect(higherFloor).toBe("+2 Fl (+6.1m)");

      const lowerFloor = formatElevationIndicator(-6.0);
      expect(lowerFloor).toBe("-2 Fl (-6.0m)");
    });
  });
});
