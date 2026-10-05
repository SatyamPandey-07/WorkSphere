import { initOfflineDB } from "../db";
import type { ReceiptExportItem, IRepository } from "../types";

export class ReceiptsRepository implements IRepository<ReceiptExportItem, string> {
  async get(bookingId: string): Promise<ReceiptExportItem | undefined> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["receiptExports"], "readonly");
      const store = tx.objectStore("receiptExports");
      const req = store.get(bookingId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<ReceiptExportItem[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["receiptExports"], "readonly");
      const store = tx.objectStore("receiptExports");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async save(receipt: ReceiptExportItem): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["receiptExports"], "readwrite");
      const store = tx.objectStore("receiptExports");
      const req = store.put(receipt);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async saveMany(receipts: ReceiptExportItem[]): Promise<void> {
    if (receipts.length === 0) return;
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["receiptExports"], "readwrite");
      const store = tx.objectStore("receiptExports");
      for (const receipt of receipts) {
        store.put(receipt);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(bookingId: string): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["receiptExports"], "readwrite");
      const store = tx.objectStore("receiptExports");
      const req = store.delete(bookingId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["receiptExports"], "readwrite");
      const store = tx.objectStore("receiptExports");
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const receiptsRepository = new ReceiptsRepository();
