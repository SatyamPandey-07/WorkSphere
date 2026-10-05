import { initOfflineDB } from "../db";
import type { OfflineVenue, CachedPreferenceRanking, IRepository } from "../types";

export const MAX_OFFLINE_VENUES = 50;

export class VenuesRepository implements IRepository<OfflineVenue> {
  async get(id: string): Promise<OfflineVenue | undefined> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["venues"], "readonly");
      const store = tx.objectStore("venues");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<OfflineVenue[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["venues"], "readonly");
      const store = tx.objectStore("venues");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async save(venue: OfflineVenue): Promise<void> {
    const db = await initOfflineDB();
    const putItem = () =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["venues"], "readwrite");
        const store = tx.objectStore("venues");
        const req = store.put({
          ...venue,
          savedAt: venue.savedAt || Date.now(),
          lastAccessedAt: venue.lastAccessedAt || Date.now(),
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

    try {
      await putItem();
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        ("name" in err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED") ||
          ("code" in err && err.code === 22) ||
          ("message" in err && typeof (err as any).message === "string" && /quota/i.test((err as any).message)))
      ) {
        console.warn("[VenuesRepository] QuotaExceededError encountered. Pruning stale LRU caches...");
        await this.pruneLru(Math.max(1, Math.floor(MAX_OFFLINE_VENUES / 2)));
        await putItem();
        return;
      }
      throw err;
    }
  }

  async saveMany(venues: OfflineVenue[]): Promise<void> {
    if (venues.length === 0) return;
    const db = await initOfflineDB();
    const putAll = () =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["venues"], "readwrite");
        const store = tx.objectStore("venues");
        const now = Date.now();
        let firstError: unknown = null;

        for (const venue of venues) {
          const req = store.put({
            ...venue,
            savedAt: venue.savedAt || now,
            lastAccessedAt: venue.lastAccessedAt || now,
          });
          req.onerror = () => {
            firstError ??= req.error;
          };
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(firstError ?? tx.error);
      });

    try {
      await putAll();
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        ("name" in err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED") ||
          ("code" in err && err.code === 22) ||
          ("message" in err && typeof (err as any).message === "string" && /quota/i.test((err as any).message)))
      ) {
        console.warn("[VenuesRepository] QuotaExceededError during saveMany. Pruning stale LRU caches...");
        await this.pruneLru(Math.max(1, Math.floor(MAX_OFFLINE_VENUES / 2)));
        await putAll();
        return;
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["venues"], "readwrite");
      const store = tx.objectStore("venues");
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["venues"], "readwrite");
      const store = tx.objectStore("venues");
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async pruneLru(maxVenues = MAX_OFFLINE_VENUES): Promise<number> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["venues"], "readwrite");
      const store = tx.objectStore("venues");
      const req = store.getAll();

      req.onsuccess = () => {
        const venues = (req.result as OfflineVenue[]) || [];
        const overflow = venues.length - maxVenues;
        if (overflow <= 0) {
          resolve(0);
          return;
        }

        const candidates = venues
          .filter((v) => !v.isPinned && !v.isFavorite)
          .sort((a, b) => (a.lastAccessedAt || a.savedAt || 0) - (b.lastAccessedAt || b.savedAt || 0));

        const toDelete = candidates.slice(0, overflow);
        let deleted = 0;

        for (const venue of toDelete) {
          store.delete(venue.id);
          deleted++;
        }

        tx.oncomplete = () => resolve(deleted);
        tx.onerror = () => reject(tx.error);
      };

      req.onerror = () => reject(req.error);
    });
  }

  // ─── Favorites ─────────────────────────────────────────────────────────────

  async getFavorites(): Promise<OfflineVenue[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorites"], "readonly");
      const store = tx.objectStore("favorites");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveFavorite(venue: OfflineVenue): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorites", "venues"], "readwrite");
      const favStore = tx.objectStore("favorites");
      const venueStore = tx.objectStore("venues");
      const favItem = { ...venue, isFavorite: true, savedAt: Date.now() };

      favStore.put(favItem);
      venueStore.put(favItem);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async removeFavorite(id: string): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorites", "venues"], "readwrite");
      const favStore = tx.objectStore("favorites");
      const venueStore = tx.objectStore("venues");

      favStore.delete(id);

      const req = venueStore.get(id);
      req.onsuccess = () => {
        if (req.result) {
          venueStore.put({ ...req.result, isFavorite: false });
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ─── Preference Rankings Cache ─────────────────────────────────────────────

  async getPreferenceRanking(id = "default_ranking"): Promise<CachedPreferenceRanking | undefined> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["preference_rankings"], "readonly");
      const store = tx.objectStore("preference_rankings");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async savePreferenceRanking(ranking: CachedPreferenceRanking): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["preference_rankings"], "readwrite");
      const store = tx.objectStore("preference_rankings");
      const req = store.put({ ...ranking, id: ranking.id || "default_ranking" });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const venuesRepository = new VenuesRepository();
