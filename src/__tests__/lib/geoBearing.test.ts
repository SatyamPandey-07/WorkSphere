import {
  calculateBearing,
  calculateRelativeBearing,
  formatDistance,
  getCompassDirection,
  getRelativeDirectionDescription,
} from "@/lib/geo";

describe("geo utilities", () => {
  describe("calculateBearing", () => {
    it("calculates bearing directly north as 0 degrees", () => {
      const bearing = calculateBearing(0, 0, 10, 0);
      expect(bearing).toBe(0);
    });

    it("calculates bearing directly east as 90 degrees", () => {
      const bearing = calculateBearing(0, 0, 0, 10);
      expect(bearing).toBe(90);
    });

    it("calculates bearing directly south as 180 degrees", () => {
      const bearing = calculateBearing(10, 0, 0, 0);
      expect(bearing).toBe(180);
    });

    it("calculates bearing directly west as 270 degrees", () => {
      const bearing = calculateBearing(0, 10, 0, 0);
      expect(bearing).toBe(270);
    });

    it("calculates northeast bearing between known cities", () => {
      // New York (40.7128, -74.0060) to Boston (42.3601, -71.0589) ~ 52 degrees
      const bearing = calculateBearing(40.7128, -74.006, 42.3601, -71.0589);
      expect(Math.round(bearing)).toBe(52);
    });
  });

  describe("calculateRelativeBearing", () => {
    it("returns 0 when heading equals target bearing (facing target directly)", () => {
      expect(calculateRelativeBearing(90, 90)).toBe(0);
    });

    it("returns 90 when target is 90 degrees to the right", () => {
      expect(calculateRelativeBearing(90, 0)).toBe(90);
    });

    it("returns 180 when target is directly behind the user", () => {
      expect(calculateRelativeBearing(180, 0)).toBe(180);
      expect(calculateRelativeBearing(0, 180)).toBe(180);
    });

    it("returns 270 when target is 90 degrees to the left", () => {
      expect(calculateRelativeBearing(0, 90)).toBe(270);
    });

    it("handles wrap-around across 360 degrees correctly", () => {
      // Target at 10 deg, Heading at 350 deg -> Relative is 20 deg to the right
      expect(calculateRelativeBearing(10, 350)).toBe(20);
      // Target at 350 deg, Heading at 10 deg -> Relative is 340 deg (20 deg to the left)
      expect(calculateRelativeBearing(350, 10)).toBe(340);
    });
  });

  describe("formatDistance", () => {
    it("formats distances under 1 km in meters", () => {
      expect(formatDistance(0.045)).toBe("45 m");
      expect(formatDistance(0.5)).toBe("500 m");
    });

    it("formats distances 1 km and above in kilometers", () => {
      expect(formatDistance(1.23)).toBe("1.2 km");
      expect(formatDistance(14.8)).toBe("14.8 km");
    });

    it("returns -- for invalid distance", () => {
      expect(formatDistance(-1)).toBe("--");
      expect(formatDistance(NaN)).toBe("--");
    });
  });

  describe("getCompassDirection", () => {
    it("returns correct cardinal points", () => {
      expect(getCompassDirection(0)).toBe("N");
      expect(getCompassDirection(90)).toBe("E");
      expect(getCompassDirection(180)).toBe("S");
      expect(getCompassDirection(270)).toBe("W");
      expect(getCompassDirection(45)).toBe("NE");
      expect(getCompassDirection(225)).toBe("SW");
    });

    it("returns -- when heading is null or NaN", () => {
      expect(getCompassDirection(null)).toBe("--");
      expect(getCompassDirection(NaN)).toBe("--");
    });
  });

  describe("getRelativeDirectionDescription", () => {
    it("identifies straight ahead when relative bearing is near 0", () => {
      expect(getRelativeDirectionDescription(0)).toBe("Straight Ahead");
      expect(getRelativeDirectionDescription(10)).toBe("Straight Ahead");
      expect(getRelativeDirectionDescription(350)).toBe("Straight Ahead");
    });

    it("identifies turns appropriately", () => {
      expect(getRelativeDirectionDescription(45)).toBe("Turn Slight Right");
      expect(getRelativeDirectionDescription(90)).toBe("Turn Right");
      expect(getRelativeDirectionDescription(135)).toBe("Turn Sharp Right");
      expect(getRelativeDirectionDescription(180)).toBe("Behind You");
      expect(getRelativeDirectionDescription(225)).toBe("Turn Sharp Left");
      expect(getRelativeDirectionDescription(270)).toBe("Turn Left");
      expect(getRelativeDirectionDescription(315)).toBe("Turn Slight Left");
    });

    it("returns empty string when relative bearing is null", () => {
      expect(getRelativeDirectionDescription(null)).toBe("");
    });
  });
});
