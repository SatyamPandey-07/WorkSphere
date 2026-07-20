const STORE_NAME = "favorites-outbox";
const CHECKIN_STORE_NAME = "checkins-outbox";
const DB_NAME = "WorkSphereOfflineDB";

/**
 * Maximum number of times the service worker will attempt to sync a queued
 * action before giving up. Once an action hits this count, it is removed
 * from the outbox and the user is notified via a postMessage to open
 * clients (see public/sw.js `syncFavoritesOutbox`) — it is never silently
 * dropped. (Issue #712)
 */
export const MAX_SYNC_RETRIES = 3;

const IDB_LOCK_NAME = "worksphere-offline-store-lock";

/**
 * Web Locks API wrapper to serialize IndexedDB transactions across multiple concurrent browser tabs.
 * Prevents IndexedDB transaction deadlock during offline outbox sync (#910).
 */
export async function withWebLock<T>(
  callback: () => Promise<T>,
  lockName = IDB_LOCK_NAME,
): Promise<T> {
  if (
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    navigator.locks?.request
  ) {
    try {
      return await navigator.locks.request(lockName, async () => {
        return callback();
      });
    } catch {
      return callback();
    }
  }
  return callback();
}

export interface OfflineAction {
  id?: number;
  venueId: string;
  action: "ADD" | "REMOVE";
  timestamp: number;
  /** Number of failed sync attempts so far. Defaults to 0 for new actions. */
  retryCount?: number;
}

export interface OfflineCheckIn {
  id?: number;
  venueId: string;
  timestamp: number;
  retryCount?: number;
}

// ---------------------------------------------------------------------------
// Singleton connection state
//
// dbInstance  — the live IDBDatabase once the DB is open
// dbPromise   — the in-flight Promise while the DB is opening
//
// Rules:
//   • Only ONE indexedDB.open() call is ever in-flight at a time.
//   • Concurrent callers all await the same dbPromise.
//   • A failed open clears both variables so the next caller retries cleanly.
//   • A versionchange event closes the stale connection and clears the cache.
//   • beforeunload closes the connection gracefully (registered once).
// ---------------------------------------------------------------------------
let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

// Register the beforeunload cleanup at module load time.
// { once: true } auto-removes the listener after it fires, preventing it from
// running on subsequent navigations in long-lived SPAs.  HMR reloads
// re-execute this block and register a new listener each time, but the
// operations (db.close() and null assignments) are idempotent so duplicate
// registrations are harmless.
if (typeof window !== "undefined") {
  window.addEventListener(
    "beforeunload",
    () => {
      dbInstance?.close();
      dbInstance = null;
      dbPromise = null;
    },
    { once: true },
  );
}

function showPrivateBrowsingAlert() {
  if (typeof window === "undefined") return;
  if ((window as any).__worksphere_offline_alert_shown) return;
  (window as any).__worksphere_offline_alert_shown = true;
  alert(
    "Offline storage is disabled because Safari Private Browsing blocks database access. Please disable Private Browsing to use offline features.",
  );
}

function getDB(): Promise<IDBDatabase> {
  // Guard: IndexedDB is not available in SSR / Node environments.
  // Checking `indexedDB` directly (rather than `window`) ensures that
  // contexts such as Service Workers — which expose indexedDB without a
  // window object — are not incorrectly rejected.
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is not available on server-side"),
    );
  }

  // Fast path — return the already-open connection immediately.
  if (dbInstance !== null) {
    return Promise.resolve(dbInstance);
  }

  // In-flight path — a previous caller already issued indexedDB.open();
  // share that same Promise instead of opening a second connection.
  if (dbPromise !== null) {
    return dbPromise;
  }

  // Slow path — first caller: open the database and cache the Promise.
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, 2);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
        if (!db.objectStoreNames.contains(CHECKIN_STORE_NAME)) {
          db.createObjectStore(CHECKIN_STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        // Handle external schema upgrades (e.g. another tab calling a higher
        // DB version).  Close the stale connection and clear the singleton so
        // the next getDB() call re-opens with the new version.
        db.onversionchange = () => {
          db.close();
          dbInstance = null;
          dbPromise = null;
        };

        dbInstance = db;
        dbPromise = null; // opening is complete; dbInstance is now the sole authority
        resolve(db);
      };

      request.onerror = () => {
        // Clear both variables so the next getDB() call starts fresh.
        dbInstance = null;
        dbPromise = null;
        const err = request.error || new Error("Unknown IndexedDB error");
        if (err.name === "SecurityError") {
          showPrivateBrowsingAlert();
        }
        reject(err);
      };
    } catch (err: any) {
      dbInstance = null;
      dbPromise = null;
      if (err.name === "SecurityError") {
        showPrivateBrowsingAlert();
      }
      reject(err);
    }
  });

  return dbPromise;
}

/**
 * Pushes a target action into the client IndexedDB transaction queue.
 * Wrapped with Web Locks API to serialize multi-tab storage access (#910).
 */
export async function queueOfflineFavorite(
  venueId: string,
  action: "ADD" | "REMOVE",
): Promise<void> {
  return withWebLock(async () => {
    try {
      const db = await getDB();

      // Check for existing identical action before inserting
      const existing = await new Promise<OfflineAction | undefined>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const request = store.getAll();
          request.onsuccess = () =>
            resolve(
              (request.result || []).find(
                (a) => a.venueId === venueId && a.action === action,
              ),
            );
          request.onerror = () => reject(request.error);
        },
      );
      if (existing) return;

      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.add({
          venueId,
          action,
          timestamp: Date.now(),
          retryCount: 0,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error("Failed to queue offline action:", err);
    }
  });
}

/**
 * Retrieves all currently queued actions awaiting synchronization
 */
export async function getQueuedFavorites(): Promise<OfflineAction[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to get queued actions:", err);
    return [];
  }
}

/**
 * Records a failed sync attempt for a queued action and returns the updated
 * retry count. Called by the service worker each time a fetch to
 * `/api/favorites` fails or returns a non-OK status for a given action.
 *
 * Returns `null` if the action no longer exists (e.g. it was already
 * dequeued by a concurrent sync pass).
 */
export async function incrementRetryCount(id: number): Promise<number | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result as OfflineAction | undefined;
        if (!existing) {
          resolve(null);
          return;
        }
        const nextCount = (existing.retryCount ?? 0) + 1;
        store.put({ ...existing, retryCount: nextCount });
        tx.oncomplete = () => resolve(nextCount);
      };
      getRequest.onerror = () => reject(getRequest.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to increment retry count:", err);
    return null;
  }
}

/**
 * Clears an action from the store once it has been processed
 */
export async function dequeueOfflineAction(id: number): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to dequeue offline action:", err);
  }
}

/**
 * Pushes a check-in action into the client IndexedDB checkin queue.
 */
export async function queueOfflineCheckIn(venueId: string): Promise<void> {
  return withWebLock(async () => {
    try {
      const db = await getDB();

      // Check for existing identical un-synced checkin for same venue
      const existing = await new Promise<OfflineCheckIn | undefined>(
        (resolve, reject) => {
          const tx = db.transaction(CHECKIN_STORE_NAME, "readonly");
          const store = tx.objectStore(CHECKIN_STORE_NAME);
          const request = store.getAll();
          request.onsuccess = () =>
            resolve((request.result || []).find((a) => a.venueId === venueId));
          request.onerror = () => reject(request.error);
        },
      );
      if (existing) return;

      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CHECKIN_STORE_NAME, "readwrite");
        const store = tx.objectStore(CHECKIN_STORE_NAME);
        store.add({
          venueId,
          timestamp: Date.now(),
          retryCount: 0,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error("Failed to queue offline check-in:", err);
    }
  });
}

/**
 * Retrieves all queued check-ins
 */
export async function getQueuedCheckIns(): Promise<OfflineCheckIn[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHECKIN_STORE_NAME, "readonly");
      const store = tx.objectStore(CHECKIN_STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to get queued check-ins:", err);
    return [];
  }
}

/**
 * Records a failed sync attempt for a queued check-in
 */
export async function incrementCheckInRetryCount(
  id: number,
): Promise<number | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHECKIN_STORE_NAME, "readwrite");
      const store = tx.objectStore(CHECKIN_STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result as OfflineCheckIn | undefined;
        if (!existing) {
          resolve(null);
          return;
        }
        const nextCount = (existing.retryCount ?? 0) + 1;
        store.put({ ...existing, retryCount: nextCount });
        tx.oncomplete = () => resolve(nextCount);
      };
      getRequest.onerror = () => reject(getRequest.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to increment check-in retry count:", err);
    return null;
  }
}

/**
 * Clears a check-in from the store
 */
export async function dequeueOfflineCheckIn(id: number): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHECKIN_STORE_NAME, "readwrite");
      const store = tx.objectStore(CHECKIN_STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to dequeue offline check-in:", err);
  }
}
