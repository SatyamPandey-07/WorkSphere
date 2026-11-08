/**
 * Offline Conflict Resolution Service for IndexedDB Queue
 *
 * Scans IndexedDB object stores (pending_sync_queue, queued-reviews, notes, tags)
 * and globalSyncQueue for items in CONFLICT, FAILED, or DEAD_LETTER states.
 * Provides granular conflict resolution strategies: Client Wins, Server Wins, or Custom Merge.
 */

import { initOfflineDB } from "./db";
import type { SyncItem, QueuedVenueReview } from "./types";
import { globalSyncEngine } from "./sync/syncEngine";
import { globalSyncQueue, type SyncQueueItem } from "../offlineSyncQueue";

export type ConflictResolutionStrategy = "CLIENT_WINS" | "SERVER_WINS" | "CUSTOM_MERGE";

export interface ConflictedFieldDiff {
  fieldName: string;
  clientValue: unknown;
  serverValue: unknown;
  isDifferent: boolean;
}

export interface ConflictedQueueItem {
  id: string;
  domain: string; // 'reviews' | 'notes' | 'tags' | 'favorites' | 'bookings' | 'generic'
  title: string;
  timestamp: number;
  retryCount: number;
  status: "CONFLICT" | "FAILED" | "DEAD_LETTER" | "PENDING";
  clientPayload: Record<string, unknown>;
  serverState: Record<string, unknown> | null;
  diffs: ConflictedFieldDiff[];
  sourceStore: "pending_sync_queue" | "queued-reviews" | "globalSyncQueue" | "generic";
  lastError?: string;
}

function computeFieldDiffs(
  client: Record<string, unknown> = {},
  server: Record<string, unknown> = {},
): ConflictedFieldDiff[] {
  const allKeys = Array.from(new Set([...Object.keys(client), ...Object.keys(server)]));
  const diffs: ConflictedFieldDiff[] = [];

  for (const key of allKeys) {
    if (key === "id" || key === "createdAt" || key === "updatedAt" || key === "timestamp") continue;

    const cVal = client[key];
    const sVal = server[key];
    const isDiff = JSON.stringify(cVal) !== JSON.stringify(sVal);

    diffs.push({
      fieldName: key,
      clientValue: cVal,
      serverValue: sVal,
      isDifferent: isDiff,
    });
  }

  return diffs;
}

export class OfflineConflictService {
  /**
   * Fetches all items currently in conflict or failed state across all IndexedDB queues.
   */
  public async getConflictedItems(): Promise<ConflictedQueueItem[]> {
    const results: ConflictedQueueItem[] = [];

    // 1. Check pending_sync_queue in DB
    try {
      const db = await initOfflineDB();
      const syncItems = await new Promise<SyncItem[]>((resolve) => {
        try {
          const tx = db.transaction(["pending_sync_queue"], "readonly");
          const store = tx.objectStore("pending_sync_queue");
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });

      for (const item of syncItems) {
        if (item.status === "CONFLICT" || item.status === "FAILED") {
          const clientPayload = (typeof item.payload === "object" && item.payload !== null ? item.payload : { value: item.payload }) as Record<string, unknown>;
          const serverState = item.conflictDetails?.serverState || null;
          const diffs = computeFieldDiffs(clientPayload, serverState || {});

          results.push({
            id: item.id,
            domain: item.domain || "generic",
            title: `${item.domain.toUpperCase()} Sync Item (${item.id.slice(0, 8)})`,
            timestamp: item.timestamp,
            retryCount: item.retryCount,
            status: item.status as "CONFLICT" | "FAILED",
            clientPayload,
            serverState,
            diffs,
            sourceStore: "pending_sync_queue",
            lastError: item.conflictDetails?.conflictType,
          });
        }
      }
    } catch (err) {
      console.warn("[OfflineConflictService] Error reading pending_sync_queue:", err);
    }

    // 2. Check queued-reviews store in DB
    try {
      const db = await initOfflineDB();
      if (db.objectStoreNames.contains("queued-reviews")) {
        const reviewItems = await new Promise<QueuedVenueReview[]>((resolve) => {
          try {
            const tx = db.transaction(["queued-reviews"], "readonly");
            const store = tx.objectStore("queued-reviews");
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch {
            resolve([]);
          }
        });

        for (const r of reviewItems) {
          if (r.status === "CONFLICT" || r.status === "FAILED") {
            const clientPayload = (r.data || {}) as Record<string, unknown>;
            const serverState = r.conflictDetails?.serverState || null;
            const diffs = computeFieldDiffs(clientPayload, serverState || {});

            results.push({
              id: r.id,
              domain: "reviews",
              title: `Review for Venue ${r.venueName || r.venueId}`,
              timestamp: r.createdAt,
              retryCount: r.retryCount,
              status: r.status as "CONFLICT" | "FAILED",
              clientPayload,
              serverState,
              diffs,
              sourceStore: "queued-reviews",
              lastError: r.conflictDetails?.conflictType,
            });
          }
        }
      }
    } catch (err) {
      console.warn("[OfflineConflictService] Error reading queued-reviews:", err);
    }

    // 3. Check memory/persisted globalSyncQueue for dead-letter items
    try {
      const dlqItems = globalSyncQueue.getItems("dead_letter");
      for (const item of dlqItems) {
        // avoid duplicating if already in results
        if (results.some((r) => r.id === item.id)) continue;

        const clientPayload = (typeof item.payload === "object" && item.payload !== null ? item.payload : { value: item.payload }) as Record<string, unknown>;
        results.push({
          id: item.id,
          domain: item.type || "generic",
          title: `Mutation: ${item.type}`,
          timestamp: item.updatedAt || item.createdAt,
          retryCount: item.attempts,
          status: "DEAD_LETTER",
          clientPayload,
          serverState: null,
          diffs: computeFieldDiffs(clientPayload, {}),
          sourceStore: "globalSyncQueue",
          lastError: item.lastError || item.failureReason,
        });
      }
    } catch (err) {
      console.warn("[OfflineConflictService] Error reading globalSyncQueue:", err);
    }

    return results;
  }

  /**
   * Resolves a single conflict item using the chosen strategy.
   */
  public async resolveConflict(
    item: ConflictedQueueItem,
    strategy: ConflictResolutionStrategy,
    customPayload?: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const db = await initOfflineDB();

      if (strategy === "SERVER_WINS") {
        // Discard local draft: Remove from the source queue
        if (item.sourceStore === "pending_sync_queue") {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(["pending_sync_queue"], "readwrite");
            const store = tx.objectStore("pending_sync_queue");
            const req = store.delete(item.id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
        } else if (item.sourceStore === "queued-reviews" && db.objectStoreNames.contains("queued-reviews")) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(["queued-reviews"], "readwrite");
            const store = tx.objectStore("queued-reviews");
            const req = store.delete(item.id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
        } else if (item.sourceStore === "globalSyncQueue") {
          globalSyncQueue.clearCompleted();
        }
        return true;
      }

      const finalPayload = strategy === "CUSTOM_MERGE" && customPayload ? customPayload : item.clientPayload;

      if (item.sourceStore === "pending_sync_queue") {
        const syncItem: SyncItem = {
          id: item.id,
          domain: item.domain,
          payload: finalPayload,
          timestamp: Date.now(),
          retryCount: 0,
          status: "PENDING",
        };

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["pending_sync_queue"], "readwrite");
          const store = tx.objectStore("pending_sync_queue");
          const req = store.put(syncItem);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });

        // Trigger immediate sync
        void globalSyncEngine.processAll();
        return true;
      }

      if (item.sourceStore === "queued-reviews" && db.objectStoreNames.contains("queued-reviews")) {
        const reviewRecord = {
          id: item.id,
          data: finalPayload,
          createdAt: Date.now(),
          retryCount: 0,
          status: "PENDING",
        };

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["queued-reviews"], "readwrite");
          const store = tx.objectStore("queued-reviews");
          const req = store.put(reviewRecord);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });

        return true;
      }

      if (item.sourceStore === "globalSyncQueue") {
        globalSyncQueue.retryDeadLetter(item.id);
        return true;
      }

      return false;
    } catch (err) {
      console.error("[OfflineConflictService] resolveConflict error:", err);
      return false;
    }
  }

  /**
   * Bulk resolves all items with the chosen strategy.
   */
  public async bulkResolve(
    items: ConflictedQueueItem[],
    strategy: "CLIENT_WINS" | "SERVER_WINS",
  ): Promise<{ resolved: number; failed: number }> {
    let resolved = 0;
    let failed = 0;

    for (const item of items) {
      const ok = await this.resolveConflict(item, strategy);
      if (ok) resolved++;
      else failed++;
    }

    return { resolved, failed };
  }
}

export const offlineConflictService = new OfflineConflictService();
