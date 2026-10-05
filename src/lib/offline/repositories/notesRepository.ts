import { initOfflineDB } from "../db";
import type { CachedNote, PendingNoteEdit, IRepository } from "../types";

export class NotesRepository implements IRepository<CachedNote, string> {
  async get(folderId: string): Promise<CachedNote | undefined> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["notes_cache"], "readonly");
      const store = tx.objectStore("notes_cache");
      const req = store.get(folderId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<CachedNote[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["notes_cache"], "readonly");
      const store = tx.objectStore("notes_cache");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async save(note: CachedNote): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["notes_cache"], "readwrite");
      const store = tx.objectStore("notes_cache");
      const req = store.put(note);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async saveMany(notes: CachedNote[]): Promise<void> {
    if (notes.length === 0) return;
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["notes_cache"], "readwrite");
      const store = tx.objectStore("notes_cache");
      for (const note of notes) {
        store.put(note);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(folderId: string): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["notes_cache"], "readwrite");
      const store = tx.objectStore("notes_cache");
      const req = store.delete(folderId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["notes_cache"], "readwrite");
      const store = tx.objectStore("notes_cache");
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ─── Pending Notes Queue ───────────────────────────────────────────────────

  async enqueuePendingNote(edit: PendingNoteEdit): Promise<number> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pending_notes_queue"], "readwrite");
      const store = tx.objectStore("pending_notes_queue");
      const req = store.add(edit);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  }

  async getPendingNotes(): Promise<PendingNoteEdit[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pending_notes_queue"], "readonly");
      const store = tx.objectStore("pending_notes_queue");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async removePendingNote(id: number): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pending_notes_queue"], "readwrite");
      const store = tx.objectStore("pending_notes_queue");
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const notesRepository = new NotesRepository();
