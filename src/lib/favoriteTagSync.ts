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
// Client-side Offline Sync Logic
// ---------------------------------------------------------------------------

import {
  getDB,
  withWebLock,
  TAG_STORE_NAME,
  MAX_SYNC_RETRIES,
} from "./offlineStore";

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
 */
export async function queueFavoriteTagMutation(
  tagId: string,
  operation: "CREATE" | "UPDATE" | "DELETE",
  data?: any,
  revision?: number,
): Promise<void> {
  return withWebLock(async () => {
    try {
      const db = await getDB();
      return new Promise<void>((resolve, reject) => {
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
    } catch (err) {
      console.error("Failed to queue offline tag mutation:", err);
    }
  });
}

export async function getQueuedTagMutations(): Promise<OfflineTagMutation[]> {
  return withWebLock(async () => {
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
  });
}

export async function dequeueTagMutation(id: number): Promise<void> {
  return withWebLock(async () => {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(TAG_STORE_NAME, "readwrite");
        const store = tx.objectStore(TAG_STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error("Failed to dequeue tag mutation:", err);
    }
  });
}

export async function incrementTagMutationRetryCount(
  id: number,
): Promise<number | null> {
  return withWebLock(async () => {
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
 * Replays queued favorite tag operations sequentially.
 * Resolves conflicts by fetching and merging state if the server reports a 409.
 */
let isProcessing = false;

export async function processTagMutationsQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  const processQueue = async () => {
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
            // Tag with this name might already exist
            // - fetch latest state
            // - merge according to existing project strategy (apply our local updates to the existing tag if it matches)
            // - remove successfully resolved operations from queue

            const fetchRes = await fetch("/api/favorites/tags");
            if (fetchRes.ok) {
              const latestTags = await fetchRes.json();
              // Try to find the conflicting tag (same name as what we tried to sync)
              const existingTag = latestTags.find(
                (t: any) => t.name === action.data?.name,
              );

              if (existingTag) {
                // Retry sync with the correct existing ID
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

            // If merge failed, or no matching tag found, treat as permanent error
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
    } catch (e) {
      console.error("[Tag Sync] processQueue failed:", e);
    }
  };

  try {
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      await navigator.locks.request(
        "sync-favorite-tags-queue",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          await processQueue();
        },
      );
    } else {
      await processQueue();
    }
  } catch (error) {
    console.error("[Tag Sync] Queue processing failed:", error);
  } finally {
    isProcessing = false;
  }
}
