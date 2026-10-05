import { initOfflineDB } from "../db";
import type { OfflineTagItem, IRepository } from "../types";

export class TagsRepository implements IRepository<OfflineTagItem, string> {
  async get(id: string): Promise<OfflineTagItem | undefined> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorite_tags"], "readonly");
      const store = tx.objectStore("favorite_tags");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<OfflineTagItem[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorite_tags"], "readonly");
      const store = tx.objectStore("favorite_tags");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async save(tag: OfflineTagItem): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorite_tags"], "readwrite");
      const store = tx.objectStore("favorite_tags");
      const req = store.put(tag);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async saveMany(tags: OfflineTagItem[]): Promise<void> {
    if (tags.length === 0) return;
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorite_tags"], "readwrite");
      const store = tx.objectStore("favorite_tags");
      for (const tag of tags) {
        store.put(tag);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorite_tags"], "readwrite");
      const store = tx.objectStore("favorite_tags");
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["favorite_tags"], "readwrite");
      const store = tx.objectStore("favorite_tags");
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const tagsRepository = new TagsRepository();
