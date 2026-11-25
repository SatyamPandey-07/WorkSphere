/**
 * @deprecated Standalone offlineStore.ts is deprecated in favor of unified offline storage in @/lib/offline.
 * Import directly from `@/lib/offline` instead.
 */

export { withWebLock, LockTimeoutError, type WebLockOptions } from "./webLock";
import { withWebLock } from "./webLock";
import { syncQueueManager } from "./offline/SyncQueueManager";
import {
  openDatabaseWithMigration,
  isConnectionValid,
} from "./offline/migrationCoordinator";
import { MigrationError } from "./offline/migrations/types";

// Register checkin handler with consolidated SyncQueueManager
syncQueueManager.registerHandler("checkin", async (item) => {
  const payload = item.payload as { venueId: string };
  if (!payload?.venueId) return;

  const res = await fetch(
    `/api/venues/${encodeURIComponent(payload.venueId)}/check-in`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: item.timestamp }),
    },
  );
  if (!res.ok) {
    throw new Error(`Check-in sync failed: ${res.statusText}`);
  }
});

// Register amenity_vote handler with consolidated SyncQueueManager
syncQueueManager.registerHandler("amenity_vote", async (item) => {
  const payload = item.payload as {
    venueId: string;
    amenityId?: string;
    vote?: number;
  };
  if (!payload?.venueId) return;

  const res = await fetch(
    `/api/venues/${encodeURIComponent(payload.venueId)}/amenity-votes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(`Amenity vote sync failed: ${res.statusText}`);
  }
});

const STORE_NAME = "favorites-outbox";
const CHECKIN_STORE_NAME = "checkins-outbox";
export const TAG_STORE_NAME = "favorite-tags-outbox";
const DB_NAME = "WorkSphereOfflineDB";

export const MAX_SYNC_RETRIES = 3;

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
  seatId?: string;
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

export function getDB(): Promise<IDBDatabase> {
  // Guard: IndexedDB is not available in SSR / Node environments.
  // Checking `indexedDB` directly (rather than `window`) ensures that
  // contexts such as Service Workers — which expose indexedDB without a
  // window object — are not incorrectly rejected.
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is not available on server-side"),
    );
  }

  // Fast path — return the already-open connection immediately if still valid.
  if (dbInstance !== null && isConnectionValid(dbInstance)) {
    return Promise.resolve(dbInstance);
  }
  dbInstance = null;

  // In-flight path — a previous caller already issued indexedDB.open();
  // share that same Promise instead of opening a second connection.
  if (dbPromise !== null) {
    return dbPromise;
  }

  // Slow path — coordinate through the shared WorkSphereOfflineDB v3 migration registry.
  dbPromise = openDatabaseWithMigration(DB_NAME, {
    context: "page",
    targetVersion: 3,
    timeoutMs: 3000,
    onVersionChange: () => {
      console.warn(
        "[OfflineStore] Database version change detected, closing connection gracefully",
      );
      dbInstance = null;
      dbPromise = null;
    },
  })
    .then((db) => {
      dbInstance = db;
      dbPromise = null;
      return db;
    })
    .catch((err: unknown) => {
      dbInstance = null;
      dbPromise = null;
      const cause = err instanceof MigrationError ? err.cause : err;
      const causeName = (cause as { name?: string } | null)?.name;
      if (
        causeName === "SecurityError" ||
        (err instanceof Error &&
          (err.name === "SecurityError" || err.message.includes("SecurityError")))
      ) {
        showPrivateBrowsingAlert();
      }
      throw err;
    });

  return dbPromise;
}

/**
 * Pushes a target action into the client IndexedDB transaction queue.
 * Wrapped with Web Locks API to serialize multi-tab storage access (#910),
 * now sharing the same lock as offlineStorage.ts (fix for #829).
 * @deprecated Use @/lib/offline instead.
 */
export async function queueOfflineFavorite(
  venueId: string,
  action: "ADD" | "REMOVE",
): Promise<void> {
  return withWebLock(async () => {
    try {
      const db = await getDB();

      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const queued = (request.result || []) as OfflineAction[];

          const sameVenue = queued.filter((item) => item.venueId === venueId);

          const existing = sameVenue[0];

          if (existing) {
            // Keep only the latest intended state for this venue.
            store.put({
              ...existing,
              action,
              timestamp: Date.now(),
              retryCount: 0,
            });

            // Remove any older duplicate entries for this venue.
            for (const item of sameVenue.slice(1)) {
              if (item.id !== undefined) {
                store.delete(item.id);
              }
            }
          } else {
            store.add({
              venueId,
              action,
              timestamp: Date.now(),
              retryCount: 0,
            });
          }
        };

        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (err: any) {
      console.error("Failed to queue offline action:", err);

      if (
        err.name === "SecurityError" ||
        String(err.message).includes("SecurityError")
      ) {
        return;
      }

      throw err;
    }
  });
}
/**
 * Retrieves all currently queued actions awaiting synchronization
 * @deprecated Use @/lib/offline instead.
 */
export async function getQueuedFavorites(): Promise<OfflineAction[]> {
  return withWebLock(async () => {
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
  });
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
  return withWebLock(async () => {
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
  });
}

/**
 * Restores a failed payload back into the queue by resetting its retryCount to 0.
 * This ensures network-disconnected items are not penalized with retry exhaustion
 * and are re-attempted on the next sync cycle without data loss.
 *
 * Returns `true` if the item was found and restored, `false` if the item no longer exists.
 */
export async function restoreFailedPayload(id: number): Promise<boolean> {
  return withWebLock(async () => {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
          const existing = getRequest.result as OfflineAction | undefined;
          if (!existing) {
            resolve(false);
            return;
          }
          store.put({ ...existing, retryCount: 0 });
          tx.oncomplete = () => resolve(true);
        };
        getRequest.onerror = () => reject(getRequest.error);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error("Failed to restore failed payload:", err);
      return false;
    }
  });
}

/**
 * Clears an action from the store once it has been processed
 * @deprecated Use @/lib/offline instead.
 */
export async function dequeueOfflineAction(id: number): Promise<void> {
  if (id === undefined || id === null || isNaN(id)) return;
  return withWebLock(async () => {
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
  });
}

/**
 * Pushes a check-in action into the client IndexedDB checkin queue.
 * @deprecated Use @/lib/offline instead.
 */
export async function queueOfflineCheckIn(
  venueId: string,
  seatId?: string,
): Promise<void> {
  return withWebLock(async () => {
    try {
      const db = await getDB();

      // Check for existing identical un-synced checkin for same venue and seat
      const existing = await new Promise<OfflineCheckIn | undefined>(
        (resolve, reject) => {
          const tx = db.transaction(CHECKIN_STORE_NAME, "readonly");
          const store = tx.objectStore(CHECKIN_STORE_NAME);
          const request = store.getAll();
          request.onsuccess = () =>
            resolve(
              (request.result || []).find(
                (a) =>
                  a.venueId === venueId &&
                  (seatId === undefined || a.seatId === seatId),
              ),
            );
          request.onerror = () => reject(request.error);
        },
      );
      if (existing) return;

      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CHECKIN_STORE_NAME, "readwrite");
        const store = tx.objectStore(CHECKIN_STORE_NAME);
        store.add({
          venueId,
          seatId,
          timestamp: Date.now(),
          retryCount: 0,
        });
        void syncQueueManager
          .enqueue<OfflineCheckIn>({
            entity: "checkin",
            action: "create",
            payload: { venueId, seatId, timestamp: Date.now() },
          })
          .catch(() => {});
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error("Failed to queue offline check-in:", err);
      throw err; // let the caller (UI / service worker) know the write did not happen
    }
  });
}

/**
 * Retrieves all queued check-ins
 * @deprecated Use @/lib/offline instead.
 */
export async function getQueuedCheckIns(): Promise<OfflineCheckIn[]> {
  return withWebLock(async () => {
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
  });
}

/**
 * Records a failed sync attempt for a queued check-in
 * @deprecated Use @/lib/offline instead.
 */
export async function incrementCheckInRetryCount(
  id: number,
): Promise<number | null> {
  return withWebLock(async () => {
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
  });
}

/**
 * Clears a check-in from the store
 * @deprecated Use @/lib/offline instead.
 */
export async function dequeueOfflineCheckIn(id: number): Promise<void> {
  return withWebLock(async () => {
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
  });
}
