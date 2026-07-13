import { openDB, IDBPDatabase } from 'idb';

const STORE_NAME = 'favorites-outbox';
const DB_NAME = 'WorkSphereOfflineDB';

export interface OfflineAction {
  id?: number;
  venueId: string;
  action: 'ADD' | 'REMOVE';
  timestamp: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise && typeof window !== 'undefined') {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Pushes a target action into the client IndexedDB transaction queue
 */
export async function queueOfflineFavorite(venueId: string, action: 'ADD' | 'REMOVE'): Promise<void> {
  const db = await getDB();
  if (!db) return;

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  
  await store.add({
    venueId,
    action,
    timestamp: Date.now(),
  });
  
  await tx.done;
}

/**
 * Retrieves all currently queued actions awaiting synchronization
 */
export async function getQueuedFavorites(): Promise<OfflineAction[]> {
  const db = await getDB();
  if (!db) return [];
  return db.getAll(STORE_NAME);
}

/**
 * Clears an action from the store once it has been processed
 */
export async function dequeueOfflineAction(id: number): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.objectStore(STORE_NAME).delete(id);
  await tx.done;
}