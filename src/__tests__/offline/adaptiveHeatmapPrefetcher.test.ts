import {
  calculatePanVelocity,
  get1RingNeighborTiles,
  prioritizeNeighborTiles,
  isSaveDataActive,
  isBatterySaverMode,
  AdaptiveHeatmapPrefetcher,
  DEFAULT_HEATMAP_TILE_TEMPLATE,
  type ViewportMovementEvent,
} from "@/lib/offline/adaptiveHeatmapPrefetcher";
import { tileKey, type TileCoordinate } from "@/lib/offline/mapTilePreloader";

describe("AdaptiveHeatmapPrefetcher Unit Tests", () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    jest.clearAllMocks();
  });

  describe("1. Velocity and Direction Calculations", () => {
    it("returns zero velocity for fewer than 2 movement points", () => {
      const v0 = calculatePanVelocity([]);
      expect(v0.speed).toBe(0);
      expect(v0.vx).toBe(0);
      expect(v0.vy).toBe(0);

      const v1 = calculatePanVelocity([
        { center: { lat: 37.7749, lng: -122.4194 }, zoom: 12, timestamp: 1000 },
      ]);
      expect(v1.speed).toBe(0);
    });

    it("calculates positive eastward (positive X) pan velocity", () => {
      const movements: ViewportMovementEvent[] = [
        { center: { lat: 37.7749, lng: -122.4194 }, zoom: 12, timestamp: 1000 },
        { center: { lat: 37.7749, lng: -122.4094 }, zoom: 12, timestamp: 1200 }, // moved East
      ];

      const v = calculatePanVelocity(movements);
      expect(v.vx).toBeGreaterThan(0);
      expect(v.speed).toBeGreaterThan(0);
      expect(Math.abs(v.vy)).toBeLessThan(0.0001);
      // Direction angle should be around 0 radians for pure East
      expect(Math.abs(v.directionAngle)).toBeLessThan(0.1);
    });

    it("calculates southward (positive Y in Mercator) pan velocity", () => {
      const movements: ViewportMovementEvent[] = [
        { center: { lat: 37.7749, lng: -122.4194 }, zoom: 12, timestamp: 1000 },
        { center: { lat: 37.7649, lng: -122.4194 }, zoom: 12, timestamp: 1200 }, // moved South
      ];

      const v = calculatePanVelocity(movements);
      expect(v.vy).toBeGreaterThan(0);
      expect(v.speed).toBeGreaterThan(0);
    });

    it("handles zero or negative dt cleanly", () => {
      const movements: ViewportMovementEvent[] = [
        { center: { lat: 37.7749, lng: -122.4194 }, zoom: 12, timestamp: 1000 },
        { center: { lat: 37.7649, lng: -122.4194 }, zoom: 12, timestamp: 1000 },
      ];
      const v = calculatePanVelocity(movements);
      expect(v.speed).toBe(0);
    });
  });

  describe("2. Neighbor Tile Selection (1-Ring)", () => {
    it("generates 8 neighboring tiles surrounding the center tile", () => {
      const center: TileCoordinate = { x: 100, y: 150, z: 12 };
      const neighbors = get1RingNeighborTiles(center);

      expect(neighbors).toHaveLength(8);
      // Ensure center itself is excluded
      const hasCenter = neighbors.some((n) => n.x === center.x && n.y === center.y);
      expect(hasCenter).toBe(false);

      // Verify coordinate range
      neighbors.forEach((n) => {
        expect(n.z).toBe(12);
        expect(Math.abs(n.x - center.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(n.y - center.y)).toBeLessThanOrEqual(1);
      });
    });

    it("handles longitudinal wrapping at antimeridian (x = 0 and x = max)", () => {
      const centerAtLeftEdge: TileCoordinate = { x: 0, y: 10, z: 4 };
      const maxCoord = Math.pow(2, 4) - 1; // 15
      const neighbors = get1RingNeighborTiles(centerAtLeftEdge);

      const wrappedLeft = neighbors.filter((n) => n.x === maxCoord);
      expect(wrappedLeft.length).toBeGreaterThan(0);
    });
  });

  describe("3. Prefetch Prioritization", () => {
    it("ranks tiles aligned with movement direction ahead of opposing tiles", () => {
      const center: TileCoordinate = { x: 100, y: 100, z: 12 };
      const neighbors = get1RingNeighborTiles(center);

      // Panning East (+X, vx > 0, vy = 0)
      const eastVelocity = { vx: 0.05, vy: 0, speed: 0.05, directionAngle: 0 };
      const prioritized = prioritizeNeighborTiles(neighbors, center, eastVelocity);

      expect(prioritized.length).toBe(8);

      const topTile = prioritized[0];
      // Top tile should have x > center.x (East)
      expect(topTile.tile.x).toBeGreaterThan(center.x);
      expect(topTile.dotProduct).toBeGreaterThan(0);

      const bottomTile = prioritized[prioritized.length - 1];
      // Trailing tile should have x < center.x (West)
      expect(bottomTile.tile.x).toBeLessThan(center.x);
      expect(bottomTile.dotProduct).toBeLessThan(0);
    });

    it("correctly constructs formatted tile URLs", () => {
      const center: TileCoordinate = { x: 50, y: 60, z: 10 };
      const neighbors = [{ x: 51, y: 60, z: 10 }];
      const res = prioritizeNeighborTiles(neighbors, center, {
        vx: 0.01,
        vy: 0,
        speed: 0.01,
        directionAngle: 0,
      });

      expect(res[0].url).toBe("https://tiles.worksphere.internal/heatmap/10/51/60.pbf");
    });
  });

  describe("4. Idle Scheduling and Execution", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("schedules prefetch during idle frame with fallback setTimeout", async () => {
      const mockFetch = jest.fn().mockResolvedValue(new ArrayBuffer(8));
      const prefetcher = new AdaptiveHeatmapPrefetcher({
        fetchTile: mockFetch,
      });

      // Viewport moves
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.41 }, 12, 1000);
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.40 }, 12, 1100);

      expect(prefetcher.getQueueLength()).toBeGreaterThan(0);

      // Run fake timer fallback
      jest.advanceTimersByTime(20);

      await Promise.resolve(); // drain microtasks

      expect(mockFetch).toHaveBeenCalled();
      prefetcher.dispose();
    });

    it("uses native requestIdleCallback when present", async () => {
      const mockFetch = jest.fn().mockResolvedValue(new ArrayBuffer(8));
      const mockRequestIdleCallback = jest.fn((cb) => {
        cb({ timeRemaining: () => 10 });
        return 12345;
      });

      (window as any).requestIdleCallback = mockRequestIdleCallback;

      const prefetcher = new AdaptiveHeatmapPrefetcher({
        fetchTile: mockFetch,
      });

      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.41 }, 12, 1000);
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.39 }, 12, 1100);

      expect(mockRequestIdleCallback).toHaveBeenCalled();
      prefetcher.dispose();
      delete (window as any).requestIdleCallback;
    });
  });

  describe("5. Restrictions: Save-Data and Battery-Saver", () => {
    it("disables speculative prefetching completely when saveData is true", async () => {
      Object.defineProperty(global, "navigator", {
        value: {
          connection: { saveData: true },
        },
        writable: true,
        configurable: true,
      });

      expect(isSaveDataActive()).toBe(true);

      const mockFetch = jest.fn();
      const prefetcher = new AdaptiveHeatmapPrefetcher({ fetchTile: mockFetch });

      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.41 }, 12, 1000);
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.39 }, 12, 1100);

      expect(prefetcher.getQueueLength()).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
      prefetcher.dispose();
    });

    it("restricts prefetch queue size when battery-saver mode is active", async () => {
      Object.defineProperty(global, "navigator", {
        value: {
          getBattery: jest.fn().mockResolvedValue({
            charging: false,
            level: 0.15, // 15% battery
          }),
        },
        writable: true,
        configurable: true,
      });

      const isLow = await isBatterySaverMode();
      expect(isLow).toBe(true);

      const prefetcher = new AdaptiveHeatmapPrefetcher();
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.41 }, 12, 1000);
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.39 }, 12, 1100);

      // Should be limited to top 2 tiles max
      expect(prefetcher.getQueueLength()).toBeLessThanOrEqual(2);
      prefetcher.dispose();
    });
  });

  describe("6. Cancellation on Zoom Changes", () => {
    it("cancels stale queued and in-flight prefetches when zoom changes", async () => {
      let abortTriggered = false;
      const mockFetch = jest.fn((url: string, signal: AbortSignal) => {
        signal.addEventListener("abort", () => {
          abortTriggered = true;
        });
        return new Promise(() => {}); // never resolves to keep in flight
      });

      const prefetcher = new AdaptiveHeatmapPrefetcher({ fetchTile: mockFetch });

      // Start on zoom 12
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.41 }, 12, 1000);
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.39 }, 12, 1100);

      // Zoom in to 14
      await prefetcher.onViewportChange({ lat: 37.77, lng: -122.39 }, 14, 1200);

      // The queued tiles for zoom 12 should have been purged
      const queued = prefetcher.getQueuedTiles();
      queued.forEach((t) => {
        expect(t.tile.z).toBe(14);
      });

      prefetcher.dispose();
    });
  });

  describe("7. Duplicate Request Prevention and Cleanup", () => {
    it("does not re-queue already cached tiles", async () => {
      const mockFetch = jest.fn().mockResolvedValue(new ArrayBuffer(8));
      const prefetcher = new AdaptiveHeatmapPrefetcher({ fetchTile: mockFetch });

      const center = { lat: 37.7749, lng: -122.4194 };
      await prefetcher.onViewportChange(center, 12, 1000);

      // Manually mark all neighbors as cached
      const centerTile = { x: 654, y: 1582, z: 12 };
      get1RingNeighborTiles(centerTile).forEach((t) => {
        prefetcher.markCached(tileKey(t.z, t.x, t.y));
      });

      await prefetcher.onViewportChange({ lat: 37.7749, lng: -122.4184 }, 12, 1100);

      expect(prefetcher.getQueueLength()).toBe(0);
      prefetcher.dispose();
    });

    it("cleans up all in-flight abort controllers and queues on dispose", () => {
      const prefetcher = new AdaptiveHeatmapPrefetcher();
      prefetcher.dispose();

      expect(prefetcher.getQueueLength()).toBe(0);
      expect(prefetcher.getInflightCount()).toBe(0);
    });
  });
});
