/**
 * Offline Data Storage using IndexedDB
 * Provides persistent storage for venues, favorites, and search history
 * Integrated with Yjs for CRDT-based offline state mutation and background sync.
 */
import * as Y from "yjs";

// Initialize global Y.Doc for user state
export const userDoc = new Y.Doc();
export const yFavorites = userDoc.getMap<OfflineVenue>("favorites");
export const yRatings = userDoc.getMap<Record<string, unknown>>("ratings");

// Automatically queue Yjs incremental updates for Background Sync
userDoc.on("update", async (update: Uint8Array) => {
  try {
    await queueCrdtUpdate(update);
  } catch (err) {
    console.error("Failed to queue CRDT update:", err);
  }
});

const DB_NAME = "worksphere-offline";
const DB_VERSION = 2;

const IDB_STORAGE_LOCK = "worksphere-offline-storage-lock";

/**
 * Web Locks API wrapper to serialize IndexedDB transactions across concurrent tabs (#910)
 */
export async function withWebLock<T>(
  callback: () => Promise<T>,
  lockName = IDB_STORAGE_LOCK,
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

export interface OfflineVenue {
  id: string;
  name: string;
  location?: string;
  latitude: number;
  longitude: number;
  type?: string;
  category?: string;
  address?: string;
  rating?: number;
  amenities?: string[];
  hasAncHeadsetRental?: boolean;
  savedAt?: number;
}

interface OfflineSearch {
  query: string;
  results: OfflineVenue[];
  timestamp: number;
}

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB
 */
function showPrivateBrowsingAlert() {
  if (typeof window === "undefined") return;
  if ((window as any).__worksphere_offline_alert_shown) return;
  (window as any).__worksphere_offline_alert_shown = true;
  alert(
    "Offline storage is disabled because Safari Private Browsing blocks database access. Please disable Private Browsing to use offline features.",
  );
}

export async function initOfflineDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("[OfflineDB] Failed to open database");
        const err = request.error || new Error("Unknown IndexedDB error");
        if (err.name === "SecurityError") {
          showPrivateBrowsingAlert();
        }
        reject(err);
      };

      request.onsuccess = () => {
        db = request.result;
        console.log("[OfflineDB] Database opened successfully");
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;

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

        // Pending actions store (for sync when back online)
        if (!database.objectStoreNames.contains("pendingActions")) {
          database.createObjectStore("pendingActions", {
            keyPath: "id",
            autoIncrement: true,
          });
        }

        console.log("[OfflineDB] Database schema created");
      };
    } catch (err: any) {
      console.error("[OfflineDB] Synchronous error on open:", err);
      if (err.name === "SecurityError") {
        showPrivateBrowsingAlert();
      }
      reject(err);
    }
  });
}

/**
 * Save venue to offline storage
 */
export async function saveVenueOffline(venue: OfflineVenue): Promise<void> {
  return withWebLock(async () => {
    const database = await initOfflineDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["venues"], "readwrite");
      const store = transaction.objectStore("venues");

      const request = store.put({
        ...venue,
        savedAt: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Get venue from offline storage
 */
export async function getVenueOffline(
  id: string,
): Promise<OfflineVenue | null> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["venues"], "readonly");
    const store = transaction.objectStore("venues");

    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all offline venues
 */
export async function getAllVenuesOffline(): Promise<OfflineVenue[]> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["venues"], "readonly");
    const store = transaction.objectStore("venues");

    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save favorite to offline storage
 */
export async function saveFavoriteOffline(venue: OfflineVenue): Promise<void> {
  return withWebLock(async () => {
    // 1. Update CRDT state (triggers userDoc.on('update') automatically)
    yFavorites.set(venue.id, venue);

    // 2. Update local IndexedDB for immediate UI reads
    const database = await initOfflineDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["favorites"], "readwrite");
      const store = transaction.objectStore("favorites");

      const request = store.put({
        ...venue,
        savedAt: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Remove favorite from offline storage
 */
export async function removeFavoriteOffline(id: string): Promise<void> {
  return withWebLock(async () => {
    // 1. Update CRDT state
    yFavorites.delete(id);

    // 2. Update local IndexedDB
    const database = await initOfflineDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["favorites"], "readwrite");
      const store = transaction.objectStore("favorites");

      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Get all offline favorites
 */
export async function getFavoritesOffline(): Promise<OfflineVenue[]> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["favorites"], "readonly");
    const store = transaction.objectStore("favorites");

    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save search results for offline use
 */
const MAX_SEARCH_HISTORY = 15;

export async function saveSearchOffline(
  query: string,
  results: OfflineVenue[],
): Promise<void> {
  const database = await initOfflineDB();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["searches"], "readwrite");
    const store = transaction.objectStore("searches");

    const request = store.put({
      query: query.toLowerCase().trim(),
      results,
      timestamp: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  await trimSearchHistory();
}

/**
 * Keep only the most recent MAX_SEARCH_HISTORY cached searches
 */
async function trimSearchHistory(): Promise<void> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["searches"], "readwrite");
    const store = transaction.objectStore("searches");
    const index = store.index("timestamp");

    // Keys ordered oldest -> newest by the timestamp index
    const request = index.getAllKeys();

    request.onsuccess = () => {
      const keys = request.result as IDBValidKey[];
      if (keys.length > MAX_SEARCH_HISTORY) {
        const keysToDelete = keys.slice(0, keys.length - MAX_SEARCH_HISTORY);
        keysToDelete.forEach((key) => store.delete(key));
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all cached searches, most recent first
 */
export async function getAllSearchesOffline(): Promise<OfflineSearch[]> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["searches"], "readonly");
    const store = transaction.objectStore("searches");
    const index = store.index("timestamp");

    const request = index.getAll();

    request.onsuccess = () => {
      const results = (request.result || []) as OfflineSearch[];
      resolve(results.reverse());
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get cached search results
 */
export async function getSearchOffline(
  query: string,
): Promise<OfflineSearch | null> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["searches"], "readonly");
    const store = transaction.objectStore("searches");

    const request = store.get(query.toLowerCase().trim());

    request.onsuccess = () => {
      const result = request.result;
      // Return cached results if less than 24 hours old
      if (result && Date.now() - result.timestamp < 24 * 60 * 60 * 1000) {
        resolve(result);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Queue action for when back online
 * Deduplicates by type + venueId to prevent duplicate entries from
 * rapid double-clicks while offline.
 */
export async function queuePendingAction(action: {
  type: "favorite" | "unfavorite" | "rate";
  venueId: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const checkTx = database.transaction(["pendingActions"], "readonly");
    const checkStore = checkTx.objectStore("pendingActions");
    const getAll = checkStore.getAll();

    getAll.onsuccess = () => {
      const existing = (
        getAll.result as Array<{ type: string; venueId: string; id: number }>
      ).find((a) => a.type === action.type && a.venueId === action.venueId);
      if (existing) {
        resolve();
        return;
      }

      const addTx = database.transaction(["pendingActions"], "readwrite");
      const addStore = addTx.objectStore("pendingActions");
      addStore.add({
        ...action,
        timestamp: Date.now(),
      });
      addTx.oncomplete = () => resolve();
      addTx.onerror = () => reject(addTx.error);
    };
    getAll.onerror = () => reject(getAll.error);
  });
}

/**
 * Queue a CRDT update payload
 */
export async function queueCrdtUpdate(update: Uint8Array): Promise<void> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["pendingActions"], "readwrite");
    const store = transaction.objectStore("pendingActions");

    const request = store.add({
      type: "crdt-sync",
      data: update,
      timestamp: Date.now(),
    });

    request.onsuccess = () => {
      // Attempt to register background sync if Service Worker is available
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        navigator.serviceWorker.ready.then((swRegistration) => {
          // Type casting since TS doesn't fully support sync interface yet
          (swRegistration as any).sync
            .register("sync-crdt")
            .catch((err: any) => {
              console.error("Background Sync registration failed:", err);
            });
        });
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get and clear pending actions
 */
export async function processPendingActions(): Promise<
  Array<{
    type: string;
    venueId: string;
    data?: Record<string, unknown>;
  }>
> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["pendingActions"], "readonly");
    const store = transaction.objectStore("pendingActions");

    const getRequest = store.getAll();

    getRequest.onsuccess = () => {
      resolve(getRequest.result);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Conversation history offline edits (issue #266)
 *
 * Renaming/deleting a conversation while offline queues a "conversation-rename"
 * or "conversation-delete" pendingAction, exactly like favorites/ratings already
 * do. A Background Sync tag ("sync-conversations") is registered so the service
 * worker flushes the queue as soon as connectivity returns; `flushConversationEditQueue`
 * below is a foreground fallback for browsers (Safari/iOS) that don't support the
 * Background Sync API.
 */

export interface ConversationEditAction {
  id: number;
  type: "conversation-rename" | "conversation-delete";
  conversationId: string;
  title?: string;
  timestamp: number;
}

/**
 * Queue a rename. If an earlier queued rename for the same conversation hasn't
 * synced yet, it's replaced (only the latest title matters) rather than piling
 * up redundant sync work.
 */
export async function queueConversationRename(
  conversationId: string,
  title: string,
): Promise<void> {
  const database = await initOfflineDB();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["pendingActions"], "readwrite");
    const store = transaction.objectStore("pendingActions");
    const request = store.getAll();

    request.onsuccess = () => {
      const existing = (request.result as ConversationEditAction[]).filter(
        (a) =>
          a.type === "conversation-rename" &&
          a.conversationId === conversationId,
      );
      existing.forEach((a) => store.delete(a.id));

      store.add({
        type: "conversation-rename",
        conversationId,
        title,
        timestamp: Date.now(),
      });
    };
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  await registerConversationSync();
}

/**
 * Queue a delete. Any pending rename for the same conversation is dropped —
 * there's no point syncing a title change for a thread that's about to be
 * deleted anyway.
 */
export async function queueConversationDelete(
  conversationId: string,
): Promise<void> {
  const database = await initOfflineDB();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["pendingActions"], "readwrite");
    const store = transaction.objectStore("pendingActions");
    const request = store.getAll();

    request.onsuccess = () => {
      const staleRenames = (request.result as ConversationEditAction[]).filter(
        (a) =>
          a.type === "conversation-rename" &&
          a.conversationId === conversationId,
      );
      staleRenames.forEach((a) => store.delete(a.id));

      store.add({
        type: "conversation-delete",
        conversationId,
        timestamp: Date.now(),
      });
    };
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  await registerConversationSync();
}

async function registerConversationSync(): Promise<void> {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const swRegistration = await navigator.serviceWorker.ready;
      await (swRegistration as any).sync.register("sync-conversations");
    } catch (err) {
      console.error("Background Sync registration failed:", err);
    }
  }
}

/**
 * All queued (not-yet-synced) conversation rename/delete actions, oldest first.
 */
export async function getPendingConversationEdits(): Promise<
  ConversationEditAction[]
> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["pendingActions"], "readonly");
    const store = transaction.objectStore("pendingActions");
    const request = store.getAll();

    request.onsuccess = () => {
      const actions = (request.result as ConversationEditAction[])
        .filter(
          (a) =>
            a.type === "conversation-rename" ||
            a.type === "conversation-delete",
        )
        .sort((a, b) => a.timestamp - b.timestamp);
      resolve(actions);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Applies queued rename/delete edits on top of a server-fetched (possibly
 * stale/cached) conversation list, so a reload while offline — or before the
 * background sync has fired — still reflects the user's local edits instead
 * of reverting them.
 */
export function applyPendingConversationEdits<
  T extends { id: string; title: string },
>(conversations: T[], pendingEdits: ConversationEditAction[]): T[] {
  const deletedIds = new Set(
    pendingEdits
      .filter((a) => a.type === "conversation-delete")
      .map((a) => a.conversationId),
  );
  const latestTitleById = new Map<string, string>();
  for (const edit of pendingEdits) {
    if (edit.type === "conversation-rename" && edit.title !== undefined) {
      latestTitleById.set(edit.conversationId, edit.title);
    }
  }

  return conversations
    .filter((c) => !deletedIds.has(c.id))
    .map((c) =>
      latestTitleById.has(c.id)
        ? { ...c, title: latestTitleById.get(c.id)! }
        : c,
    );
}

async function removePendingActionById(id: number): Promise<void> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["pendingActions"], "readwrite");
    const store = transaction.objectStore("pendingActions");
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Foreground fallback: sends every queued conversation edit to the server and
 * removes it from the queue on success. Safe to call opportunistically (e.g.
 * on the browser's `online` event) in addition to the service worker's
 * Background Sync handler — both simply no-op once the queue is empty.
 */
export async function flushConversationEditQueue(): Promise<void> {
  const pending = await getPendingConversationEdits();

  for (const action of pending) {
    try {
      let response: Response;
      if (action.type === "conversation-delete") {
        response = await fetch(`/api/conversations/${action.conversationId}`, {
          method: "DELETE",
        });
      } else {
        response = await fetch(`/api/conversations/${action.conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: action.title }),
        });
      }

      if (response.ok) {
        await removePendingActionById(action.id);
      }
    } catch (err) {
      // Still offline or request failed — leave it queued for the next attempt.
      console.error("Failed to sync conversation edit:", err);
    }
  }
}

/**
 * Clear old cached data
 */
export async function cleanupOldData(
  maxAge: number = 7 * 24 * 60 * 60 * 1000,
): Promise<void> {
  const database = await initOfflineDB();
  const cutoff = Date.now() - maxAge;

  // Clean old venues
  const venuesTx = database.transaction(["venues"], "readwrite");
  const venuesStore = venuesTx.objectStore("venues");
  const venuesIndex = venuesStore.index("savedAt");

  const venuesCursor = venuesIndex.openCursor(IDBKeyRange.upperBound(cutoff));
  venuesCursor.onsuccess = (event) => {
    const cursor = (event.target as IDBRequest).result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };

  // Clean old searches
  const searchesTx = database.transaction(["searches"], "readwrite");
  const searchesStore = searchesTx.objectStore("searches");
  const searchesIndex = searchesStore.index("timestamp");

  const searchesCursor = searchesIndex.openCursor(
    IDBKeyRange.upperBound(cutoff),
  );
  searchesCursor.onsuccess = (event) => {
    const cursor = (event.target as IDBRequest).result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
}
