import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { HNSWIndex } from "@/lib/hnsw/hnsw";
import {
  deserializeHnswIndex,
  serializeHnswIndex,
} from "@/lib/hnsw/hnswSerializer";

const DATABASE_NAME = "WorkSphereHnswCache";
const DATABASE_VERSION = 1;
const INDEX_STORE = "indexes";

interface HnswCacheDB extends DBSchema {
  indexes: {
    key: string;
    value: { version: string; data: ArrayBuffer };
  };
}

let databasePromise: Promise<IDBPDatabase<HnswCacheDB>> | null = null;

function getDatabase(): Promise<IDBPDatabase<HnswCacheDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  if (!databasePromise) {
    databasePromise = openDB<HnswCacheDB>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(INDEX_STORE)) {
          database.createObjectStore(INDEX_STORE);
        }
      },
    });
  }
  return databasePromise;
}

export async function getCachedHnswIndex(
  key: string,
  serverVersion: string,
): Promise<HNSWIndex | null> {
  if (!key || typeof key !== "string") return null;
  const database = await getDatabase();
  const cached = await database.get(INDEX_STORE, key);
  if (!cached || cached.version !== serverVersion) return null;
  return deserializeHnswIndex(cached.data);
}

import {
  isQuotaExceededError,
  dispatchStorageQuotaWarning,
} from "@/lib/cache/storageQuota";

export async function clearHnswCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await getDatabase();
    await database.clear(INDEX_STORE);
  } catch (err) {
    console.error("[HNSWCache] Failed to clear index store:", err);
  }
}

export async function cacheHnswIndex(
  key: string,
  serverVersion: string,
  index: HNSWIndex,
): Promise<void> {
  const database = await getDatabase();
  const serialized = serializeHnswIndex(index);

  const attemptWrite = () =>
    database.put(
      INDEX_STORE,
      { version: serverVersion, data: serialized },
      key,
    );

  try {
    await attemptWrite();
  } catch (err) {
    if (!isQuotaExceededError(err)) {
      throw err;
    }

    console.warn("[HNSWCache] Storage quota exceeded; clearing index cache and retrying.");
    dispatchStorageQuotaWarning("hnswCache", err);

    try {
      // Auto-purge ephemeral index cache before retrying
      await database.clear(INDEX_STORE);
      await attemptWrite();
    } catch (retryErr) {
      console.warn("[HNSWCache] Retrying after cache clear also failed or hit quota:", retryErr);
      // Fail gracefully without unhandled promise rejection
    }
  }
}

export async function getOrFetchHnswIndex(
  key: string,
  serverVersion: string,
  fetchIndex: () => Promise<HNSWIndex>,
): Promise<HNSWIndex> {
  const cached = await getCachedHnswIndex(key, serverVersion);
  if (cached) return cached;

  const index = await fetchIndex();
  await cacheHnswIndex(key, serverVersion, index);
  return index;
}

export function resetHnswCacheConnection(): void {
  databasePromise = null;
}