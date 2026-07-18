const STORE_NAME = "favorites-outbox";
const DB_NAME = "WorkSphereOfflineDB";

export interface OfflineAction {
  id?: number;
  venueId: string;
  action: "ADD" | "REMOVE";
  timestamp: number;
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
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {
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
 *
 * Key assignment is deliberately left to IndexedDB's built-in autoIncrement
 * generator — do NOT supply an explicit `id` field.  A hand-crafted key based
 * on Date.now() collides when two clicks arrive within the same millisecond
 * (double-click), producing a ConstraintError on the second store.add() call.
 * The autoIncrement counter is serialised by the IndexedDB engine and is
 * guaranteed to be unique across concurrent transactions. (Issue #395)
 */
export async function queueOfflineFavorite(
  venueId: string,
  action: "ADD" | "REMOVE",
): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      // No `id` field — let the autoIncrement keyPath assign a collision-free key.
      store.add({
        venueId,
        action,
        timestamp: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to queue offline action:", err);
  }
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
