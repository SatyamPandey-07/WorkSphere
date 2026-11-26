import {
  openDatabaseWithMigration,
  isConnectionValid,
  clearMigrationCheckpoint,
} from "./migrationCoordinator";
import { MigrationError } from "./migrations/types";

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

  if (dbInstance !== null && isConnectionValid(dbInstance)) {
    return Promise.resolve(dbInstance);
  }
  dbInstance = null;

  if (dbPromise !== null) {
    return dbPromise;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_DB_OPEN_TIMEOUT_MS;
  const targetVersion = options.version ?? OFFLINE_DB_VERSION;

  dbPromise = openDatabaseWithMigration(OFFLINE_DB_NAME, {
    context: "page",
    targetVersion,
    timeoutMs,
    onVersionChange: () => {
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
      const errName = (cause as { name?: string } | null)?.name;
      if (
        errName === "SecurityError" ||
        (err instanceof Error && err.message.includes("SecurityError"))
      ) {
        showPrivateBrowsingAlert();
      }
      throw err;
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
    await clearMigrationCheckpoint(OFFLINE_DB_NAME);
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