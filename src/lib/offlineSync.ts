/**
 * Offline Background Sync Mutation Queue for Venue Amenity Votes using IndexedDB.
 *
 * Implements an IndexedDB object store `pending_amenity_votes` with FIFO replay
 * on network restoration and optimistic UI updating.
 */

import { openDB, IDBPDatabase } from "idb";

export const DB_NAME = "worksphere-offline-amenity-sync";
export const DB_VERSION = 1;
export const AMENITY_VOTE_STORE = "pending_amenity_votes";

export type AmenityVoteType = "upvote" | "downvote" | boolean;

export interface PendingAmenityVote {
  id: string;
  venueId: string;
  amenity: string;
  voteType: AmenityVoteType;
  timestamp: number;
  retryCount?: number;
}

export interface SyncReplayResult {
  synced: number;
  failed: number;
  total: number;
  results: Array<{ id: string; success: boolean; error?: string }>;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Initializes and opens the IndexedDB database instance.
 */
export function getSyncDb(): Promise<IDBPDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not supported in this environment"));
  }

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(AMENITY_VOTE_STORE)) {
          const store = db.createObjectStore(AMENITY_VOTE_STORE, {
            keyPath: "id",
          });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("venueId", "venueId", { unique: false });
        }
      },
    });
  }

  return dbPromise;
}

/**
 * Closes and resets the cached DB promise (useful for test teardown).
 */
export function resetSyncDb(): void {
  dbPromise = null;
}

/**
 * Enqueues a pending amenity vote into the IndexedDB mutation queue.
 */
export async function enqueuePendingAmenityVote(vote: {
  id?: string;
  venueId: string;
  amenity: string;
  voteType: AmenityVoteType;
  timestamp?: number;
}): Promise<PendingAmenityVote> {
  const db = await getSyncDb();
  const entry: PendingAmenityVote = {
    id: vote.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `vote-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    venueId: vote.venueId,
    amenity: vote.amenity,
    voteType: vote.voteType,
    timestamp: vote.timestamp ?? Date.now(),
    retryCount: 0,
  };

  await db.put(AMENITY_VOTE_STORE, entry);
  return entry;
}

/**
 * Retrieves all pending amenity votes from IndexedDB in FIFO order (oldest first).
 */
export async function getPendingAmenityVotes(): Promise<PendingAmenityVote[]> {
  const db = await getSyncDb();
  const votes = await db.getAll(AMENITY_VOTE_STORE);
  // Sort in FIFO order by timestamp
  return votes.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Removes a confirmed vote entry from the IndexedDB store.
 */
export async function removePendingAmenityVote(id: string): Promise<void> {
  const db = await getSyncDb();
  await db.delete(AMENITY_VOTE_STORE, id);
}

/**
 * Clears all pending votes from the store.
 */
export async function clearPendingAmenityVotes(): Promise<void> {
  const db = await getSyncDb();
  await db.clear(AMENITY_VOTE_STORE);
}

/**
 * Drains the pending amenity vote queue and replays them in FIFO order
 * to /api/venues/amenity-vote. Discards confirmed entries from IndexedDB.
 */
export async function replayPendingAmenityVotes(
  apiEndpoint = "/api/venues/amenity-vote",
): Promise<SyncReplayResult> {
  const pendingVotes = await getPendingAmenityVotes();
  const summary: SyncReplayResult = {
    synced: 0,
    failed: 0,
    total: pendingVotes.length,
    results: [],
  };

  if (pendingVotes.length === 0) {
    return summary;
  }

  for (const item of pendingVotes) {
    const isUpvote =
      item.voteType === "upvote" || item.voteType === true;

    try {
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WorkSphere-Replay": "true",
          "X-Idempotency-Key": item.id,
        },
        body: JSON.stringify({
          venueId: item.venueId,
          amenity: item.amenity,
          isUpvote,
          voteType: item.voteType,
          clientTimestamp: item.timestamp,
        }),
      });

      if (response.ok || response.status === 200 || response.status === 201) {
        await removePendingAmenityVote(item.id);
        summary.synced++;
        summary.results.push({ id: item.id, success: true });
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        // Permanent client error (e.g. invalid amenity key) - discard to avoid blocking FIFO queue
        await removePendingAmenityVote(item.id);
        summary.failed++;
        summary.results.push({ id: item.id, success: false, error: `Client error: ${response.status}` });
      } else {
        // Transient server error - keep in queue
        summary.failed++;
        summary.results.push({ id: item.id, success: false, error: `Server error: ${response.status}` });
      }
    } catch (networkError: any) {
      // Network failed / still offline - stop replay loop
      summary.failed++;
      summary.results.push({ id: item.id, success: false, error: networkError.message || "Network request failed" });
      break;
    }
  }

  return summary;
}

/**
 * Optimistically submits an amenity vote:
 * - Immediately triggers the UI optimistic callback
 * - If online, sends live request to server; if that fails or client is offline,
 *   enqueues to IndexedDB for background replay.
 */
export async function submitAmenityVoteOptimistic({
  venueId,
  amenity,
  voteType,
  onOptimisticUpdate,
  apiEndpoint = "/api/venues/amenity-vote",
}: {
  venueId: string;
  amenity: string;
  voteType: AmenityVoteType;
  onOptimisticUpdate?: () => void;
  apiEndpoint?: string;
}): Promise<{ syncedLive: boolean; queuedOffline: boolean; data?: any }> {
  // 1. Optimistic UI update
  onOptimisticUpdate?.();

  const isOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  const isUpvote = voteType === "upvote" || voteType === true;

  // 2. If definitely offline, queue immediately
  if (!isOnline) {
    const queued = await enqueuePendingAmenityVote({ venueId, amenity, voteType });
    return { syncedLive: false, queuedOffline: true, data: queued };
  }

  // 3. If online, attempt live fetch
  try {
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venueId,
        amenity,
        isUpvote,
        voteType,
      }),
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return { syncedLive: true, queuedOffline: false, data };
    } else {
      // Server returned non-ok, queue for offline sync
      const queued = await enqueuePendingAmenityVote({ venueId, amenity, voteType });
      return { syncedLive: false, queuedOffline: true, data: queued };
    }
  } catch {
    // Network exception, queue into IndexedDB
    const queued = await enqueuePendingAmenityVote({ venueId, amenity, voteType });
    return { syncedLive: false, queuedOffline: true, data: queued };
  }
}

let isListenerRegistered = false;

/**
 * Sets up the window 'online' event listener to automatically drain and replay
 * the pending amenity votes when network connectivity is restored.
 */
export function setupOfflineAmenitySync(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleOnline = () => {
    void replayPendingAmenityVotes();
  };

  if (!isListenerRegistered) {
    window.addEventListener("online", handleOnline);
    isListenerRegistered = true;
  }

  return () => {
    window.removeEventListener("online", handleOnline);
    isListenerRegistered = false;
  };
}
