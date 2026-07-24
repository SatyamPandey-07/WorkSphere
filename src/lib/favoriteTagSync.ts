import { prisma } from "@/lib/prisma";

export type FavoriteTagBulkUpdate = {
  id: string;
  name?: string;
  color?: string;
};

/**
 * Sort tag IDs so every concurrent bulk sync locks FavoriteTag rows in the
 * same order. Unordered locking across overlapping sets is what produces
 * PostgreSQL deadlocks (Prisma P2034) when syncing 50+ venue tags at once.
 */
export function sortTagIdsDeterministically(ids: string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Apply bulk FavoriteTag field updates inside a single Prisma transaction.
 * Writes always run in deterministic tag-id order to avoid row-lock deadlocks.
 */
export async function syncFavoriteTagsBulk(updates: FavoriteTagBulkUpdate[]) {
  if (updates.length === 0) {
    return [];
  }

  // Last write wins if the same id appears twice in the payload.
  const byId = new Map<string, FavoriteTagBulkUpdate>();
  for (const update of updates) {
    byId.set(update.id, update);
  }

  const orderedIds = sortTagIdsDeterministically([...byId.keys()]);

  return prisma.$transaction(
    orderedIds.map((id) => {
      const update = byId.get(id)!;
      const data: { name?: string; color?: string } = {};
      if (update.name !== undefined) data.name = update.name;
      if (update.color !== undefined) data.color = update.color;

      return prisma.favoriteTag.update({
        where: { id },
        data,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Client-side Offline Sync & Web Locks / BroadcastChannel Cross-Tab Synchronization
// ---------------------------------------------------------------------------

import { getDB, TAG_STORE_NAME, MAX_SYNC_RETRIES } from "./offlineStore";

export const TAG_SYNC_LOCK_NAME = "worksphere:favorite-tags-sync-lock";
export const TAG_SYNC_CHANNEL_NAME = "worksphere:favorite-tags-sync-channel";

export interface TagSyncEventPayload {
  type: "TAG_MUTATION" | "TAG_DEQUEUED" | "TAG_SYNC_COMPLETE";
  tagId?: string;
  operation?: "CREATE" | "UPDATE" | "DELETE";
  data?: any;
  timestamp: number;
}

/**
 * Web Locks API wrapper to serialize IndexedDB tag mutations across multiple open tabs.
 * Falls back gracefully in environments without Web Lock support.
 */
export async function withFavoriteTagWebLock<T>(
  callback: () => Promise<T>,
  options?: { mode?: "exclusive" | "shared" },
): Promise<T> {
  const lockMode = options?.mode ?? "exclusive";
  if (
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    navigator.locks?.request
  ) {
    try {
      return await navigator.locks.request(
        TAG_SYNC_LOCK_NAME,
        { mode: lockMode },
        async () => callback(),
      );
    } catch (err) {
      console.warn("Web Locks request failed, falling back:", err);
      return callback();
    }
  }
  return callback();
}

/**
 * Broadcasts cross-tab sync events using BroadcastChannel API.
 */
export function broadcastTagSyncEvent(event: TagSyncEventPayload): void {
  if (typeof BroadcastChannel === "undefined") return;

  try {
    const channel = new BroadcastChannel(TAG_SYNC_CHANNEL_NAME);
    channel.postMessage(event);
    channel.close();
  } catch (err) {
    console.warn("BroadcastChannel error:", err);
  }
}

/**
 * Subscribes open application tabs to real-time tag synchronization events.
 */
export function subscribeTagSyncChannel(
  callback: (event: TagSyncEventPayload) => void,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};

  try {
    const channel = new BroadcastChannel(TAG_SYNC_CHANNEL_NAME);
    channel.onmessage = (messageEvent) => {
      if (messageEvent.data) {
        callback(messageEvent.data as TagSyncEventPayload);
      }
    };

    return () => {
      try {
        channel.close();
      } catch {
        // Ignore closing errors
      }
    };
  } catch {
    return () => {};
  }
}

export interface OfflineTagMutation {
  id?: number;
  tagId: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data?: any;
  timestamp: number;
  revision?: number;
  retryCount?: number;
}

/**
 * Pushes a target action into the client IndexedDB transaction queue.
 * Protected by Exclusive Web Lock and broadcasts tab updates.
 */
export async function queueFavoriteTagMutation(
  tagId: string,
  operation: "CREATE" | "UPDATE" | "DELETE",
  data?: any,
  revision?: number,
): Promise<void> {
  return withFavoriteTagWebLock(async () => {
    try {
      const db = await getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(TAG_STORE_NAME, "readwrite");
        const store = tx.objectStore(TAG_STORE_NAME);
        store.add({
          tagId,
          operation,
          data,
          timestamp: Date.now(),
          revision,
          retryCount: 0,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      broadcastTagSyncEvent({
        type: "TAG_MUTATION",
        tagId,
        operation,
        data,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Failed to queue offline tag mutation:", err);
    }
  });
}

export async function getQueuedTagMutations(): Promise<OfflineTagMutation[]> {
  return withFavoriteTagWebLock(
    async () => {
      try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(TAG_STORE_NAME, "readonly");
          const store = tx.objectStore(TAG_STORE_NAME);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      } catch (err) {
        console.error("Failed to get queued tag mutations:", err);
        return [];
      }
    },
    { mode: "shared" },
  );
}

export async function dequeueTagMutation(id: number): Promise<void> {
  return withFavoriteTagWebLock(async () => {
    try {
      const db = await getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(TAG_STORE_NAME, "readwrite");
        const store = tx.objectStore(TAG_STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      broadcastTagSyncEvent({
        type: "TAG_DEQUEUED",
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Failed to dequeue tag mutation:", err);
    }
  });
}

export async function incrementTagMutationRetryCount(
  id: number,
): Promise<number | null> {
  return withFavoriteTagWebLock(async () => {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(TAG_STORE_NAME, "readwrite");
        const store = tx.objectStore(TAG_STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
          const existing = getRequest.result as OfflineTagMutation | undefined;
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
      console.error("Failed to increment tag mutation retry count:", err);
      return null;
    }
  });
}

/**
 * Replays queued favorite tag operations sequentially under an Exclusive Web Lock.
 * Resolves conflicts by fetching and merging state if the server reports a 409.
 */
let isProcessing = false;

export async function processTagMutationsQueue(): Promise<void> {
  if (isProcessing) return;

  return withFavoriteTagWebLock(async () => {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const actions = await getQueuedTagMutations();

      while (actions.length > 0) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          break;
        }

        const action = actions[0];
        if (!action.id) {
          actions.shift();
          continue;
        }

        try {
          const res = await fetch("/api/favorites/tags/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              updates: [
                {
                  id: action.tagId,
                  ...action.data,
                },
              ],
            }),
          });

          if (res.ok) {
            await dequeueTagMutation(action.id);
            actions.shift();
            continue;
          }

          if (res.status === 409) {
            // Conflict Resolution
            const fetchRes = await fetch("/api/favorites/tags");
            if (fetchRes.ok) {
              const latestTags = await fetchRes.json();
              const existingTag = latestTags.find(
                (t: any) => t.name === action.data?.name,
              );

              if (existingTag) {
                const retryRes = await fetch("/api/favorites/tags/sync", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    updates: [
                      {
                        id: existingTag.id,
                        ...action.data,
                      },
                    ],
                  }),
                });

                if (retryRes.ok) {
                  await dequeueTagMutation(action.id);
                  actions.shift();
                  continue;
                }
              }
            }

            await dequeueTagMutation(action.id);
            actions.shift();
            continue;
          }

          // Permanent server errors (400, 403, 404, etc. but not 408/429)
          if (
            res.status >= 400 &&
            res.status < 500 &&
            res.status !== 429 &&
            res.status !== 408
          ) {
            await dequeueTagMutation(action.id);
            actions.shift();
            continue;
          }

          throw new Error(`Sync request failed with status ${res.status}`);
        } catch (error) {
          console.error("[Tag Sync] Failed to sync tag mutation:", error);

          if (typeof navigator !== "undefined" && !navigator.onLine) {
            break;
          }

          const attempts = await incrementTagMutationRetryCount(action.id);
          if (attempts !== null && attempts >= MAX_SYNC_RETRIES) {
            await dequeueTagMutation(action.id);
            actions.shift();
          } else {
            break;
          }
        }
      }

      broadcastTagSyncEvent({
        type: "TAG_SYNC_COMPLETE",
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error("[Tag Sync] processQueue failed:", e);
    } finally {
      isProcessing = false;
    }
  });
}
