import {
  CacheExpirationPlugin,
  MAX_VENUE_PHOTO_ENTRIES,
  StaleWhileRevalidate,
  VENUE_PHOTO_CACHE_NAME,
  VENUE_PHOTO_MAX_AGE_SECONDS,
  handleVenuePhotoFetch,
  isVenuePhotoUrl,
} from "@/sw";

describe("Service Worker Venue Gallery Photo Caching", () => {
  describe("URL Pattern Matching", () => {
    it("identifies Cloudinary photo URLs correctly", () => {
      expect(
        isVenuePhotoUrl(
          "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        ),
      ).toBe(true);
      expect(
        isVenuePhotoUrl(
          new Request("https://res.cloudinary.com/worksphere/venues/photo-1.png"),
        ),
      ).toBe(true);
    });

    it("identifies Pexels photo URLs correctly", () => {
      expect(
        isVenuePhotoUrl(
          "https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg",
        ),
      ).toBe(true);
      expect(
        isVenuePhotoUrl(
          new Request(
            "https://images.pexels.com/photos/2047905/pexels-photo-2047905.jpeg",
          ),
        ),
      ).toBe(true);
    });

    it("rejects non-venue or unsupported domains", () => {
      expect(isVenuePhotoUrl("https://example.com/image.png")).toBe(false);
      expect(
        isVenuePhotoUrl("https://api.worksphere.com/api/venues/list"),
      ).toBe(false);
    });
  });

  describe("CacheExpirationPlugin", () => {
    it("uses 100 maxEntries and 14-day maxAgeSeconds (1209600s) by default", () => {
      const plugin = new CacheExpirationPlugin();
      expect(plugin.maxEntries).toBe(100);
      expect(MAX_VENUE_PHOTO_ENTRIES).toBe(100);
      expect(plugin.maxAgeSeconds).toBe(14 * 24 * 60 * 60);
      expect(VENUE_PHOTO_MAX_AGE_SECONDS).toBe(1209600);
    });

    it("detects expired timestamps based on TTL", () => {
      const plugin = new CacheExpirationPlugin({ maxAgeSeconds: 100 });
      const now = 1000000;
      expect(plugin.isExpired(now - 50 * 1000, now)).toBe(false);
      expect(plugin.isExpired(now - 150 * 1000, now)).toBe(true);
    });

    it("evicts expired entries past 14 days", async () => {
      const deleted: string[] = [];
      const mockCache = {
        match: jest.fn(),
        put: jest.fn(),
        delete: jest.fn().mockImplementation(async (req: Request) => {
          deleted.push(req.url);
          return true;
        }),
        keys: jest.fn().mockResolvedValue([]),
      };

      const plugin = new CacheExpirationPlugin({ maxAgeSeconds: 100 });
      const baseTime = 1000000;
      plugin.updateTimestamp("https://images.pexels.com/1.jpg", baseTime - 200000);
      plugin.updateTimestamp("https://images.pexels.com/2.jpg", baseTime - 10000);

      const evicted = await plugin.expireEntries(mockCache, baseTime);
      expect(evicted).toEqual(["https://images.pexels.com/1.jpg"]);
      expect(plugin.hasEntry("https://images.pexels.com/1.jpg")).toBe(false);
      expect(plugin.hasEntry("https://images.pexels.com/2.jpg")).toBe(true);
    });

    it("evicts oldest LRU entries when exceeding maxEntries", async () => {
      const deleted: string[] = [];
      const mockCache = {
        match: jest.fn(),
        put: jest.fn(),
        delete: jest.fn().mockImplementation(async (req: Request) => {
          deleted.push(req.url);
          return true;
        }),
        keys: jest.fn().mockResolvedValue([]),
      };

      const plugin = new CacheExpirationPlugin({
        maxEntries: 2,
        maxAgeSeconds: 100000,
      });
      plugin.updateTimestamp("https://res.cloudinary.com/img1.jpg", 1000);
      plugin.updateTimestamp("https://res.cloudinary.com/img2.jpg", 2000);
      plugin.updateTimestamp("https://res.cloudinary.com/img3.jpg", 3000);

      const evicted = await plugin.expireEntries(mockCache, 4000);
      expect(evicted).toEqual(["https://res.cloudinary.com/img1.jpg"]);
      expect(plugin.getEntryCount()).toBe(2);
      expect(plugin.hasEntry("https://res.cloudinary.com/img1.jpg")).toBe(false);
      expect(plugin.hasEntry("https://res.cloudinary.com/img2.jpg")).toBe(true);
      expect(plugin.hasEntry("https://res.cloudinary.com/img3.jpg")).toBe(true);
    });
  });

  describe("StaleWhileRevalidate Strategy", () => {
    it("returns cached response immediately on cache hit and schedules background revalidation", async () => {
      const cachedResponse = new Response("cached-image-data", {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
      const freshResponse = new Response("fresh-image-data", {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });

      const mockStore = new Map<string, Response>();
      mockStore.set("https://images.pexels.com/photos/100/photo.jpg", cachedResponse);

      const mockCache = {
        match: jest.fn().mockImplementation(async (req: Request) => {
          return mockStore.get(req.url);
        }),
        put: jest.fn().mockImplementation(async (req: Request, res: Response) => {
          mockStore.set(req.url, res);
        }),
        delete: jest.fn().mockResolvedValue(true),
        keys: jest.fn().mockResolvedValue([]),
      };

      const mockFetch = jest.fn().mockResolvedValue(freshResponse);
      const waitUntilTasks: Promise<any>[] = [];
      const event = {
        waitUntil: (p: Promise<any>) => waitUntilTasks.push(p),
      };

      const request = new Request("https://images.pexels.com/photos/100/photo.jpg");
      const strategy = new StaleWhileRevalidate({
        cacheName: VENUE_PHOTO_CACHE_NAME,
      });

      const response = await strategy.handle({
        request,
        event,
        cacheInstance: mockCache,
        fetchFn: mockFetch,
      });

      // Immediate response is the cached version
      expect(await response.text()).toBe("cached-image-data");
      expect(event.waitUntil).toBeDefined();
      expect(waitUntilTasks.length).toBe(1);

      // Await background revalidation
      await Promise.all(waitUntilTasks);
      expect(mockFetch).toHaveBeenCalledWith(expect.any(Request));
      expect(mockCache.put).toHaveBeenCalled();
    });

    it("fetches and caches on cache miss", async () => {
      const freshResponse = new Response("network-image-data", {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });

      const mockCache = {
        match: jest.fn().mockResolvedValue(undefined),
        put: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(true),
        keys: jest.fn().mockResolvedValue([]),
      };

      const mockFetch = jest.fn().mockResolvedValue(freshResponse);
      const request = new Request("https://res.cloudinary.com/worksphere/new.jpg");

      const response = await handleVenuePhotoFetch(
        request,
        undefined,
        mockCache,
        mockFetch,
      );

      expect(await response.text()).toBe("network-image-data");
      expect(mockCache.put).toHaveBeenCalledWith(
        request,
        expect.any(Response),
      );
    });

    it("handles network failure on cache miss with 504 fallback", async () => {
      const mockCache = {
        match: jest.fn().mockResolvedValue(undefined),
        put: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(true),
        keys: jest.fn().mockResolvedValue([]),
      };

      const mockFetch = jest.fn().mockRejectedValue(new Error("Network Down"));
      const request = new Request("https://res.cloudinary.com/worksphere/offline.jpg");

      const response = await handleVenuePhotoFetch(
        request,
        undefined,
        mockCache,
        mockFetch,
      );

      expect(response.status).toBe(504);
    });
  });
});
