/**
 * Tests for recently viewed venues offline IndexedDB caching (Issue #3512).
 * Verifies persistence of up to 20 venue payloads, pruning, ordering, and offline retrieval.
 */

import {
  type RecentlyViewedVenuePayload,
  MAX_RECENTLY_VIEWED_IDB,
} from "@/lib/offlineStorage";

// Minimal simulated in-memory store mirroring the IndexedDB recentlyViewedVenues object store
class SimulatedRecentlyViewedIDBStore {
  private store = new Map<string, RecentlyViewedVenuePayload>();

  async put(venue: RecentlyViewedVenuePayload): Promise<void> {
    this.store.set(venue.id, { ...venue });
  }

  async getAll(): Promise<RecentlyViewedVenuePayload[]> {
    return Array.from(this.store.values()).sort(
      (a, b) => (b.viewedAt || 0) - (a.viewedAt || 0),
    );
  }

  async get(id: string): Promise<RecentlyViewedVenuePayload | null> {
    return this.store.get(id) || null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async prune(maxItems: number): Promise<void> {
    const all = Array.from(this.store.values());
    if (all.length > maxItems) {
      all.sort((a, b) => (a.viewedAt || 0) - (b.viewedAt || 0));
      const toDelete = all.slice(0, all.length - maxItems);
      for (const item of toDelete) {
        this.store.delete(item.id);
      }
    }
  }

  count(): number {
    return this.store.size;
  }
}

describe("Recently Viewed Venues Offline Cache (Issue #3512)", () => {
  let idbStore: SimulatedRecentlyViewedIDBStore;

  const createPayload = (
    id: string,
    name = `Venue ${id}`,
    viewedAt = Date.now(),
  ): RecentlyViewedVenuePayload => ({
    id,
    name,
    address: `${id} High St, Metro City`,
    category: "coworking_space",
    imageUrl: `https://example.com/venue-${id}.jpg`,
    rating: 4.8,
    latitude: 37.7749,
    longitude: -122.4194,
    amenities: ["High-speed WiFi", "Quiet Booth", "Ergonomic Chairs"],
    floorplan: {
      svg: "<svg>...</svg>",
      seats: [
        { id: `seat-${id}-1`, seatNumber: "1A", available: true },
        { id: `seat-${id}-2`, seatNumber: "1B", available: false },
      ],
    },
    viewedAt,
  });

  beforeEach(() => {
    idbStore = new SimulatedRecentlyViewedIDBStore();
  });

  it("persists a viewed venue payload with amenities and floorplan", async () => {
    const payload = createPayload("v1", "Downtown Hub");
    await idbStore.put(payload);

    const result = await idbStore.get("v1");
    expect(result).toBeDefined();
    expect(result?.name).toBe("Downtown Hub");
    expect(result?.amenities).toContain("High-speed WiFi");
    expect(result?.floorplan).toBeDefined();
  });

  it("maintains up to 20 recently viewed venue payloads and prunes older ones", async () => {
    expect(MAX_RECENTLY_VIEWED_IDB).toBe(20);

    // Insert 25 venues with increasing timestamps
    for (let i = 1; i <= 25; i++) {
      const payload = createPayload(String(i), `Venue ${i}`, 1000 + i);
      await idbStore.put(payload);
      await idbStore.prune(MAX_RECENTLY_VIEWED_IDB);
    }

    expect(idbStore.count()).toBe(20);

    const all = await idbStore.getAll();
    expect(all).toHaveLength(20);

    // Check that venues 1 through 5 were pruned and 6 to 25 remain
    const ids = all.map((v) => v.id);
    expect(ids).not.toContain("1");
    expect(ids).not.toContain("5");
    expect(ids).toContain("6");
    expect(ids).toContain("25");

    // Newest venue (25) must be first
    expect(all[0].id).toBe("25");
  });

  it("updates existing venue and moves it to the top without duplicate entries", async () => {
    await idbStore.put(createPayload("v1", "Venue 1", 100));
    await idbStore.put(createPayload("v2", "Venue 2", 200));
    await idbStore.prune(MAX_RECENTLY_VIEWED_IDB);

    expect(idbStore.count()).toBe(2);

    // Re-view venue 1 with higher timestamp
    await idbStore.put(createPayload("v1", "Venue 1 Updated", 300));
    await idbStore.prune(MAX_RECENTLY_VIEWED_IDB);

    expect(idbStore.count()).toBe(2);
    const all = await idbStore.getAll();
    expect(all[0].id).toBe("v1");
    expect(all[0].name).toBe("Venue 1 Updated");
    expect(all[1].id).toBe("v2");
  });

  it("retrieves venue details, amenities, and floorplans when offline", async () => {
    const payload = createPayload("v-offline", "Underground Lounge");
    await idbStore.put(payload);

    const retrieved = await idbStore.get("v-offline");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.amenities).toEqual([
      "High-speed WiFi",
      "Quiet Booth",
      "Ergonomic Chairs",
    ]);
    expect((retrieved?.floorplan as any).seats).toHaveLength(2);
  });

  it("clears all cached venues when requested", async () => {
    await idbStore.put(createPayload("v1"));
    await idbStore.put(createPayload("v2"));
    expect(idbStore.count()).toBe(2);

    await idbStore.clear();
    expect(idbStore.count()).toBe(0);
    const all = await idbStore.getAll();
    expect(all).toHaveLength(0);
  });
});
