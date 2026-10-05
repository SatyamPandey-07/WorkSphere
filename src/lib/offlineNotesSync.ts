/**
 * Offline optimistic updates queue and LWW (Last-Write-Wins) sync manager
 * for collaborative collection notes (#3786).
 *
 * Persists pending notes edits into IndexedDB when offline,
 * and replays them to PartyKit / PostgreSQL upon reconnection using LWW timestamping.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "worksphere-collaborative-notes";
const DB_VERSION = 1;
const QUEUE_STORE = "pending_notes_queue";
const CACHE_STORE = "notes_cache";

export type NoteSyncStatus = "saving" | "synced" | "offline_pending";

export interface PendingNoteEdit {
  id?: number;
  folderId: string;
  text: string;
  timestamp: number; // LWW timestamp
}

export interface CachedNote {
  folderId: string;
  text: string;
  updatedAt: number;
}

interface CollaborativeNotesDB extends DBSchema {
  pending_notes_queue: {
    key: number;
    value: PendingNoteEdit;
    indexes: { "by-folder": string };
  };
  notes_cache: {
    key: string;
    value: CachedNote;
  };
}

let dbPromise: Promise<IDBPDatabase<CollaborativeNotesDB>> | null = null;

export async function getCollaborativeNotesDb(): Promise<IDBPDatabase<CollaborativeNotesDB>> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this environment");
  }

  if (!dbPromise) {
    dbPromise = openDB<CollaborativeNotesDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const queue = db.createObjectStore(QUEUE_STORE, {
            keyPath: "id",
            autoIncrement: true,
          });
          queue.createIndex("by-folder", "folderId");
        }
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: "folderId" });
        }
      },
    });
  }
  return dbPromise;
}

export function resetCollaborativeNotesDbCache(): void {
  dbPromise = null;
}

/**
 * Saves the note text to the local IndexedDB cache for instant offline reads.
 */
export async function cacheNoteLocally(folderId: string, text: string, updatedAt: number = Date.now()): Promise<void> {
  try {
    const db = await getCollaborativeNotesDb();
    await db.put(CACHE_STORE, { folderId, text, updatedAt });
  } catch {
    // Graceful fallback if indexedDB is restricted
  }
}

/**
 * Loads the cached note from IndexedDB.
 */
export async function loadCachedNote(folderId: string): Promise<CachedNote | null> {
  try {
    const db = await getCollaborativeNotesDb();
    const item = await db.get(CACHE_STORE, folderId);
    return item ?? null;
  } catch {
    return null;
  }
}

/**
 * Enqueues a pending note edit into the IndexedDB queue with LWW timestamp.
 */
export async function enqueuePendingNoteEdit(
  folderId: string,
  text: string,
  timestamp: number = Date.now(),
): Promise<number | undefined> {
  try {
    const db = await getCollaborativeNotesDb();
    const id = await db.add(QUEUE_STORE, {
      folderId,
      text,
      timestamp,
    });
    // Also update local cache immediately
    await db.put(CACHE_STORE, { folderId, text, updatedAt: timestamp });
    return typeof id === "number" ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gets all pending edits for a folder.
 */
export async function getPendingEditsForFolder(folderId: string): Promise<PendingNoteEdit[]> {
  try {
    const db = await getCollaborativeNotesDb();
    return await db.getAllFromIndex(QUEUE_STORE, "by-folder", folderId);
  } catch {
    return [];
  }
}

/**
 * Gets total count of pending edits across all folders or a specific folder.
 */
export async function getPendingNotesCount(folderId?: string): Promise<number> {
  try {
    const db = await getCollaborativeNotesDb();
    if (folderId) {
      const list = await db.getAllFromIndex(QUEUE_STORE, "by-folder", folderId);
      return list.length;
    }
    return await db.count(QUEUE_STORE);
  } catch {
    return 0;
  }
}

/**
 * Clears pending edits for a folder once successfully synchronized.
 */
export async function clearPendingEditsForFolder(folderId: string): Promise<void> {
  try {
    const db = await getCollaborativeNotesDb();
    const items = await db.getAllFromIndex(QUEUE_STORE, "by-folder", folderId);
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    for (const item of items) {
      if (item.id != null) {
        await tx.store.delete(item.id);
      }
    }
    await tx.done;
  } catch {
    // Graceful fallback
  }
}

/**
 * Resolves multiple edits using Last-Write-Wins (LWW) based on timestamp.
 * Returns the winning edit with the latest timestamp.
 */
export function resolveLwwEdits(edits: PendingNoteEdit[]): PendingNoteEdit | null {
  if (!edits.length) return null;
  return edits.reduce((latest, current) => {
    return current.timestamp >= latest.timestamp ? current : latest;
  }, edits[0]);
}
