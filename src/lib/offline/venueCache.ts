/**
 * Offline Venue Cache with LRU (Least Recently Used) Eviction Policy
 *
 * Prevents mobile and browser storage exhaustion by enforcing:
 * 1. Automatic `lastAccessedAt` tracking on every cache read and write.
 * 2. Capped maximum number of cached offline venues (default: 50 venues).
 * 3. Priority exemption for saved/favorited or explicitly pinned venues.
 * 4. Background and idle-time LRU purge execution via `requestIdleCallback`.
 */

import { initOfflineDB, type OfflineVenue } from "@/lib/offlineStorage";
import { withWebLock } from "@/lib/webLock";

export const DEFAULT_MAX_CACHED_VENUES = 50;

export interface CachedVenue extends OfflineVenue {
  id: string;
  name: string;
  savedAt: number;
  lastAccessedAt: number;
  isPinned?: boolean;
  isFavorite?: boolean;
}

export interface VenueCacheOptions {
  maxVenues?: number;
}

/**
 * In-memory Offline Venue LRU Cache implementation for high performance,
 * SSR fallback, and deterministic unit testing.
 */
export class OfflineVenueCache {
  private store = new Map<string, CachedVenue>();
  private maxVenues: number;

  constructor(options: VenueCacheOptions = {}) {
    this.maxVenues = options.maxVenues ?? DEFAULT_MAX_CACHED_VENUES;
  }

  /**
   * Saves or updates a venue in cache, attaching `savedAt` and `lastAccessedAt`.
   * Automatically triggers LRU eviction if capacity is exceeded.
   */
  save(
    venue: Partial<CachedVenue> & { id: string; name: string },
    options: { isPinned?: boolean; isFavorite?: boolean } = {},
  ): void {
    const now = Date.now();
    const existing = this.store.get(venue.id);

    const record: CachedVenue = {
      latitude: 0,
      longitude: 0,
      ...existing,
      ...venue,
      id: venue.id,
      name: venue.name,
      savedAt: existing?.savedAt ?? venue.savedAt ?? now,
      lastAccessedAt: now,
      isPinned: options.isPinned ?? venue.isPinned ?? existing?.isPinned ?? false,
      isFavorite: options.isFavorite ?? venue.isFavorite ?? existing?.isFavorite ?? false,
    };

    this.store.set(venue.id, record);
    this.enforceLruLimit();
  }

  /**
   * Retrieves a venue from cache and updates its `lastAccessedAt` timestamp.
   */
  get(id: string): CachedVenue | undefined {
    const venue = this.store.get(id);
    if (!venue) return undefined;

    venue.lastAccessedAt = Date.now();
    return venue;
  }

  /**
   * Peek a venue without updating its `lastAccessedAt` timestamp.
   */
  peek(id: string): CachedVenue | undefined {
    return this.store.get(id);
  }

  /**
   * Returns all cached venues sorted by `lastAccessedAt` descending (most recent first).
   */
  getAll(): CachedVenue[] {
    return Array.from(this.store.values()).sort(
      (a, b) => b.lastAccessedAt - a.lastAccessedAt,
    );
  }

  /**
   * Deletes a venue from cache by ID.
   */
  delete(id: string): boolean {
    return this.store.delete(id);
  }

  /**
   * Pins or unpins a venue to prevent LRU eviction.
   */
  setPinned(id: string, isPinned: boolean): void {
    const venue = this.store.get(id);
    if (venue) {
      venue.isPinned = isPinned;
      venue.lastAccessedAt = Date.now();
    }
  }

  /**
   * Sets favorite status for a venue (favorited venues are exempted from eviction).
   */
  setFavorite(id: string, isFavorite: boolean): void {
    const venue = this.store.get(id);
    if (venue) {
      venue.isFavorite = isFavorite;
      venue.lastAccessedAt = Date.now();
    }
  }

  /**
   * Returns the total count of cached venues.
   */
  count(): number {
    return this.store.size;
  }

  /**
   * Clears all venues from the cache.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Purges the oldest unpinned and unfavorited venues when total count > maxVenues.
   * Returns the count of evicted venues.
   */
  enforceLruLimit(customMax?: number): number {
    const limit = customMax ?? this.maxVenues;
    let overflow = this.store.size - limit;
    if (overflow <= 0) return 0;

    // Filter unpinned and unfavorited venues
    const evictable = Array.from(this.store.values())
      .filter((v) => !v.isPinned && !v.isFavorite)
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt); // Oldest accessed first

    let evictedCount = 0;
    for (const venue of evictable) {
      if (overflow <= 0) break;
      this.store.delete(venue.id);
      evictedCount++;
      overflow--;
    }

    return evictedCount;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent IndexedDB Venue LRU Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if a venue is favorited in the offline favorites store.
 */
async function isVenueFavoritedOffline(
  database: IDBDatabase,
  id: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      if (!database.objectStoreNames.contains("favorites")) {
        resolve(false);
        return;
      }
      const tx = database.transaction(["favorites"], "readonly");
      const store = tx.objectStore("favorites");
      const req = store.get(id);
      req.onsuccess = () => resolve(Boolean(req.result));
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Saves a venue into persistent IndexedDB storage with LRU access tracking.
 */
export async function saveVenueOfflineWithLru(
  venue: Partial<CachedVenue> & { id: string; name: string },
  options: { isPinned?: boolean; isFavorite?: boolean; maxVenues?: number } = {},
): Promise<void> {
  return withWebLock(async () => {
    const database = await initOfflineDB();
    const now = Date.now();

    const isFav =
      options.isFavorite ??
      venue.isFavorite ??
      (await isVenueFavoritedOffline(database, venue.id));

    const record: CachedVenue = {
      latitude: 0,
      longitude: 0,
      ...venue,
      id: venue.id,
      name: venue.name,
      savedAt: venue.savedAt ?? now,
      lastAccessedAt: now,
      isPinned: options.isPinned ?? venue.isPinned ?? false,
      isFavorite: isFav,
    };

    const attemptPut = (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["venues"], "readwrite");
        const store = tx.objectStore("venues");
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

    try {
      await attemptPut();
      await purgeOfflineVenuesLru(options.maxVenues ?? DEFAULT_MAX_CACHED_VENUES);
    } catch (err) {
      console.error("[VenueCache] Failed to save venue with LRU tracking:", err);
      throw err;
    }
  });
}

/**
 * Retrieves a venue from IndexedDB and updates its `lastAccessedAt` timestamp.
 */
export async function getVenueOfflineWithLru(
  id: string,
): Promise<CachedVenue | null> {
  return withWebLock(async () => {
    const database = await initOfflineDB();

    return new Promise<CachedVenue | null>((resolve, reject) => {
      const tx = database.transaction(["venues"], "readwrite");
      const store = tx.objectStore("venues");
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const result = getReq.result as CachedVenue | undefined;
        if (!result) {
          resolve(null);
          return;
        }

        // Update lastAccessedAt timestamp
        const now = Date.now();
        const updated: CachedVenue = {
          ...result,
          lastAccessedAt: now,
        };

        store.put(updated);
        resolve(updated);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  });
}

/**
 * Purges least recently accessed unpinned/unfavorited venues from IndexedDB when capacity is exceeded.
 */
export async function purgeOfflineVenuesLru(
  maxVenues = DEFAULT_MAX_CACHED_VENUES,
): Promise<number> {
  return withWebLock(async () => {
    const database = await initOfflineDB();

    const allVenues: CachedVenue[] = await new Promise((resolve, reject) => {
      const tx = database.transaction(["venues"], "readonly");
      const store = tx.objectStore("venues");
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as CachedVenue[]) || []);
      req.onerror = () => reject(req.error);
    });

    let overflow = allVenues.length - maxVenues;
    if (overflow <= 0) return 0;

    // Filter out pinned and favorited venues
    const evictable = allVenues
      .filter((v) => !v.isPinned && !v.isFavorite)
      .sort((a, b) => (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0));

    if (evictable.length === 0) return 0;

    let evictedCount = 0;

    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(["venues"], "readwrite");
      const store = tx.objectStore("venues");

      for (const v of evictable) {
        if (overflow <= 0) break;
        store.delete(v.id);
        evictedCount++;
        overflow--;
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    if (evictedCount > 0) {
      console.log(
        `[VenueCache] LRU eviction purged ${evictedCount} venues (limit: ${maxVenues})`,
      );
    }

    return evictedCount;
  });
}

/**
 * Schedules an LRU eviction pass during browser idle time or background sync.
 */
export function scheduleIdleVenueEviction(
  maxVenues = DEFAULT_MAX_CACHED_VENUES,
): void {
  if (typeof window === "undefined") return;

  const runPurge = () => {
    purgeOfflineVenuesLru(maxVenues).catch((err) =>
      console.warn("[VenueCache] Idle LRU eviction failed:", err),
    );
  };

  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(runPurge, { timeout: 5000 });
  } else {
    setTimeout(runPurge, 1000);
  }
}
