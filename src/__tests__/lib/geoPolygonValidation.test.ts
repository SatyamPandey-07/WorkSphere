import {
  isPolygonRingClosed,
  ensurePolygonRingClosed,
  doSegmentsIntersect,
  hasPolygonSelfIntersection,
  validatePolygonRing,
  computeConvexHull,
  repairSelfIntersectingPolygon,
  ensureCounterClockwise,
  generateFolderBoundingPolygon,
} from "@/lib/folderGeoExport";

describe("GeoJSON Polygon Boundary Validation & Self-Intersection (#4925)", () => {
  // Standard valid counter-clockwise rectangular ring [lng, lat]
  const validRectangleRing: number[][] = [
    [-122.42, 37.77],
    [-122.40, 37.77],
    [-122.40, 37.79],
    [-122.42, 37.79],
    [-122.42, 37.77],
  ];

  // Classic bow-tie / figure-8 self-intersecting polygon
  const bowtieRing: number[][] = [
    [-122.42, 37.77],
    [-122.40, 37.79],
    [-122.40, 37.77],
    [-122.42, 37.79],
    [-122.42, 37.77],
  ];

  // Complex 5-pointed star (pentagram) with multiple self-intersecting edges
  const complexStarRing: number[][] = [
    [0, 10],
    [2.24, -3.09],
    [-3.63, 2.63],
    [3.63, 2.63],
    [-2.24, -3.09],
    [0, 10],
  ];

  describe("Linear Ring Closedness", () => {
    it("recognizes a closed linear ring with identical first and last vertices", () => {
      expect(isPolygonRingClosed(validRectangleRing)).toBe(true);
    });

    it("rejects an open ring where first and last vertices do not match", () => {
      const openRing = validRectangleRing.slice(0, -1);
      expect(isPolygonRingClosed(openRing)).toBe(false);

      const validation = validatePolygonRing(openRing);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toMatch(/linear ring is not closed/i);
    });

    it("rejects rings with fewer than 4 positions", () => {
      expect(isPolygonRingClosed([[0, 0], [1, 1], [0, 0]])).toBe(false);
      const validation = validatePolygonRing([[0, 0], [1, 1], [0, 0]]);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toMatch(/at least 4 coordinate positions/i);
    });

    it("enforces ring closure via ensurePolygonRingClosed", () => {
      const openRing = [
        [-122.42, 37.77],
        [-122.40, 37.77],
        [-122.40, 37.79],
        [-122.42, 37.79],
      ];
      const closed = ensurePolygonRingClosed(openRing);
      expect(isPolygonRingClosed(closed)).toBe(true);
      expect(closed).toHaveLength(5);
      expect(closed[0]).toEqual(closed[4]);
    });
  });

  describe("Segment Intersection & Self-Intersection Detection", () => {
    it("detects when two crossing line segments intersect", () => {
      expect(
        doSegmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0])
      ).toBe(true);
    });

    it("allows adjacent polygon edges sharing a common endpoint without false positive", () => {
      expect(
        doSegmentsIntersect([0, 0], [5, 0], [5, 0], [5, 5], true)
      ).toBe(false);
    });

    it("detects collinear overlapping edges as intersecting", () => {
      expect(
        doSegmentsIntersect([0, 0], [10, 0], [5, 0], [15, 0], false)
      ).toBe(true);
    });

    it("confirms valid simple polygons do not have self-intersections", () => {
      expect(hasPolygonSelfIntersection(validRectangleRing)).toBe(false);
      expect(validatePolygonRing(validRectangleRing).isValid).toBe(true);
    });

    it("detects self-intersection in bow-tie polygon", () => {
      expect(hasPolygonSelfIntersection(bowtieRing)).toBe(true);
      const res = validatePolygonRing(bowtieRing);
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/self-intersects/i);
    });

    it("detects multiple self-intersections in complex 5-pointed star polygon", () => {
      expect(hasPolygonSelfIntersection(complexStarRing)).toBe(true);
      const res = validatePolygonRing(complexStarRing);
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/self-intersects/i);
    });
  });

  describe("Geometry Repair & RFC 7946 Compliance", () => {
    it("simplifies self-intersecting bow-tie into a valid convex boundary", () => {
      const repaired = repairSelfIntersectingPolygon(bowtieRing);
      expect(isPolygonRingClosed(repaired)).toBe(true);
      expect(hasPolygonSelfIntersection(repaired)).toBe(false);
      const res = validatePolygonRing(repaired);
      expect(res.isValid).toBe(true);
    });

    it("simplifies complex intersecting star into a valid non-self-intersecting hull", () => {
      const repaired = repairSelfIntersectingPolygon(complexStarRing);
      expect(isPolygonRingClosed(repaired)).toBe(true);
      expect(hasPolygonSelfIntersection(repaired)).toBe(false);
      expect(validatePolygonRing(repaired).isValid).toBe(true);
    });

    it("enforces counter-clockwise right-hand rule on exterior rings", () => {
      // Clockwise rectangle
      const clockwiseRing = [
        [-122.42, 37.77],
        [-122.42, 37.79],
        [-122.40, 37.79],
        [-122.40, 37.77],
        [-122.42, 37.77],
      ];
      const ccw = ensureCounterClockwise(clockwiseRing);
      expect(isPolygonRingClosed(ccw)).toBe(true);
      expect(validatePolygonRing(ccw).isValid).toBe(true);
    });

    it("generates a valid RFC 7946 GeoJSON Feature bounding polygon", () => {
      const feature = generateFolderBoundingPolygon([
        { id: "v1", name: "Venue 1", latitude: 37.77, longitude: -122.42, category: "cafe" },
        { id: "v2", name: "Venue 2", latitude: 37.79, longitude: -122.40, category: "office" },
        { id: "v3", name: "Venue 3", latitude: 37.78, longitude: -122.41, category: "library" },
      ], { folderName: "San Francisco Hubs" });

      expect(feature).not.toBeNull();
      expect(feature?.type).toBe("Feature");
      expect(feature?.geometry.type).toBe("Polygon");
      expect(Array.isArray(feature?.geometry.coordinates)).toBe(true);

      const ring = feature?.geometry.coordinates[0]!;
      expect(isPolygonRingClosed(ring)).toBe(true);
      expect(hasPolygonSelfIntersection(ring)).toBe(false);
      expect(validatePolygonRing(ring).isValid).toBe(true);
    });

    it("repairs raw intersecting boundary coordinates in generateFolderBoundingPolygon", () => {
      const feature = generateFolderBoundingPolygon(bowtieRing, {
        folderName: "Bowtie Collection",
      });

      expect(feature).not.toBeNull();
      expect(feature?.geometry.type).toBe("Polygon");
      const ring = feature?.geometry.coordinates[0]!;
      expect(isPolygonRingClosed(ring)).toBe(true);
      expect(hasPolygonSelfIntersection(ring)).toBe(false);
      expect(validatePolygonRing(ring).isValid).toBe(true);
    });
  });
});
