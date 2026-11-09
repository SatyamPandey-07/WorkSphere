import { initOfflineDB } from "../db";
import type { QueuedVenueReview, IRepository } from "../types";

export class ReviewsRepository implements IRepository<QueuedVenueReview> {
  async get(id: string): Promise<QueuedVenueReview | undefined> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pendingReviews"], "readonly");
      const store = tx.objectStore("pendingReviews");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<QueuedVenueReview[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pendingReviews"], "readonly");
      const store = tx.objectStore("pendingReviews");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getByVenue(venueId: string): Promise<QueuedVenueReview[]> {
    const all = await this.getAll();
    return all.filter((r) => r.venueId === venueId);
  }

  async save(review: QueuedVenueReview): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pendingReviews"], "readwrite");
      const store = tx.objectStore("pendingReviews");
      const req = store.put(review);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async saveMany(reviews: QueuedVenueReview[]): Promise<void> {
    if (reviews.length === 0) return;
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pendingReviews"], "readwrite");
      const store = tx.objectStore("pendingReviews");
      for (const review of reviews) {
        store.put(review);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pendingReviews"], "readwrite");
      const store = tx.objectStore("pendingReviews");
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pendingReviews"], "readwrite");
      const store = tx.objectStore("pendingReviews");
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const reviewsRepository = new ReviewsRepository();
