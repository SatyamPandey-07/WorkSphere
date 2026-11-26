import {
  CacheExpirationPlugin,
  MAX_VENUE_PHOTO_ENTRIES,
  StaleWhileRevalidate,
  VENUE_PHOTO_CACHE_NAME,
  VENUE_PHOTO_MAX_AGE_SECONDS,
  handleVenuePhotoFetch,
  isQuotaExceededError,
  isVenuePhotoUrl,
} from "@/sw";

describe("Service Worker Venue Gallery Photo Caching", () => {
  describe("Quota handling", () => {
    it("detects quota errors across browser-specific names and codes", () => {
      expect(isQuotaExceededError({ name: "QuotaExceededError" })).toBe(true);
      expect(isQuotaExceededError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(
        true,
      );
      expect(isQuotaExceededError({ code: 22 })).toBe(true);
      expect(isQuotaExceededError(new Error("other failure"))).toBe(false);
      expect(isQuotaExceededError("QuotaExceededError")).toBe(false);
    });

    it("evicts the oldest 20% from the image cache", async () => {
      const deleted: string[] = [];
      const urls = Array.from(
        { length: 10 },
        (_, index) => `https://images.pexels.com/photo-${index}.jpg`,
      );
      const cache = {
        match: jest.fn(),
        put: jest.fn(),
        delete: jest.fn().mockImplementation(async (request: Request) => {
          deleted.push(request.url);
          return true;
        }),
        keys: jest
          .fn()
          .mockResolvedValue(urls.map((url) => new Request(url))),
      };
      const plugin = new CacheExpirationPlugin();
      urls.forEach((url, index) => plugin.updateTimestamp(url, index + 1));

      await expect(plugin.evictOldestEntries(cache)).resolves.toEqual(urls.slice(0, 2));
      expect(deleted).toEqual(urls.slice(0, 2));
    });

    it("handles empty and small image caches without invalid eviction counts", async () => {
      const cache = {
        match: jest.fn(),
        put: jest.fn(),
        delete: jest.fn().mockResolvedValue(true),
        keys: jest.fn().mockResolvedValue([]),
      };
      const plugin = new CacheExpirationPlugin();

      await expect(plugin.evictOldestEntries(cache)).resolves.toEqual([]);
      cache.keys.mockResolvedValue([
        new Request("https://images.pexels.com/only.jpg"),
      ]);
      await expect(plugin.evictOldestEntries(cache)).resolves.toEqual([
        "https://images.pexels.com/only.jpg",
      ]);
    });

    it("evicts and retries once after quota failure", async () => {
      const cachedUrls = [
        "https://images.pexels.com/old-1.jpg",
        "https://images.pexels.com/old-2.jpg",
        "https://images.pexels.com/old-3.jpg",
        "https://images.pexels.com/old-4.jpg",
        "https://images.pexels.com/old-5.jpg",
      ];
      const deleted: string[] = [];
      const cache = {
        match: jest.fn(),
        put: jest
          .fn()
          .mockRejectedValueOnce({ name: "QuotaExceededError" })
          .mockResolvedValueOnce(undefined),
        delete: jest.fn().mockImplementation(async (request: Request) => {
          deleted.push(request.url);
          return true;
        }),
        keys: jest
          .fn()
          .mockResolvedValue(cachedUrls.map((url) => new Request(url))),
      };
      const strategy = new StaleWhileRevalidate();
      cachedUrls.forEach((url, index) =>
        strategy.expiration.updateTimestamp(url, Date.now() - 1000 + index),
      );

      const request = new Request("https://images.pexels.com/new.jpg");
      const response = await strategy.handle({
        request,
        cacheInstance: cache,
        fetchFn: jest.fn().mockResolvedValue(new Response("new image")),
      });

      expect(await response.text()).toBe("new image");
      expect(deleted).toEqual(cachedUrls.slice(0, 1));
      expect(cache.put).toHaveBeenCalledTimes(2);
      expect(strategy.expiration.hasEntry(request.url)).toBe(true);
    });

    it("does not retry indefinitely when the retry also exceeds quota", async () => {
      const cache = {
        match: jest.fn().mockResolvedValue(undefined),
        put: jest
          .fn()
          .mockRejectedValue({ name: "QuotaExceededError" }),
        delete: jest.fn().mockResolvedValue(true),
        keys: jest.fn().mockResolvedValue([]),
      };
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const response = await handleVenuePhotoFetch(
          new Request("https://images.pexels.com/large.jpg"),
          undefined,
          cache,
          jest.fn().mockResolvedValue(new Response("image")),
        );
        expect(await response.text()).toBe("image");
        expect(cache.put).toHaveBeenCalledTimes(2);
      } finally {
        warn.mockRestore();
      }
    });

    it("preserves existing non-quota cache failure behavior without retrying", async () => {
      const cache = {
        match: jest.fn().mockResolvedValue(undefined),
        put: jest.fn().mockRejectedValue(new Error("cache unavailable")),
        delete: jest.fn().mockResolvedValue(true),
        keys: jest.fn().mockResolvedValue([]),
      };

      const response = await handleVenuePhotoFetch(
        new Request("https://images.pexels.com/photo.jpg"),
        undefined,
        cache,
        jest.fn().mockResolvedValue(new Response("image")),
      );

      expect(response.status).toBe(504);
      expect(cache.put).toHaveBeenCalledTimes(1);
      expect(cache.delete).not.toHaveBeenCalled();
    });
  });

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
