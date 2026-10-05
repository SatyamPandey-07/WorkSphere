/**
 * Central IndexedDB connection and schema manager.
 */

export const DB_NAME = "worksphere-offline";
export const DB_VERSION = 8;

let dbInstance: IDBDatabase | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    dbInstance?.close();
    dbInstance = null;
  });
}

function showPrivateBrowsingAlert() {
  if (typeof window === "undefined") return;
  if ((window as any).__worksphere_offline_alert_shown) return;
  (window as any).__worksphere_offline_alert_shown = true;
  alert(
    "Offline storage is disabled because Safari Private Browsing blocks database access. Please disable Private Browsing to use offline features.",
  );
}

export async function initOfflineDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn("[OfflineDB] IndexedDB open timed out (likely Safari Private Browsing)");
        reject(new DOMException("IndexedDB open timed out", "SecurityError"));
      }
    }, 3000);

    try {
      if (typeof indexedDB === "undefined") {
        clearTimeout(timeoutId);
        return reject(new Error("IndexedDB is not supported in this environment"));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = () => {
        console.warn("[OfflineDB] Database upgrade blocked");
      };

      request.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        const err = request.error || new Error("Unknown IndexedDB error");
        if (err.name === "SecurityError") {
          showPrivateBrowsingAlert();
        }
        reject(err);
      };

      request.onsuccess = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        dbInstance = request.result;
        dbInstance.onversionchange = () => {
          dbInstance?.close();
          dbInstance = null;
        };
        resolve(dbInstance);
      };

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;

        // Venues store
        if (!database.objectStoreNames.contains("venues")) {
          const venuesStore = database.createObjectStore("venues", { keyPath: "id" });
          venuesStore.createIndex("type", "type", { unique: false });
          venuesStore.createIndex("savedAt", "savedAt", { unique: false });
        }

        // Favorites store
        if (!database.objectStoreNames.contains("favorites")) {
          const favoritesStore = database.createObjectStore("favorites", { keyPath: "id" });
          favoritesStore.createIndex("savedAt", "savedAt", { unique: false });
        }

        // Search history store
        if (!database.objectStoreNames.contains("searches")) {
          const searchesStore = database.createObjectStore("searches", { keyPath: "query" });
          searchesStore.createIndex("timestamp", "timestamp", { unique: false });
        }

        // Generic pending sync queue
        if (!database.objectStoreNames.contains("pending_sync_queue")) {
          const syncStore = database.createObjectStore("pending_sync_queue", { keyPath: "id" });
          syncStore.createIndex("domain", "domain", { unique: false });
          syncStore.createIndex("status", "status", { unique: false });
          syncStore.createIndex("timestamp", "timestamp", { unique: false });
        }

        // Pending actions store
        if (!database.objectStoreNames.contains("pendingActions")) {
          database.createObjectStore("pendingActions", { keyPath: "id", autoIncrement: true });
        }

        // Receipts store
        if (!database.objectStoreNames.contains("receiptExports")) {
          const receiptStore = database.createObjectStore("receiptExports", { keyPath: "bookingId" });
          receiptStore.createIndex("status", "status", { unique: false });
          receiptStore.createIndex("createdAt", "createdAt", { unique: false });
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
          const recentStore = database.createObjectStore("recentlyViewedVenues", { keyPath: "id" });
          recentStore.createIndex("viewedAt", "viewedAt", { unique: false });
        }

        // Pending reviews store
        if (!database.objectStoreNames.contains("pendingReviews")) {
          const reviewStore = database.createObjectStore("pendingReviews", { keyPath: "id" });
          reviewStore.createIndex("venueId", "venueId", { unique: false });
          reviewStore.createIndex("status", "status", { unique: false });
          reviewStore.createIndex("createdAt", "createdAt", { unique: false });
        }

        // Collaborative notes stores
        if (!database.objectStoreNames.contains("pending_notes_queue")) {
          const notesQueue = database.createObjectStore("pending_notes_queue", { keyPath: "id", autoIncrement: true });
          notesQueue.createIndex("by-folder", "folderId");
        }

        if (!database.objectStoreNames.contains("notes_cache")) {
          database.createObjectStore("notes_cache", { keyPath: "folderId" });
        }

        // Favorite tags store
        if (!database.objectStoreNames.contains("favorite_tags")) {
          database.createObjectStore("favorite_tags", { keyPath: "id" });
        }
      };
    } catch (err: any) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (err.name === "SecurityError") {
        showPrivateBrowsingAlert();
      }
      reject(err);
    }
  });
}

export const getDB = initOfflineDB;

export function closeOfflineDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
