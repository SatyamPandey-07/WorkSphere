import {
  OfflineVenueCache,
  DEFAULT_MAX_CACHED_VENUES,
  type CachedVenue,
} from "@/lib/offline/venueCache";

describe("Offline Venue LRU Cache & Eviction Policy", () => {
  let cache: OfflineVenueCache;

  beforeEach(() => {
    cache = new OfflineVenueCache({ maxVenues: 3 });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Access Timestamps & LRU Tracking", () => {
    test("attaches savedAt and lastAccessedAt timestamps upon saving", () => {
      jest.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      cache.save({ id: "v1", name: "Quiet Space" });

      const venue = cache.get("v1");
      expect(venue).toBeDefined();
      expect(venue?.savedAt).toBe(new Date("2026-01-01T10:00:00Z").getTime());
      expect(venue?.lastAccessedAt).toBe(new Date("2026-01-01T10:00:00Z").getTime());
    });

    test("updates lastAccessedAt on get() calls", () => {
      jest.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      cache.save({ id: "v1", name: "Quiet Space" });

      jest.setSystemTime(new Date("2026-01-01T12:30:00Z"));
      const venue = cache.get("v1");

      expect(venue?.lastAccessedAt).toBe(new Date("2026-01-01T12:30:00Z").getTime());
      expect(venue?.savedAt).toBe(new Date("2026-01-01T10:00:00Z").getTime());
    });

    test("peek() returns venue without modifying lastAccessedAt", () => {
      jest.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      cache.save({ id: "v1", name: "Quiet Space" });

      jest.setSystemTime(new Date("2026-01-01T12:30:00Z"));
      const venue = cache.peek("v1");

      expect(venue?.lastAccessedAt).toBe(new Date("2026-01-01T10:00:00Z").getTime());
    });
  });

  describe("LRU Eviction Policy & Quota Enforcement", () => {
    test("automatically evicts the least recently accessed venue when capacity is exceeded", () => {
      jest.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      cache.save({ id: "v1", name: "Venue 1" });

      jest.setSystemTime(new Date("2026-01-01T11:00:00Z"));
      cache.save({ id: "v2", name: "Venue 2" });

      jest.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      cache.save({ id: "v3", name: "Venue 3" });

      expect(cache.count()).toBe(3);

      // Add 4th venue at 13:00 -> v1 (10:00) is oldest accessed, should be evicted
      jest.setSystemTime(new Date("2026-01-01T13:00:00Z"));
      cache.save({ id: "v4", name: "Venue 4" });

      expect(cache.count()).toBe(3);
      expect(cache.get("v1")).toBeUndefined();
      expect(cache.get("v2")).toBeDefined();
      expect(cache.get("v3")).toBeDefined();
      expect(cache.get("v4")).toBeDefined();
    });

    test("reading a venue refreshes its LRU priority and prevents its eviction", () => {
      jest.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      cache.save({ id: "v1", name: "Venue 1" });

      jest.setSystemTime(new Date("2026-01-01T11:00:00Z"));
      cache.save({ id: "v2", name: "Venue 2" });

      jest.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      cache.save({ id: "v3", name: "Venue 3" });

      // Access v1 at 12:30 -> makes v2 the oldest accessed (11:00)
      jest.setSystemTime(new Date("2026-01-01T12:30:00Z"));
      cache.get("v1");

      // Add 4th venue -> v2 should be evicted instead of v1
      jest.setSystemTime(new Date("2026-01-01T13:00:00Z"));
      cache.save({ id: "v4", name: "Venue 4" });

      expect(cache.count()).toBe(3);
      expect(cache.get("v1")).toBeDefined();
      expect(cache.get("v2")).toBeUndefined();
      expect(cache.get("v3")).toBeDefined();
      expect(cache.get("v4")).toBeDefined();
    });
  });

  describe("Exemption for Favorited & Pinned Venues", () => {
    test("exempts favorited venues from LRU eviction", () => {
      jest.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      cache.save({ id: "v1", name: "Favorite Venue", isFavorite: true });

      jest.setSystemTime(new Date("2026-01-01T11:00:00Z"));
      cache.save({ id: "v2", name: "Regular Venue 2" });

      jest.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      cache.save({ id: "v3", name: "Regular Venue 3" });

      // Add 4th venue -> v1 is oldest but favorited, so v2 is evicted
      jest.setSystemTime(new Date("2026-01-01T13:00:00Z"));
      cache.save({ id: "v4", name: "Regular Venue 4" });

      expect(cache.count()).toBe(3);
      expect(cache.get("v1")).toBeDefined();
      expect(cache.get("v2")).toBeUndefined();
      expect(cache.get("v3")).toBeDefined();
      expect(cache.get("v4")).toBeDefined();
    });

    test("exempts pinned venues from LRU eviction", () => {
      jest.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      cache.save({ id: "v1", name: "Pinned Venue", isPinned: true });

      jest.setSystemTime(new Date("2026-01-01T11:00:00Z"));
      cache.save({ id: "v2", name: "Venue 2" });

      jest.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      cache.save({ id: "v3", name: "Venue 3" });

      jest.setSystemTime(new Date("2026-01-01T13:00:00Z"));
      cache.save({ id: "v4", name: "Venue 4" });

      expect(cache.count()).toBe(3);
      expect(cache.get("v1")).toBeDefined();
      expect(cache.get("v2")).toBeUndefined();
      expect(cache.get("v3")).toBeDefined();
      expect(cache.get("v4")).toBeDefined();
    });

    test("setFavorite and setPinned updates exemption status dynamically", () => {
      cache.save({ id: "v1", name: "Venue 1" });
      cache.save({ id: "v2", name: "Venue 2" });
      cache.save({ id: "v3", name: "Venue 3" });

      // Dynamically pin v1
      cache.setPinned("v1", true);

      cache.save({ id: "v4", name: "Venue 4" });

      expect(cache.get("v1")).toBeDefined();
      expect(cache.get("v2")).toBeUndefined();
    });
  });

  describe("Default Cache Limit", () => {
    test("uses default max limit of 50 venues when unspecified", () => {
      const defaultCache = new OfflineVenueCache();
      expect(DEFAULT_MAX_CACHED_VENUES).toBe(50);

      for (let i = 1; i <= 55; i++) {
        defaultCache.save({ id: `venue-${i}`, name: `Venue ${i}` });
      }

      expect(defaultCache.count()).toBe(50);
      expect(defaultCache.get("venue-1")).toBeUndefined();
      expect(defaultCache.get("venue-5")).toBeUndefined();
      expect(defaultCache.get("venue-6")).toBeDefined();
      expect(defaultCache.get("venue-55")).toBeDefined();
    });
  });
});
