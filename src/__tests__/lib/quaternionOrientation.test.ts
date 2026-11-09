import {
  eulerToQuaternion,
  quaternionToRotationMatrix,
  quaternionSlerp,
  quaternionToHeading,
  isGimbalLockProne,
  QuaternionOrientationFilter,
  normalizeQuaternion,
} from "@/lib/spatial/quaternionOrientation";

describe("quaternionOrientation utilities", () => {
  describe("normalizeQuaternion", () => {
    it("normalizes non-unit quaternions and returns identity for zero vectors", () => {
      const zero = normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 });
      expect(zero).toEqual({ x: 0, y: 0, z: 0, w: 1 });

      const normalized = normalizeQuaternion({ x: 2, y: 0, z: 0, w: 0 });
      expect(normalized).toEqual({ x: 1, y: 0, z: 0, w: 0 });
    });
  });

  describe("eulerToQuaternion", () => {
    it("produces a normalized unit quaternion for zero rotation", () => {
      const q = eulerToQuaternion(0, 0, 0);
      expect(q.x).toBeCloseTo(0);
      expect(q.y).toBeCloseTo(0);
      expect(q.z).toBeCloseTo(0);
      expect(q.w).toBeCloseTo(1);
    });

    it("handles null and undefined angles gracefully by falling back to 0", () => {
      const q = eulerToQuaternion(null, undefined, NaN);
      expect(q.x).toBeCloseTo(0);
      expect(q.y).toBeCloseTo(0);
      expect(q.z).toBeCloseTo(0);
      expect(q.w).toBeCloseTo(1);
    });

    it("produces unit length (|q| = 1) for arbitrary rotations", () => {
      const q = eulerToQuaternion(123.4, 45.6, -23.1);
      const len = Math.hypot(q.x, q.y, q.z, q.w);
      expect(len).toBeCloseTo(1, 6);
    });
  });

  describe("quaternionToRotationMatrix", () => {
    it("produces identity matrix for identity quaternion", () => {
      const R = quaternionToRotationMatrix({ x: 0, y: 0, z: 0, w: 1 });
      expect(R[0][0]).toBeCloseTo(1);
      expect(R[1][1]).toBeCloseTo(1);
      expect(R[2][2]).toBeCloseTo(1);
      expect(R[0][1]).toBeCloseTo(0);
      expect(R[1][0]).toBeCloseTo(0);
    });
  });

  describe("quaternionSlerp", () => {
    it("interpolates halfway between two orthogonal quaternions", () => {
      const q1 = { x: 0, y: 0, z: 0, w: 1 };
      // 90 deg rotation around Z: half angle 45 deg -> sin(45)=sqrt(2)/2, cos(45)=sqrt(2)/2
      const q2 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };

      const half = quaternionSlerp(q1, q2, 0.5);
      // Halfway is 45 deg rotation around Z: half angle 22.5 deg
      expect(half.z).toBeCloseTo(Math.sin((22.5 * Math.PI) / 180), 3);
      expect(half.w).toBeCloseTo(Math.cos((22.5 * Math.PI) / 180), 3);
    });

    it("takes the shortest arc when dot product is negative (double-cover handling)", () => {
      const q1 = { x: 0, y: 0, z: 0, w: 1 };
      // -q1 represents the exact same physical rotation but with negative sign
      const q2 = { x: 0, y: 0, z: 0, w: -1 };

      const interpolated = quaternionSlerp(q1, q2, 0.5);
      const len = Math.hypot(
        interpolated.x,
        interpolated.y,
        interpolated.z,
        interpolated.w,
      );
      expect(len).toBeCloseTo(1);
      // Does not collapse to zero
      expect(Math.abs(interpolated.w)).toBeCloseTo(1);
    });
  });

  describe("quaternionToHeading without gimbal lock singularities", () => {
    it("computes accurate cardinal headings when device is held flat (beta = 0)", () => {
      // Flat device: alpha corresponds to heading = (360 - alpha) % 360
      // North: alpha = 0 -> heading = 0
      const qNorth = eulerToQuaternion(0, 0, 0);
      expect(quaternionToHeading(qNorth)).toBeCloseTo(0, 1);

      // East: alpha = 270 -> heading = 90
      const qEast = eulerToQuaternion(270, 0, 0);
      expect(quaternionToHeading(qEast)).toBeCloseTo(90, 1);

      // South: alpha = 180 -> heading = 180
      const qSouth = eulerToQuaternion(180, 0, 0);
      expect(quaternionToHeading(qSouth)).toBeCloseTo(180, 1);

      // West: alpha = 90 -> heading = 270
      const qWest = eulerToQuaternion(90, 0, 0);
      expect(quaternionToHeading(qWest)).toBeCloseTo(270, 1);
    });

    it("maintains stable heading when tilting phone from horizontal (0°) to vertical (90°) and past vertical", () => {
      // Facing North-East (heading 45°, alpha = 315°)
      const alpha = 315;
      const expectedHeading = 45;

      const pitches = [0, 15, 30, 45, 60, 75, 85, 89, 90, 91, 95];

      for (const pitch of pitches) {
        const q = eulerToQuaternion(alpha, pitch, 0);
        const heading = quaternionToHeading(q);
        expect(heading).toBeCloseTo(expectedHeading, 1);
      }
    });

    it("does not flip 180° near pitch ±90° where Euler angles experience gimbal lock", () => {
      const alpha = 270; // Heading 90° (East)
      const q89 = eulerToQuaternion(alpha, 89, 0);
      const q90 = eulerToQuaternion(alpha, 90, 0);
      const q91 = eulerToQuaternion(alpha, 91, 0);

      const h89 = quaternionToHeading(q89);
      const h90 = quaternionToHeading(q90);
      const h91 = quaternionToHeading(q91);

      expect(h89).toBeCloseTo(90, 1);
      expect(h90).toBeCloseTo(90, 1);
      expect(h91).toBeCloseTo(90, 1);

      // Absolute difference between h89 and h91 must be minimal, NOT ~180°
      expect(Math.abs(h91 - h89)).toBeLessThan(1);
    });
  });

  describe("isGimbalLockProne", () => {
    it("identifies pitch angles near ±90°", () => {
      expect(isGimbalLockProne(85)).toBe(true);
      expect(isGimbalLockProne(90)).toBe(true);
      expect(isGimbalLockProne(-88)).toBe(true);
      expect(isGimbalLockProne(0)).toBe(false);
      expect(isGimbalLockProne(45)).toBe(false);
      expect(isGimbalLockProne(null)).toBe(false);
    });
  });

  describe("QuaternionOrientationFilter", () => {
    it("smooths consecutive Euler readings with SLERP and converges to target heading", () => {
      const filter = new QuaternionOrientationFilter(0.2);

      // Initial reading pointing North (alpha = 0, beta = 0, gamma = 0) -> heading 0
      const initial = filter.update(0, 0, 0);
      expect(initial).toBeCloseTo(0, 1);

      // Step change towards East (alpha = 270 -> target heading 90)
      const step1 = filter.update(270, 0, 0);
      expect(step1).toBeGreaterThan(0);
      expect(step1).toBeLessThan(90);

      // Multiple updates converge to 90
      for (let s = 0; s < 40; s++) {
        filter.update(270, 0, 0);
      }
      const finalH = filter.update(270, 0, 0);
      expect(finalH).toBeCloseTo(90, 1);
    });

    it("resets filter state", () => {
      const filter = new QuaternionOrientationFilter();
      filter.update(45, 10, 0);
      expect(filter.getCurrentQuaternion()).not.toBeNull();

      filter.reset();
      expect(filter.getCurrentQuaternion()).toBeNull();
    });
  });
});
