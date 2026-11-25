/**
 * src/__tests__/lib/heatmapTileAggregation.test.ts
 *
 * Verifies Web Mercator tile math, zoom-aware cell aggregation, boundary deduplication,
 * tile caching, and viewport-bounded database queries (#10166).
 */

import {
  validateTileCoordinates,
  tileToBoundingBox,
  latLngToTile,
  isPointInTileBounds,
} from "@/lib/geo/heatmapTile";
import {
  aggregateHeatmapTile,
  getHeatmapTileCacheKey,
  getOrComputeCachedTile,
  clearHeatmapTileCache,
  computeHeatmapWeight,
} from "@/lib/geo/heatmapAggregator";
import { GET } from "@/app/api/map/heatmap/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findMany: jest.fn(),
    },
    booking: {
      groupBy: jest.fn(),
    },
    venueRating: {
      groupBy: jest.fn(),
    },
  },
}));

describe("Viewport-Bounded PostGIS Heatmap Tiling & Zoom-Aware Aggregation (#10166)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearHeatmapTileCache();
  });

  describe("Web Mercator Tile Math & Boundary Validation", () => {
    it("validates legitimate zoom and tile coordinates", () => {
      expect(validateTileCoordinates(12, 655, 1582).valid).toBe(true);
      expect(validateTileCoordinates(0, 0, 0).valid).toBe(true);
    });

    it("rejects out-of-range or negative zoom levels and tile coordinates", () => {
      expect(validateTileCoordinates(-1, 0, 0).valid).toBe(false);
      expect(validateTileCoordinates(25, 0, 0).valid).toBe(false);
      expect(validateTileCoordinates(2, 4, 1).valid).toBe(false); // At z=2 max x is 3
      expect(validateTileCoordinates(2, 1, 4).valid).toBe(false); // At z=2 max y is 3
      expect(validateTileCoordinates(2, -1, 0).valid).toBe(false);
    });

    it("computes accurate bounding box for a Slippy map tile", () => {
      const bounds = tileToBoundingBox(12, 655, 1582);
      expect(bounds.minLat).toBeLessThan(bounds.maxLat);
      expect(bounds.minLng).toBeLessThan(bounds.maxLng);
      // San Francisco region at z=12
      expect(bounds.minLat).toBeCloseTo(37.788, 2);
      expect(bounds.minLng).toBeCloseTo(-122.431, 2);
    });

    it("prevents double-counting across shared tile boundaries via half-open interval", () => {
      const tile1Bounds = tileToBoundingBox(10, 100, 200);
      const tile2Bounds = tileToBoundingBox(10, 101, 200); // Adjacent to the right

      // Point right on the shared longitude boundary
      const boundaryLng = tile1Bounds.maxLng;
      expect(boundaryLng).toBeCloseTo(tile2Bounds.minLng, 5);

      const testLat = (tile1Bounds.minLat + tile1Bounds.maxLat) / 2;

      const inTile1 = isPointInTileBounds(testLat, boundaryLng, tile1Bounds);
      const inTile2 = isPointInTileBounds(testLat, boundaryLng, tile2Bounds);

      // Must be included in exactly one tile (not both, not neither)
      expect(inTile1 !== inTile2).toBe(true);
    });
  });

  describe("Zoom-Aware Spatial Aggregation Engine", () => {
    it("preserves exact venue coordinates at high zoom level (z >= 15)", () => {
      const bounds = tileToBoundingBox(16, 10487, 25324);
      const venues = [
        { id: "v1", latitude: 37.791, longitude: -122.402 },
        { id: "v2", latitude: 37.792, longitude: -122.403 },
      ];
      const activeBookings = new Map([
        ["v1", 2],
        ["v2", 0],
      ]);
      const noiseStats = new Map();

      const points = aggregateHeatmapTile({
        z: 16,
        x: 10487,
        y: 25324,
        bounds: {
          minLat: 37.79,
          maxLat: 37.795,
          minLng: -122.405,
          maxLng: -122.4,
        },
        venues,
        activeBookings,
        venueNoiseStats: noiseStats,
      });

      expect(points).toHaveLength(2);
      expect(points[0][0]).toBe(37.791);
      expect(points[0][1]).toBe(-122.402);
      expect(points[1][0]).toBe(37.792);
      expect(points[1][1]).toBe(-122.403);
    });

    it("merges nearby venues into subgrid cell centroids at lower zoom levels (z <= 10)", () => {
      const bounds = {
        minLat: 37.0,
        maxLat: 38.0,
        minLng: -123.0,
        maxLng: -122.0,
      };
      // Two very close venues in the same subcell
      const venues = [
        { id: "v1", latitude: 37.501, longitude: -122.501 },
        { id: "v2", latitude: 37.503, longitude: -122.503 },
      ];
      const activeBookings = new Map([
        ["v1", 1],
        ["v2", 3],
      ]);
      const noiseStats = new Map();

      const points = aggregateHeatmapTile({
        z: 8,
        x: 40,
        y: 98,
        bounds,
        venues,
        activeBookings,
        venueNoiseStats: noiseStats,
      });

      // Merged into single cell centroid
      expect(points).toHaveLength(1);
      expect(points[0][0]).toBeCloseTo(37.502, 3);
      expect(points[0][1]).toBeCloseTo(-122.502, 3);
    });

    it("returns empty array for tile containing no venues", () => {
      const bounds = tileToBoundingBox(12, 10, 10);
      const points = aggregateHeatmapTile({
        z: 12,
        x: 10,
        y: 10,
        bounds,
        venues: [],
        activeBookings: new Map(),
        venueNoiseStats: new Map(),
      });
      expect(points).toEqual([]);
    });

    it("evaluates deterministic weights within [0.1, 1.0]", () => {
      const w1 = computeHeatmapWeight(0);
      expect(w1).toBe(0.3); // 0.1 base + 0 bookings + 0.2 default noise

      const wMax = computeHeatmapWeight(100, { loud: 100, moderate: 0, quiet: 0, total: 100 });
      expect(wMax).toBe(1.0); // Clamped to 1.0
    });
  });

  describe("Tile Cache Layer & Request Coalescing", () => {
    it("caches tile results and serves subsequent calls from cache", async () => {
      let computeCalls = 0;
      const computeFn = async () => {
        computeCalls++;
        return [[37.77, -122.41, 0.5]] as [number, number, number][];
      };

      const key = getHeatmapTileCacheKey(12, 655, 1582, "2026-11-24");
      const r1 = await getOrComputeCachedTile(key, computeFn);
      const r2 = await getOrComputeCachedTile(key, computeFn);

      expect(r1).toEqual(r2);
      expect(computeCalls).toBe(1);
    });
  });

  describe("API Route /api/map/heatmap", () => {
    it("returns bounded tile response when zoom and tile coordinates are passed", async () => {
      const bounds = tileToBoundingBox(12, 655, 1582);

      (prisma.venue.findMany as jest.Mock).mockResolvedValue([
        { id: "v-sf-1", latitude: bounds.minLat + 0.01, longitude: bounds.minLng + 0.01 },
      ]);
      (prisma.booking.groupBy as jest.Mock).mockResolvedValue([
        { venueId: "v-sf-1", _count: { id: 3 } },
      ]);
      (prisma.venueRating.groupBy as jest.Mock).mockResolvedValue([]);

      const req = new Request("http://localhost:3000/api/map/heatmap?z=12&x=655&y=1582");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.tile).toBeDefined();
      expect(json.tile.z).toBe(12);
      expect(json.tile.x).toBe(655);
      expect(json.tile.y).toBe(1582);
      expect(json.data).toHaveLength(1);

      // Verify database queries were strictly restricted to tile bounding box
      expect(prisma.venue.findMany).toHaveBeenCalledWith({
        where: {
          latitude: { gte: bounds.minLat, lt: bounds.maxLat },
          longitude: { gte: bounds.minLng, lt: bounds.maxLng },
        },
        select: { id: true, latitude: true, longitude: true },
      });
      // Verify bookings were restricted only to the venueIds in this tile
      expect(prisma.booking.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            venueId: { in: ["v-sf-1"] },
          }),
        }),
      );
    });

    it("returns 400 Bad Request on invalid tile query parameters", async () => {
      const req = new Request("http://localhost:3000/api/map/heatmap?z=12&x=-999&y=1582");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it("preserves backward compatibility when called without tile params", async () => {
      (prisma.venue.findMany as jest.Mock).mockResolvedValue([
        { id: "v-global", latitude: 10.0, longitude: 20.0 },
      ]);
      (prisma.booking.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.venueRating.groupBy as jest.Mock).mockResolvedValue([]);

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data[0]).toEqual([10.0, 20.0, 0.3]);
    });
  });
});
