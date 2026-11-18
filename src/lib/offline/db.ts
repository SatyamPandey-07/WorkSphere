export const OFFLINE_DB_NAME = "WorkSphereOfflineDB";
export const OFFLINE_DB_VERSION = 3;
export const DEFAULT_DB_OPEN_TIMEOUT_MS = 4000;

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

export interface InitOfflineDBOptions {
  timeoutMs?: number;
  version?: number;
}

function showPrivateBrowsingAlert() {
  if (typeof window === "undefined") return;
  if (
    (window as unknown as { __worksphere_offline_alert_shown?: boolean })
      .__worksphere_offline_alert_shown
  ) {
    return;
  }
  (
    window as unknown as { __worksphere_offline_alert_shown?: boolean }
  ).__worksphere_offline_alert_shown = true;
  alert(
    "Offline storage is disabled because Safari Private Browsing blocks database access. Please disable Private Browsing to use offline features.",
  );
}

export async function initOfflineDB(
  options: InitOfflineDBOptions = {},
): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is not available on server-side"),
    );
  }

  if (dbInstance !== null) {
    return Promise.resolve(dbInstance);
  }

  if (dbPromise !== null) {
    return dbPromise;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_DB_OPEN_TIMEOUT_MS;
  const targetVersion = options.version ?? OFFLINE_DB_VERSION;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;

    const cleanupPending = () => {
      dbInstance = null;
      dbPromise = null;
    };

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanupPending();
        const timeoutErr = new DOMException(
          `IndexedDB open timed out after ${timeoutMs}ms`,
          "TimeoutError",
        );
        console.warn("[OfflineDB] IndexedDB open timed out:", timeoutErr);
        reject(timeoutErr);
      }
    }, timeoutMs);

    try {
      const request = indexedDB.open(OFFLINE_DB_NAME, targetVersion);

      request.onblocked = () => {
        console.warn(
          "[OfflineDB] Database version upgrade blocked by open connection, closing stale handle",
        );
        if (dbInstance) {
          try {
            dbInstance.close();
          } catch {
            // ignore close error
          }
        }
        cleanupPending();
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(
            new DOMException(
              "IndexedDB upgrade blocked by another open connection",
              "VersionError",
            ),
          );
        }
      };

      request.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (dbInstance) {
          try {
            dbInstance.close();
          } catch {
            // ignore
          }
        }
        cleanupPending();
        const err = request.error || new Error("Unknown IndexedDB open error");
        if (err.name === "SecurityError") {
          showPrivateBrowsingAlert();
        } else if (err.name === "VersionError") {
          console.warn(
            "[OfflineDB] Schema VersionError detected; falling back gracefully",
            err,
          );
        }
        reject(err);
      };

      request.onsuccess = () => {
        if (settled) {
          try {
            request.result.close();
          } catch {
            // ignore
          }
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        dbInstance = request.result;
        dbPromise = null;

        dbInstance.onversionchange = () => {
          try {
            dbInstance?.close();
          } catch {
            // ignore
          }
          dbInstance = null;
          dbPromise = null;
        };

        resolve(dbInstance);
      };

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;

        if (transaction) {
          transaction.onabort = (e) => {
            console.warn(
              "[OfflineDB] Upgrade transaction aborted",
              transaction.error || e,
            );
          };
          transaction.onerror = (e) => {
            console.warn(
              "[OfflineDB] Upgrade transaction error",
              transaction.error || e,
            );
          };
        }

        database.onversionchange = () => {
          console.warn(
            "[OfflineDB] Database version change during upgrade, closing connection gracefully",
          );
          try {
            database.close();
          } catch {
            // ignore
          }
          if (dbInstance === database) {
            dbInstance = null;
          }
        };

        // Venues store
        if (!database.objectStoreNames.contains("venues")) {
          const venuesStore = database.createObjectStore("venues", {
            keyPath: "id",
          });
          venuesStore.createIndex("type", "type", { unique: false });
          venuesStore.createIndex("savedAt", "savedAt", { unique: false });
        }

        // Favorites store
        if (!database.objectStoreNames.contains("favorites")) {
          const favoritesStore = database.createObjectStore("favorites", {
            keyPath: "id",
          });
          favoritesStore.createIndex("savedAt", "savedAt", { unique: false });
        }

        // Search history store
        if (!database.objectStoreNames.contains("searches")) {
          const searchesStore = database.createObjectStore("searches", {
            keyPath: "query",
          });
          searchesStore.createIndex("timestamp", "timestamp", {
            unique: false,
          });
        }

        // Generic pending sync queue
        if (!database.objectStoreNames.contains("pending_sync_queue")) {
          const syncStore = database.createObjectStore("pending_sync_queue", {
            keyPath: "id",
          });
          syncStore.createIndex("domain", "domain", { unique: false });
          syncStore.createIndex("status", "status", { unique: false });
          syncStore.createIndex("timestamp", "timestamp", { unique: false });
        }

        // Pending actions store
        if (!database.objectStoreNames.contains("pendingActions")) {
          database.createObjectStore("pendingActions", {
            keyPath: "id",
            autoIncrement: true,
          });
        }

        // Receipts store
        if (!database.objectStoreNames.contains("receiptExports")) {
          const receiptStore = database.createObjectStore("receiptExports", {
            keyPath: "bookingId",
          });
          receiptStore.createIndex("status", "status", { unique: false });
          receiptStore.createIndex("createdAt", "createdAt", {
            unique: false,
          });
        }

        // Pending favorites store
        if (!database.objectStoreNames.contains("pendingFavorites")) {
          database.createObjectStore("pendingFavorites", { keyPath: "id" });
        }

        // Preference reranking store
        if (!database.objectStoreNames.contains("preference_rankings")) {
          database.createObjectStore("preference_rankings", { keyPath: "id" });
        }

        // Recently viewed venues store
        if (!database.objectStoreNames.contains("recentlyViewedVenues")) {
          const recentStore = database.createObjectStore(
            "recentlyViewedVenues",
            {
              keyPath: "id",
            },
          );
          recentStore.createIndex("viewedAt", "viewedAt", { unique: false });
        }

        // Pending reviews store
        if (!database.objectStoreNames.contains("pendingReviews")) {
          const reviewStore = database.createObjectStore("pendingReviews", {
            keyPath: "id",
          });
          reviewStore.createIndex("venueId", "venueId", { unique: false });
          reviewStore.createIndex("status", "status", { unique: false });
          reviewStore.createIndex("createdAt", "createdAt", {
            unique: false,
          });
        }

        // Collaborative notes stores
        if (!database.objectStoreNames.contains("pending_notes_queue")) {
          const notesQueue = database.createObjectStore("pending_notes_queue", {
            keyPath: "id",
            autoIncrement: true,
          });
          notesQueue.createIndex("by-folder", "folderId");
        }

        if (!database.objectStoreNames.contains("notes_cache")) {
          database.createObjectStore("notes_cache", { keyPath: "folderId" });
        }

        // Favorite tags store
        if (!database.objectStoreNames.contains("favorite_tags")) {
          database.createObjectStore("favorite_tags", { keyPath: "id" });
        }

        // CRDT state vector records and tombstones store (#6488)
        if (!database.objectStoreNames.contains("crdt_tombstones")) {
          const tombstoneStore = database.createObjectStore("crdt_tombstones", { keyPath: "id" });
          tombstoneStore.createIndex("deletedAt", "deletedAt", { unique: false });
          tombstoneStore.createIndex("isMerged", "isMerged", { unique: false });
        }
      };
    } catch (err: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanupPending();
      if (err instanceof Error && err.name === "SecurityError") {
        showPrivateBrowsingAlert();
      }
      reject(err);
    }
  });

  return dbPromise;
}

export const getDB = initOfflineDB;

export function closeOfflineDB(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }
  dbPromise = null;
}

/**
 * Reads every record of one store from the existing offline database. The
 * database is opened without a version, at whatever version it has, so a
 * schema newer than this build does not raise a VersionError. Returns an
 * empty list when the database or the store cannot be read.
 */
async function readExistingStore(storeName: string): Promise<unknown[]> {
  if (typeof indexedDB === "undefined") return [];

  return new Promise<unknown[]>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(OFFLINE_DB_NAME);
    } catch {
      resolve([]);
      return;
    }
    request.onerror = () => resolve([]);
    request.onblocked = () => resolve([]);
    request.onsuccess = () => {
      const database = request.result;
      const finish = (items: unknown[]) => {
        database.close();
        resolve(items);
      };
      if (!database.objectStoreNames.contains(storeName)) {
        finish([]);
        return;
      }
      try {
        const getAll = database
          .transaction([storeName], "readonly")
          .objectStore(storeName)
          .getAll();
        getAll.onsuccess = () => finish(getAll.result ?? []);
        getAll.onerror = () => finish([]);
      } catch {
        finish([]);
      }
    };
  });
}

function recordId(item: unknown): unknown {
  return item && typeof item === "object"
    ? (item as { id?: unknown }).id
    : undefined;
}

/**
 * Non-destructive database reset utility:
 * Snapshots the pending items already stored in `storeName` together with
 * `preserveItems` (for example an in-memory fallback queue), deletes the
 * conflicted IndexedDB schema, re-initializes the latest schema cleanly, and
 * restores all of those items. An item present in both places is restored
 * once, from `preserveItems`.
 */
export async function resetOfflineDBNonDestructive(
  preserveItems: unknown[] = [],
  storeName = "pending_sync_queue",
): Promise<{ restoredCount: number }> {
  closeOfflineDB();

  const stored = await readExistingStore(storeName);
  const byId = new Map<unknown, unknown>();
  const withoutId: unknown[] = [];
  for (const item of [...stored, ...preserveItems]) {
    const id = recordId(item);
    if (id === undefined) withoutId.push(item);
    else byId.set(id, item);
  }
  const itemsToRestore = [...byId.values(), ...withoutId];

  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve) => {
      const delReq = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => resolve();
      delReq.onblocked = () => resolve();
    });
  }

  const freshDb = await initOfflineDB();

  if (
    itemsToRestore.length > 0 &&
    freshDb.objectStoreNames.contains(storeName)
  ) {
    await new Promise<void>((resolve, reject) => {
      const tx = freshDb.transaction([storeName], "readwrite");
      const store = tx.objectStore(storeName);
      for (const item of itemsToRestore) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { restoredCount: itemsToRestore.length };
}