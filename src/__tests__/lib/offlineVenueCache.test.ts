/**
 * Tests for offline venue cache mechanics.
 *
 * Covers: savedAt timestamp, multiple venues, overwrite,
 * clear all, and count helpers — all in-memory, no external
 * dependencies needed.
 */

// ─── Minimal in-memory implementation used only by these tests ────────────────

interface CachedVenue {
  id: string;
  name: string;
  savedAt: number;
}

class OfflineVenueCache {
  private store = new Map<string, CachedVenue>();

  save(venue: Omit<CachedVenue, "savedAt">): void {
    this.store.set(venue.id, { ...venue, savedAt: Date.now() });
  }

  get(id: string): CachedVenue | undefined {
    return this.store.get(id);
  }

  getAll(): CachedVenue[] {
    return Array.from(this.store.values());
  }

  clear(): void {
    this.store.clear();
  }

  count(): number {
    return this.store.size;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OfflineVenueCache", () => {
  let cache: OfflineVenueCache;

  beforeEach(() => {
    cache = new OfflineVenueCache();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("save and retrieve with savedAt timestamp", () => {
    it("stores a venue and attaches a savedAt timestamp", () => {
      jest.setSystemTime(new Date("2025-01-15T10:00:00Z"));
      cache.save({ id: "v1", name: "Quiet Corner Cafe" });

      const result = cache.get("v1");
      expect(result).toBeDefined();
      expect(result!.name).toBe("Quiet Corner Cafe");
      expect(result!.savedAt).toBe(new Date("2025-01-15T10:00:00Z").getTime());
    });

    it("savedAt reflects the time of the save call, not construction time", () => {
      jest.setSystemTime(new Date("2025-01-15T09:00:00Z"));
      cache.save({ id: "v2", name: "Library Lounge" });

      jest.setSystemTime(new Date("2025-01-15T12:00:00Z"));
      cache.save({ id: "v3", name: "Rooftop Study" });

      expect(cache.get("v2")!.savedAt).toBe(
        new Date("2025-01-15T09:00:00Z").getTime()
      );
      expect(cache.get("v3")!.savedAt).toBe(
        new Date("2025-01-15T12:00:00Z").getTime()
      );
    });
  });

  describe("multiple venues", () => {
    it("stores several venues independently", () => {
      cache.save({ id: "a", name: "Venue A" });
      cache.save({ id: "b", name: "Venue B" });
      cache.save({ id: "c", name: "Venue C" });

      expect(cache.get("a")!.name).toBe("Venue A");
      expect(cache.get("b")!.name).toBe("Venue B");
      expect(cache.get("c")!.name).toBe("Venue C");
    });

    it("getAll returns all saved venues", () => {
      cache.save({ id: "x", name: "X" });
      cache.save({ id: "y", name: "Y" });

      const all = cache.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((v) => v.id).sort()).toEqual(["x", "y"]);
    });
  });

  describe("overwrite existing venue", () => {
    it("replaces the venue data when the same id is saved again", () => {
      jest.setSystemTime(new Date("2025-01-10T08:00:00Z"));
      cache.save({ id: "dup", name: "Old Name" });

      jest.setSystemTime(new Date("2025-01-11T08:00:00Z"));
      cache.save({ id: "dup", name: "New Name" });

      const result = cache.get("dup");
      expect(result!.name).toBe("New Name");
      expect(result!.savedAt).toBe(new Date("2025-01-11T08:00:00Z").getTime());
    });

    it("count does not increase after an overwrite", () => {
      cache.save({ id: "dup2", name: "First" });
      cache.save({ id: "dup2", name: "Second" });

      expect(cache.count()).toBe(1);
    });
  });

  describe("clear all", () => {
    it("clear removes all venues", () => {
      cache.save({ id: "p", name: "P" });
      cache.save({ id: "q", name: "Q" });
      cache.clear();

      expect(cache.getAll()).toHaveLength(0);
    });

    it("getAll returns an empty array after clear", () => {
      cache.save({ id: "r", name: "R" });
      cache.clear();

      expect(cache.getAll()).toEqual([]);
    });
  });

  describe("count function", () => {
    it("starts at zero", () => {
      expect(cache.count()).toBe(0);
    });

    it("increments as venues are added", () => {
      cache.save({ id: "1", name: "One" });
      expect(cache.count()).toBe(1);
      cache.save({ id: "2", name: "Two" });
      expect(cache.count()).toBe(2);
    });

    it("returns zero after clear", () => {
      cache.save({ id: "z", name: "Z" });
      cache.clear();
      expect(cache.count()).toBe(0);
    });
  });
});
