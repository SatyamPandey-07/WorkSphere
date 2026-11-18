import {
  latLngToTile,
  generateTileUrlsForBounds,
  createBoundsFromPoint,
  isBackgroundFetchSupported,
  preloadMapTiles,
  preloadTilesForDestinations,
  getCachedMapTile,
  clearOfflineMapTileCache,
  MAP_TILES_CACHE_NAME,
} from "@/lib/offline/mapTilePreloader";

describe("mapTilePreloader Background Fetch & Vector Tile Caching (#6490)", () => {
  const sfCenter = { lat: 37.7749, lng: -122.4194 };

  describe("latLngToTile Slippy Map Calculations", () => {
    it("converts San Francisco coordinates accurately to tile coordinates at zoom 12", () => {
      const tile = latLngToTile(sfCenter.lat, sfCenter.lng, 12);
      expect(tile.z).toBe(12);
      expect(tile.x).toBe(655);
      expect(tile.y).toBe(1582);
    });

    it("converts San Francisco coordinates accurately at zoom 16", () => {
      const tile = latLngToTile(sfCenter.lat, sfCenter.lng, 16);
      expect(tile.z).toBe(16);
      expect(tile.x).toBe(10487);
      expect(tile.y).toBe(25324);
    });

    it("clamps coordinates within valid tile grid bounds", () => {
      const northPole = latLngToTile(90, 0, 12);
      expect(northPole.y).toBe(0);

      const southPole = latLngToTile(-90, 0, 12);
      expect(southPole.y).toBe(Math.pow(2, 12) - 1);
    });
  });

  describe("generateTileUrlsForBounds", () => {
    it("generates vector tile URLs matching zoom levels 12-16", () => {
      const bounds = createBoundsFromPoint(sfCenter.lat, sfCenter.lng, 1);
      const urls = generateTileUrlsForBounds(bounds, 12, 14);

      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0]).toMatch(/https:\/\/tiles\.worksphere\.internal\/\d+\/\d+\/\d+\.pbf/);
      expect(urls.some((u) => u.includes("/12/"))).toBe(true);
      expect(urls.some((u) => u.includes("/14/"))).toBe(true);
    });

    it("respects maxTiles cap to prevent excessive downloads", () => {
      const bounds = createBoundsFromPoint(sfCenter.lat, sfCenter.lng, 50);
      const maxTiles = 15;
      const urls = generateTileUrlsForBounds(bounds, 12, 16, undefined, maxTiles);

      expect(urls.length).toBe(maxTiles);
    });
  });

  describe("isBackgroundFetchSupported Feature Detection", () => {
    const originalWindow = global.window;
    const originalNavigator = global.navigator;

    afterEach(() => {
      (global as any).window = originalWindow;
      (global as any).navigator = originalNavigator;
    });

    it("returns false when BackgroundFetchManager is not present", () => {
      expect(isBackgroundFetchSupported()).toBe(false);
    });

    it("returns true when serviceWorker and BackgroundFetchManager are present", () => {
      (global as any).window = {
        BackgroundFetchManager: function () {},
      };
      (global as any).navigator = {
        serviceWorker: {},
      };

      expect(isBackgroundFetchSupported()).toBe(true);
    });
  });

  describe("preloadMapTiles & CacheStorage Fallback", () => {
    let mockCache: {
      put: jest.Mock;
      match: jest.Mock;
      delete: jest.Mock;
    };

    beforeEach(() => {
      mockCache = {
        put: jest.fn().mockResolvedValue(undefined),
        match: jest.fn().mockResolvedValue(new Response("tile-data")),
        delete: jest.fn().mockResolvedValue(true),
      };

      (global as any).caches = {
        open: jest.fn().mockResolvedValue(mockCache),
        delete: jest.fn().mockResolvedValue(true),
      };

      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        clone: () => new Response("tile-bytes"),
      });
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("uses standard fetch fallback when BackgroundFetchManager is unavailable", async () => {
      const urls = [
        "https://tiles.worksphere.internal/12/655/1582.pbf",
        "https://tiles.worksphere.internal/12/656/1582.pbf",
      ];

      const res = await preloadMapTiles(urls);

      expect(res.success).toBe(true);
      expect(res.method).toBe("STANDARD_FETCH");
      expect(res.tileCount).toBe(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(mockCache.put).toHaveBeenCalledTimes(2);
    });

    it("uses BackgroundFetchManager when supported", async () => {
      const mockBackgroundFetch = {
        fetch: jest.fn().mockResolvedValue({ id: "mock-fetch" }),
      };

      (global as any).window = {
        BackgroundFetchManager: function () {},
      };
      (global as any).navigator = {
        serviceWorker: {
          ready: Promise.resolve({
            backgroundFetch: mockBackgroundFetch,
          }),
        },
      };

      const urls = ["https://tiles.worksphere.internal/12/655/1582.pbf"];
      const res = await preloadMapTiles(urls);

      expect(res.success).toBe(true);
      expect(res.method).toBe("BACKGROUND_FETCH");
      expect(mockBackgroundFetch.fetch).toHaveBeenCalled();
    });

    it("preloads tiles for user destination bookmarks", async () => {
      const bookmarks = [
        { id: "dest-1", name: "SF Workspace HQ", lat: sfCenter.lat, lng: sfCenter.lng, radiusKm: 1 },
      ];

      const res = await preloadTilesForDestinations(bookmarks, { maxTiles: 5 });
      expect(res.success).toBe(true);
      expect(res.urls.length).toBeLessThanOrEqual(5);
    });

    it("retrieves cached map tile and clears cache", async () => {
      const match = await getCachedMapTile("https://tiles.worksphere.internal/12/655/1582.pbf");
      expect(match).not.toBeNull();

      const cleared = await clearOfflineMapTileCache();
      expect(cleared).toBe(true);
      expect((global as any).caches.delete).toHaveBeenCalledWith(MAP_TILES_CACHE_NAME);
    });
  });
});
