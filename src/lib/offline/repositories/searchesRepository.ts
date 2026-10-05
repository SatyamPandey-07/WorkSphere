import { initOfflineDB } from "../db";
import type { OfflineSearch, OfflineVenue, IRepository } from "../types";

export const MAX_OFFLINE_SEARCHES = 20;

export class SearchesRepository implements IRepository<OfflineSearch, string> {
  async get(query: string): Promise<OfflineSearch | undefined> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["searches"], "readonly");
      const store = tx.objectStore("searches");
      const req = store.get(query);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<OfflineSearch[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["searches"], "readonly");
      const store = tx.objectStore("searches");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async save(search: OfflineSearch, maxEntries: number = MAX_OFFLINE_SEARCHES): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["searches"], "readwrite");
      const store = tx.objectStore("searches");
      const req = store.put(search);
      req.onsuccess = () => {
        this.trimSearchHistory(maxEntries)
          .then(() => resolve())
          .catch(() => resolve());
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveMany(searches: OfflineSearch[]): Promise<void> {
    if (searches.length === 0) return;
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["searches"], "readwrite");
      const store = tx.objectStore("searches");
      for (const search of searches) {
        store.put(search);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(query: string): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["searches"], "readwrite");
      const store = tx.objectStore("searches");
      const req = store.delete(query);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["searches"], "readwrite");
      const store = tx.objectStore("searches");
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Trims search history to the specified maximum entries.
   * Uses index.openCursor() on the 'timestamp' index to iterate from oldest records,
   * deleting via cursor.delete() which correctly targets the current record by primary key
   * without deleting by index key or mismatching keys.
   */
  async trimSearchHistory(maxEntries: number = MAX_OFFLINE_SEARCHES): Promise<number> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["searches"], "readwrite");
      const store = tx.objectStore("searches");
      const countReq = store.count();

      countReq.onerror = () => reject(countReq.error);
      countReq.onsuccess = () => {
        const total = countReq.result;
        const toDeleteCount = total - maxEntries;
        if (toDeleteCount <= 0) {
          resolve(0);
          return;
        }

        let deleted = 0;
        let index: IDBIndex;
        try {
          index = store.index("timestamp");
        } catch {
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => {
            const all = (getAllReq.result as OfflineSearch[]) || [];
            all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const toDelete = all.slice(0, toDeleteCount);
            for (const item of toDelete) {
              store.delete(item.query);
              deleted++;
            }
            tx.oncomplete = () => resolve(deleted);
          };
          getAllReq.onerror = () => reject(getAllReq.error);
          return;
        }

        const cursorReq = index.openCursor();
        cursorReq.onerror = () => reject(cursorReq.error);
        tx.oncomplete = () => resolve(deleted);
        tx.onerror = () => reject(tx.error);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && deleted < toDeleteCount) {
            cursor.delete();
            deleted++;
            cursor.continue();
          }
        };
      };

      tx.onerror = () => reject(tx.error);
    });
  }
}

export const searchesRepository = new SearchesRepository();

export async function trimSearchHistory(
  maxEntries: number = MAX_OFFLINE_SEARCHES,
): Promise<number> {
  return searchesRepository.trimSearchHistory(maxEntries);
}
