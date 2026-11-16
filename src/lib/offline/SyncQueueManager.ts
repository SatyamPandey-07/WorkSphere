/**
 * Unified Offline Sync Queue Manager.
 *
 * Consolidates fragmented retry, exponential backoff, multi-tab locking,
 * and background synchronisation routines for all offline entities:
 * reviews, collaborative notes, seat check-ins, and amenity votes.
 */

import { initOfflineDB, resetOfflineDBNonDestructive } from "./db";
import type { OfflineQueueItem, OfflineQueueHandler } from "./types";
import { withWebLock, OFFLINE_WRITE_LOCK } from "@/lib/webLock";
import {
  SeatSyncCoordinator,
  seatSyncCoordinator,
} from "./SeatSyncCoordinator";

export const QUEUE_STORE_NAME = "pending_sync_queue";
export const SYNC_QUEUE_CHANNEL = "worksphere:sync-queue-channel";
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;

export type WarningToastDispatcher = (message: string) => void;

export interface SyncQueueManagerOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onWarningToast?: WarningToastDispatcher;
}

export class SyncQueueManager {
  private static instance: SyncQueueManager | null = null;
  private handlers = new Map<OfflineQueueItem["entity"], OfflineQueueHandler>();
  private inMemoryQueue: Map<string, OfflineQueueItem> = new Map();
  private channel: BroadcastChannel | null = null;
  private isSyncing = false;
  private usingInMemoryFallback = false;
  private warningToastShown = false;
  private warningToastHandler?: WarningToastDispatcher;
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;

  constructor(options: SyncQueueManagerOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.warningToastHandler = options.onWarningToast;

    if (typeof window !== "undefined") {
      if (typeof BroadcastChannel !== "undefined") {
        try {
          this.channel = new BroadcastChannel(SYNC_QUEUE_CHANNEL);
          this.channel.onmessage = (event) => {
            if (event.data?.type === "SYNC_TRIGGERED") {
              void this.syncAll();
            }
          };
        } catch {
          // BroadcastChannel unavailable or restricted
        }
      }

      window.addEventListener("online", () => {
        void this.syncAll();
      });
    }
  }

  public static getInstance(
    options?: SyncQueueManagerOptions,
  ): SyncQueueManager {
    if (!SyncQueueManager.instance) {
      SyncQueueManager.instance = new SyncQueueManager(options);
    } else if (options?.onWarningToast) {
      SyncQueueManager.instance.warningToastHandler = options.onWarningToast;
    }
    return SyncQueueManager.instance;
  }

  public setWarningToastHandler(handler: WarningToastDispatcher): void {
    this.warningToastHandler = handler;
  }

  public isUsingInMemoryFallback(): boolean {
    return this.usingInMemoryFallback;
  }

  private activateInMemoryFallback(err: unknown): void {
    this.usingInMemoryFallback = true;
    const message =
      "Offline database upgrade failed; switched to temporary in-memory sync queue.";
    console.warn(`[SyncQueueManager] ${message}`, err);

    if (!this.warningToastShown) {
      this.warningToastShown = true;
      if (this.warningToastHandler) {
        this.warningToastHandler(message);
      } else if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("worksphere:toast", {
            detail: { message, type: "warning" },
          }),
        );
      }
    }
  }

  /**
   * Registers a sync handler for a given entity type (review, note, checkin, amenity_vote).
   */
  public registerHandler(
    entity: OfflineQueueItem["entity"],
    handler: OfflineQueueHandler,
  ): this {
    this.handlers.set(entity, handler);
    return this;
  }

  /**
   * Computes jittered exponential backoff delay for retry attempts.
   */
  public calculateBackoff(retryCount: number): number {
    const exponential = this.baseDelayMs * Math.pow(2, retryCount);
    const capped = Math.min(this.maxDelayMs, exponential);
    const jitter = Math.random() * 500;
    return capped + jitter;
  }

  /**
   * Enqueues an offline mutation item into the persistent store (with in-memory fallback).
   */
  public async enqueue<T = unknown>(
    item: Omit<OfflineQueueItem<T>, "id" | "timestamp" | "retryCount"> & {
      id?: string;
      timestamp?: number;
      retryCount?: number;
    },
  ): Promise<OfflineQueueItem<T>> {
    const queueItem: OfflineQueueItem<T> = {
      id:
        item.id ||
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `queue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
      entity: item.entity,
      action: item.action,
      payload: item.payload,
      timestamp: item.timestamp ?? Date.now(),
      retryCount: item.retryCount ?? 0,
    };

    return withWebLock(async () => {
      try {
        const db = await initOfflineDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([QUEUE_STORE_NAME], "readwrite");
          const store = tx.objectStore(QUEUE_STORE_NAME);
          const req = store.put(queueItem);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        this.usingInMemoryFallback = false;
      } catch (err) {
        this.activateInMemoryFallback(err);
        this.inMemoryQueue.set(queueItem.id, queueItem as OfflineQueueItem);
      }

      this.notifyPeers();
      return queueItem;
    }, OFFLINE_WRITE_LOCK);
  }

  /**
   * Removes an item from the queue by ID.
   */
  public async dequeue(id: string): Promise<void> {
    return withWebLock(async () => {
      this.inMemoryQueue.delete(id);
      try {
        const db = await initOfflineDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([QUEUE_STORE_NAME], "readwrite");
          const store = tx.objectStore(QUEUE_STORE_NAME);
          const req = store.delete(id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch {
        // Fallback already removed from inMemoryQueue
      }
    }, OFFLINE_WRITE_LOCK);
  }

  /**
   * Retrieves all queue items, optionally filtered by entity type.
   */
  public async getQueue(
    entity?: OfflineQueueItem["entity"],
  ): Promise<OfflineQueueItem[]> {
    let items: OfflineQueueItem[] = [];

    try {
      const db = await initOfflineDB();
      const dbItems = await new Promise<OfflineQueueItem[]>(
        (resolve, reject) => {
          const tx = db.transaction([QUEUE_STORE_NAME], "readonly");
          const store = tx.objectStore(QUEUE_STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () =>
            resolve((req.result as OfflineQueueItem[]) || []);
          req.onerror = () => reject(req.error);
        },
      );
      const merged = new Map<string, OfflineQueueItem>();
      for (const item of dbItems) merged.set(item.id, item);
      for (const item of this.inMemoryQueue.values()) merged.set(item.id, item);
      items = Array.from(merged.values());
    } catch (err) {
      this.activateInMemoryFallback(err);
      items = Array.from(this.inMemoryQueue.values());
    }

    if (entity) {
      return items
        .filter((item) => item.entity === entity)
        .sort((a, b) => a.timestamp - b.timestamp);
    }
    return items.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Retrieves a single queue item by ID.
   */
  public async getItem(id: string): Promise<OfflineQueueItem | null> {
    if (this.inMemoryQueue.has(id)) {
      return this.inMemoryQueue.get(id) ?? null;
    }
    try {
      const db = await initOfflineDB();
      return await new Promise<OfflineQueueItem | null>((resolve, reject) => {
        const tx = db.transaction([QUEUE_STORE_NAME], "readonly");
        const store = tx.objectStore(QUEUE_STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as OfflineQueueItem) ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryQueue.get(id) ?? null;
    }
  }

  /**
   * Returns total count of pending items in queue.
   */
  public async getPendingCount(
    entity?: OfflineQueueItem["entity"],
  ): Promise<number> {
    const items = await this.getQueue(entity);
    return items.length;
  }

  /**
   * Clears queue items, optionally filtered by entity type.
   */
  public async clearQueue(entity?: OfflineQueueItem["entity"]): Promise<void> {
    return withWebLock(async () => {
      if (!entity) {
        this.inMemoryQueue.clear();
        try {
          const db = await initOfflineDB();
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([QUEUE_STORE_NAME], "readwrite");
            const store = tx.objectStore(QUEUE_STORE_NAME);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
        } catch {
          // ignore
        }
      } else {
        const items = await this.getQueue(entity);
        for (const item of items) {
          await this.dequeue(item.id);
        }
      }
    }, OFFLINE_WRITE_LOCK);
  }

  /**
   * Non-destructive database reset: preserves pending in-memory items while rebuilding
   * the IndexedDB schema cleanly.
   */
  public async resetDatabaseNonDestructive(): Promise<{
    restoredCount: number;
  }> {
    return withWebLock(async () => {
      const pendingItems = Array.from(this.inMemoryQueue.values());
      const result = await resetOfflineDBNonDestructive(
        pendingItems,
        QUEUE_STORE_NAME,
      );
      this.inMemoryQueue.clear();
      this.usingInMemoryFallback = false;
      this.warningToastShown = false;
      return result;
    }, OFFLINE_WRITE_LOCK);
  }

  /**
   * Executes sync for a single queue item using the registered handler.
   */
  public async syncItem(item: OfflineQueueItem): Promise<boolean> {
    const handler = this.handlers.get(item.entity);
    if (!handler) {
      console.warn(
        `[SyncQueueManager] No handler registered for entity: ${item.entity}`,
      );
      return false;
    }

    const isCheckIn = item.entity === "checkin";
    const payload = isCheckIn
      ? (item.payload as { venueId?: string; seatId?: string } | undefined)
      : undefined;
    const venueId = payload?.venueId;
    const seatId = payload?.seatId;

    const performSync = async (): Promise<boolean> => {
      if (isCheckIn && venueId) {
        seatSyncCoordinator.markReconciliationStart(venueId, seatId);
      }
      try {
        const result = await handler(item);
        if (result !== false) {
          await this.dequeue(item.id);
          return true;
        }
      } catch (error) {
        console.error(
          `[SyncQueueManager] Handler error for item ${item.id}:`,
          error,
        );
      } finally {
        if (isCheckIn && venueId) {
          seatSyncCoordinator.markReconciliationEnd(venueId, seatId);
        }
      }

      const nextRetry = item.retryCount + 1;
      if (nextRetry >= this.maxRetries) {
        console.warn(
          `[SyncQueueManager] Max retries (${this.maxRetries}) exceeded for item ${item.id}`,
        );
        await this.dequeue(item.id);
        return false;
      }

      item.retryCount = nextRetry;
      await this.updateItem(item);
      return false;
    };

    if (isCheckIn && venueId) {
      return seatSyncCoordinator.runWithSeatLock(venueId, seatId, performSync);
    }

    return performSync();
  }

  /**
   * Processes all queued items or those belonging to a specific entity.
   */
  public async processQueue(
    entity?: OfflineQueueItem["entity"],
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    if (this.isSyncing) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isSyncing = true;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      const items = await this.getQueue(entity);
      for (const item of items) {
        processed++;
        const success = await this.syncItem(item);
        if (success) {
          succeeded++;
        } else {
          failed++;
        }
      }
    } finally {
      this.isSyncing = false;
    }

    return { processed, succeeded, failed };
  }

  /**
   * Flushes and synchronizes all pending queue items across all entity handlers.
   */
  public async syncAll(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    return this.processQueue();
  }

  private async updateItem(item: OfflineQueueItem): Promise<void> {
    try {
      const db = await initOfflineDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([QUEUE_STORE_NAME], "readwrite");
        const store = tx.objectStore(QUEUE_STORE_NAME);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      this.inMemoryQueue.set(item.id, item);
    }
  }

  private notifyPeers(): void {
    try {
      this.channel?.postMessage({ type: "SYNC_TRIGGERED" });
    } catch {
      // ignore
    }
  }

  /**
   * For testing purposes: resets in-memory state and singleton.
   */
  public static resetInstance(): void {
    if (SyncQueueManager.instance) {
      SyncQueueManager.instance.inMemoryQueue.clear();
      SyncQueueManager.instance.handlers.clear();
      SyncQueueManager.instance.usingInMemoryFallback = false;
      SyncQueueManager.instance.warningToastShown = false;
      SyncQueueManager.instance = null;
    }
    SeatSyncCoordinator.resetInstance();
  }
}

export const syncQueueManager = SyncQueueManager.getInstance();
