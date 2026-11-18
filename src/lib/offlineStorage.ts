/**
 * @deprecated Standalone offlineStorage.ts is deprecated in favor of unified offline storage in @/lib/offline.
 * Import directly from `@/lib/offline` instead.
 */

import {
  venuesRepository,
  searchesRepository,
  receiptsRepository,
  type OfflineVenue,
  type OfflineSearch,
  type CachedPreferenceRanking,
  type ReceiptExportItem,
  MAX_OFFLINE_VENUES,
  initOfflineDB,
  getYFavorites,
} from "./offline";
import { withWebLock } from "./webLock";

export * from "./offline";

/** @deprecated Use venuesRepository.save from @/lib/offline instead. */
export async function saveVenueOffline(venue: OfflineVenue): Promise<void> {
  await withWebLock(() => venuesRepository.save(venue));
}

/** @deprecated Use venuesRepository.get from @/lib/offline instead. */
export async function getVenueOffline(
  id: string,
): Promise<OfflineVenue | null> {
  const venue = await venuesRepository.get(id);
  return venue || null;
}

/** @deprecated Use venuesRepository.getAll from @/lib/offline instead. */
export async function getAllVenuesOffline(): Promise<OfflineVenue[]> {
  return venuesRepository.getAll();
}

/** @deprecated Use venuesRepository.delete from @/lib/offline instead. */
export async function deleteVenueOffline(id: string): Promise<void> {
  await venuesRepository.delete(id);
}

/** @deprecated Use venuesRepository.get from @/lib/offline instead. */
export async function isVenueSavedOffline(id: string): Promise<boolean> {
  const venue = await venuesRepository.get(id);
  return !!venue;
}

/** @deprecated Use venuesRepository.getFavorites from @/lib/offline instead. */
export async function getFavoriteVenuesOffline(): Promise<OfflineVenue[]> {
  return venuesRepository.getFavorites();
}

/** @deprecated Use venuesRepository from @/lib/offline instead. */
export async function toggleFavoriteOffline(
  venue: OfflineVenue,
): Promise<boolean> {
  const existing = await venuesRepository.get(venue.id);
  if (existing?.isFavorite) {
    await venuesRepository.removeFavorite(venue.id);
    return false;
  } else {
    await venuesRepository.saveFavorite(venue);
    return true;
  }
}

/** @deprecated Use searchesRepository.save from @/lib/offline instead. */
export async function saveSearchHistoryOffline(
  query: string,
  results: OfflineVenue[],
): Promise<void> {
  await searchesRepository.save({ query, results, timestamp: Date.now() });
}

/** @deprecated Use searchesRepository.getAll from @/lib/offline instead. */
export async function getSearchHistoryOffline(): Promise<OfflineSearch[]> {
  return searchesRepository.getAll();
}

/** @deprecated Use searchesRepository.clear from @/lib/offline instead. */
export async function clearSearchHistoryOffline(): Promise<void> {
  await searchesRepository.clear();
}

/** @deprecated Use searchesRepository.trimSearchHistory from @/lib/offline instead. */
export async function trimSearchHistoryOffline(
  maxEntries = 20,
): Promise<number> {
  return searchesRepository.trimSearchHistory(maxEntries);
}

/** @deprecated Use searchesRepository.trimSearchHistory from @/lib/offline instead. */
export async function trimSearchHistory(maxEntries = 20): Promise<number> {
  return searchesRepository.trimSearchHistory(maxEntries);
}

/** @deprecated Use receiptsRepository.save from @/lib/offline instead. */
export async function saveReceiptExportOffline(
  receipt: ReceiptExportItem,
): Promise<void> {
  await receiptsRepository.save(receipt);
}

/** @deprecated Use receiptsRepository.getAll from @/lib/offline instead. */
export async function getReceiptExportsOffline(): Promise<ReceiptExportItem[]> {
  return receiptsRepository.getAll();
}

/** @deprecated Use receiptsRepository.delete from @/lib/offline instead. */
export async function deleteReceiptExportOffline(
  bookingId: string,
): Promise<void> {
  await receiptsRepository.delete(bookingId);
}

/** @deprecated Use venuesRepository.savePreferenceRanking from @/lib/offline instead. */
export async function savePreferenceRankingOffline(
  ranking: CachedPreferenceRanking,
): Promise<void> {
  await venuesRepository.savePreferenceRanking(ranking);
}

/** @deprecated Use venuesRepository.getPreferenceRanking from @/lib/offline instead. */
export async function getPreferenceRankingOffline(
  id = "default_ranking",
): Promise<CachedPreferenceRanking | null> {
  const res = await venuesRepository.getPreferenceRanking(id);
  return res || null;
}

/** @deprecated Use venuesRepository.pruneLru from @/lib/offline instead. */
export async function pruneLruVenuesOffline(
  database?: IDBDatabase,
  maxVenues = MAX_OFFLINE_VENUES,
): Promise<number> {
  return venuesRepository.pruneLru(maxVenues);
}

/** @deprecated Use pruneRecentlyViewedVenuesLru from @/lib/offline instead. */
export async function pruneRecentlyViewedVenuesOffline(
  maxItems?: number,
): Promise<number> {
  const { pruneRecentlyViewedVenuesLru } = await import("./offline/venueCache");
  return pruneRecentlyViewedVenuesLru(maxItems);
}

// ─── Favorites & search cache ────────────────────────────────────────────────

const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SEARCH_HISTORY = 15;

function normalizeSearchQuery(query: string): string {
  return query.toLowerCase().trim();
}

export async function saveFavoriteOffline(venue: OfflineVenue): Promise<void> {
  await withWebLock(async () => {
    // CRDT state first: its update listener queues the change for sync.
    getYFavorites()?.set(venue.id, venue);
    await venuesRepository.saveFavorite(venue);
  });
}

export async function removeFavoriteOffline(id: string): Promise<void> {
  await withWebLock(async () => {
    getYFavorites()?.delete(id);
    await venuesRepository.removeFavorite(id);
  });
}

export async function getFavoritesOffline(): Promise<OfflineVenue[]> {
  return venuesRepository.getFavorites();
}

export async function saveSearchOffline(
  query: string,
  results: OfflineVenue[],
): Promise<void> {
  await withWebLock(() =>
    searchesRepository.save(
      { query: normalizeSearchQuery(query), results, timestamp: Date.now() },
      MAX_SEARCH_HISTORY,
    ),
  );
}

/** Cached searches, most recent first. */
export async function getAllSearchesOffline(): Promise<OfflineSearch[]> {
  const searches = await searchesRepository.getAll();
  return searches.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/** Cached result for a query, or null when missing or older than 24 hours. */
export async function getSearchOffline(
  query: string,
): Promise<OfflineSearch | null> {
  const cached = await searchesRepository.get(normalizeSearchQuery(query));
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS) {
    return cached;
  }
  return null;
}

// ─── Generic pending actions ─────────────────────────────────────────────────
//
// The "pendingActions" store is shared: CRDT updates and conversation edits
// live there too and are drained by their own sync paths (public/sw.js and
// flushConversationEditQueue). The helpers below only touch generic actions.

export interface PendingAction {
  id?: number;
  type: string;
  venueId: string;
  data?: Record<string, unknown>;
  timestamp?: number;
  name?: string;
  status?: string;
  error?: string;
  retryCount?: number;
}

const RESERVED_ACTION_TYPES = new Set([
  "crdt-sync",
  "CRDT_UPDATE",
  "conversation-rename",
  "conversation-delete",
]);

async function registerBackgroundSync(tag: string): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("SyncManager" in window)
  ) {
    return;
  }
  try {
    const swRegistration = await navigator.serviceWorker.ready;
    // Background Sync is not in the TS DOM lib yet
    await (swRegistration as any).sync.register(tag);
  } catch (err) {
    console.error("Background Sync registration failed:", err);
  }
}

/**
 * Queue an action for when back online. Deduplicates by type + venueId so
 * rapid double-clicks while offline do not create duplicate entries.
 */
export async function queuePendingAction(action: {
  type: "favorite" | "unfavorite" | "rate";
  venueId: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  await withWebLock(async () => {
    const database = await initOfflineDB();

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["pendingActions"], "readwrite");
      const store = transaction.objectStore("pendingActions");
      const getAll = store.getAll();

      getAll.onsuccess = () => {
        const existing = (getAll.result as PendingAction[]).find(
          (a) => a.type === action.type && a.venueId === action.venueId,
        );
        if (!existing) {
          store.add({ ...action, timestamp: Date.now() });
        }
      };
      getAll.onerror = () => reject(getAll.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  });
}

/** Returns the queued generic actions and removes them from the queue. */
export async function processPendingActions(): Promise<PendingAction[]> {
  return withWebLock(async () => {
    const database = await initOfflineDB();

    return new Promise<PendingAction[]>((resolve, reject) => {
      const transaction = database.transaction(["pendingActions"], "readwrite");
      const store = transaction.objectStore("pendingActions");
      const getRequest = store.getAll();
      let actions: PendingAction[] = [];

      getRequest.onsuccess = () => {
        actions = (getRequest.result as PendingAction[]).filter(
          (a) => !RESERVED_ACTION_TYPES.has(a.type),
        );
        for (const action of actions) {
          if (action.id !== undefined) store.delete(action.id);
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.oncomplete = () => resolve(actions);
      transaction.onerror = () => reject(transaction.error);
    });
  });
}

// ─── Conversation history offline edits (#266) ───────────────────────────────

export interface ConversationEditAction {
  id: number;
  type: "conversation-rename" | "conversation-delete";
  conversationId: string;
  title?: string;
  timestamp: number;
}

async function queueConversationEdit(
  edit: Pick<ConversationEditAction, "type" | "conversationId" | "title">,
): Promise<void> {
  await withWebLock(async () => {
    const database = await initOfflineDB();

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["pendingActions"], "readwrite");
      const store = transaction.objectStore("pendingActions");
      const request = store.getAll();

      request.onsuccess = () => {
        // A newer rename or a delete supersedes any queued rename.
        (request.result as ConversationEditAction[])
          .filter(
            (a) =>
              a.type === "conversation-rename" &&
              a.conversationId === edit.conversationId,
          )
          .forEach((a) => store.delete(a.id));

        store.add({ ...edit, timestamp: Date.now() });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    await registerBackgroundSync("sync-conversations");
  });
}

export async function queueConversationRename(
  conversationId: string,
  title: string,
): Promise<void> {
  await queueConversationEdit({
    type: "conversation-rename",
    conversationId,
    title,
  });
}

export async function queueConversationDelete(
  conversationId: string,
): Promise<void> {
  await queueConversationEdit({ type: "conversation-delete", conversationId });
}

export async function getPendingConversationEdits(): Promise<
  ConversationEditAction[]
> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["pendingActions"], "readonly");
    const store = transaction.objectStore("pendingActions");
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(
        (request.result as ConversationEditAction[])
          .filter(
            (a) =>
              a.type === "conversation-rename" ||
              a.type === "conversation-delete",
          )
          .sort((a, b) => a.timestamp - b.timestamp),
      );
    };
    request.onerror = () => reject(request.error);
  });
}

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
    const request = transaction.objectStore("pendingActions").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function flushConversationEditQueue(): Promise<void> {
  const pending = await getPendingConversationEdits();

  for (const action of pending) {
    try {
      const url = `/api/conversations/${action.conversationId}`;
      const response =
        action.type === "conversation-delete"
          ? await fetch(url, { method: "DELETE" })
          : await fetch(url, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: action.title }),
            });

      if (response.ok) {
        await removePendingActionById(action.id);
      }
    } catch (err) {
      if (err instanceof TypeError) {
        console.warn(
          `[OfflineStorage] flushConversationEditQueue: Network error for action ${action.id} — preserving in queue.`,
        );
        return;
      }
      console.error("Failed to sync conversation edit:", err);
    }
  }
}

// ─── Pending favorites (drained by syncFavorites in public/sw.js) ────────────

export interface PendingFavorite {
  id: string;
  venueId: string;
  action: "add" | "remove";
  timestamp: number;
}

export async function queuePendingFavorite(
  venueId: string,
  action: "add" | "remove",
): Promise<void> {
  const database = await initOfflineDB();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["pendingFavorites"], "readwrite");
    const store = transaction.objectStore("pendingFavorites");
    const request = store.getAll();

    request.onsuccess = () => {
      // Only the latest intent per venue matters.
      (request.result as PendingFavorite[])
        .filter((a) => a.venueId === venueId)
        .forEach((a) => store.delete(a.id));

      store.add({
        id: crypto.randomUUID(),
        venueId,
        action,
        timestamp: Date.now(),
      });
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  await registerBackgroundSync("sync-favorites");
}

export async function getPendingFavorites(): Promise<PendingFavorite[]> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["pendingFavorites"], "readonly");
    const request = transaction.objectStore("pendingFavorites").getAll();

    request.onsuccess = () => {
      resolve(
        (request.result as PendingFavorite[]).sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
      );
    };
    request.onerror = () => reject(request.error);
  });
}

export async function removePendingFavorite(id: string): Promise<void> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["pendingFavorites"], "readwrite");
    const request = transaction.objectStore("pendingFavorites").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 10,
): Promise<T> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= retries) throw err;
      await new Promise((r) =>
        setTimeout(r, delayMs * Math.pow(2, attempt - 1)),
      );
    }
  }
  throw new Error("Max retries exceeded");
}

/** Total mutations queued across the IndexedDB stores awaiting offline sync. */
export async function getTotalPendingMutationsCount(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  try {
    const database = await initOfflineDB();
    const availableStores = [
      "pendingActions",
      "pendingFavorites",
      "pendingReviews",
      "receiptExports",
    ].filter((name) => database.objectStoreNames.contains(name));
    if (availableStores.length === 0) return 0;

    let total = 0;
    const tx = database.transaction(availableStores, "readonly");
    await Promise.all(
      availableStores.map(
        (storeName) =>
          new Promise<void>((resolve) => {
            const req = tx.objectStore(storeName).count();
            req.onsuccess = () => {
              total += req.result || 0;
              resolve();
            };
            req.onerror = () => resolve();
          }),
      ),
    );
    return total;
  } catch {
    return 0;
  }
}
