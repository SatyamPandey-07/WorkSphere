import { cn, calculateHaversineDistance } from "@/lib/utils";

describe("Utils", () => {
  describe("cn (classnames utility)", () => {
    it("merges class names correctly", () => {
      const result = cn("class1", "class2");
      expect(result).toBe("class1 class2");
    });

    it("handles conditional classes", () => {
      const isActive = true;
      const result = cn("base", isActive && "active");
      expect(result).toBe("base active");
    });

    it("filters out falsy values", () => {
      const result = cn("base", false, null, undefined, "valid");
      expect(result).toBe("base valid");
    });

    it("handles tailwind merge conflicts", () => {
      const result = cn("px-2 py-1", "px-4");
      expect(result).toBe("py-1 px-4");
    });

    it("handles empty input", () => {
      const result = cn();
      expect(result).toBe("");
    });

    it("handles array of classes", () => {
      const result = cn(["class1", "class2"]);
      expect(result).toContain("class1");
      expect(result).toContain("class2");
    });
  });

  describe("calculateHaversineDistance", () => {
    it("returns 0 for the same point", () => {
      const dist = calculateHaversineDistance(
        40.7128,
        -74.006,
        40.7128,
        -74.006,
      );
      expect(dist).toBe(0);
    });

    it("calculates expected distance between two distinct points", () => {
      // SF downtown to Oakland (approx 13km)
      const sfLat = 37.7749,
        sfLng = -122.4194;
      const oakLat = 37.8044,
        oakLng = -122.2712;
      const dist = calculateHaversineDistance(sfLat, sfLng, oakLat, oakLng);
      // It should be roughly 13.4 km
      expect(dist).toBeGreaterThan(13);
      expect(dist).toBeLessThan(14);
    });

    it("is symmetric", () => {
      const sfLat = 37.7749,
        sfLng = -122.4194;
      const oakLat = 37.8044,
        oakLng = -122.2712;
      const dist1 = calculateHaversineDistance(sfLat, sfLng, oakLat, oakLng);
      const dist2 = calculateHaversineDistance(oakLat, oakLng, sfLat, sfLng);
      expect(dist1).toBeCloseTo(dist2, 5);
    });
  });
});
