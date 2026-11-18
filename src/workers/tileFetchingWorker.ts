/**
 * tileFetchingWorker.ts
 * Background worker that downloads, caches, and indexes vector tiles into IndexedDB for offline use.
 * Ensures seamless map rendering even when the cafe WiFi drops.
 */

const DB_NAME = "WorkSphereMapTilesDB";
const STORE_NAME = "vector_tiles";
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
};

const saveTile = async (id: string, data: ArrayBuffer): Promise<void> => {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const tx = db!.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put({ id, data, timestamp: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getTile = async (id: string): Promise<ArrayBuffer | null> => {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const tx = db!.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () =>
      resolve(request.result ? request.result.data : null);
    request.onerror = () => reject(request.error);
  });
};

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === "FETCH_AND_CACHE_TILE") {
    const { tileId, url } = payload;
    try {
      // Check cache first
      const cached = await getTile(tileId);
      if (cached) {
        self.postMessage({
          type: "TILE_READY",
          payload: { tileId, source: "cache", data: cached },
        });
        return;
      }

      // Fetch from network
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const buffer = await response.arrayBuffer();
      await saveTile(tileId, buffer);

      self.postMessage({
        type: "TILE_READY",
        payload: { tileId, source: "network", data: buffer },
      });
    } catch (error) {
      self.postMessage({
        type: "TILE_ERROR",
        payload: { tileId, error: String(error) },
      });
    }
  }
};

export {};
