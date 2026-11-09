/**
 * Unified Offline Sync Queue Manager.
 *
 * Consolidates fragmented retry, exponential backoff, multi-tab locking,
 * and background synchronisation routines for all offline entities:
 * reviews, collaborative notes, seat check-ins, and amenity votes.
 */

import { initOfflineDB } from "./db";
import type { OfflineQueueItem, OfflineQueueHandler } from "./types";
import { withWebLock, OFFLINE_WRITE_LOCK } from "@/lib/webLock";

export const QUEUE_STORE_NAME = "pending_sync_queue";
export const SYNC_QUEUE_CHANNEL = "worksphere:sync-queue-channel";
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;

export interface SyncQueueManagerOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class SyncQueueManager {
  private static instance: SyncQueueManager | null = null;
  private handlers = new Map<OfflineQueueItem["entity"], OfflineQueueHandler>();
  private inMemoryQueue: Map<string, OfflineQueueItem> = new Map();
  private channel: BroadcastChannel | null = null;
  private isSyncing = false;
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;

  constructor(options: SyncQueueManagerOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

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

  public static getInstance(options?: SyncQueueManagerOptions): SyncQueueManager {
    if (!SyncQueueManager.instance) {
      SyncQueueManager.instance = new SyncQueueManager(options);
    }
    return SyncQueueManager.instance;
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
   * Enqueues an offline mutation item into the persistent store.
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
      } catch {
        // Fallback to in-memory queue if IndexedDB is unavailable
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
        // Fallback
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
      items = await new Promise<OfflineQueueItem[]>((resolve, reject) => {
        const tx = db.transaction([QUEUE_STORE_NAME], "readonly");
        const store = tx.objectStore(QUEUE_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as OfflineQueueItem[]) || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      items = Array.from(this.inMemoryQueue.values());
    }

    if (entity) {
      return items.filter((item) => item.entity === entity);
    }
    return items.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Retrieves a single queue item by ID.
   */
  public async getItem(id: string): Promise<OfflineQueueItem | null> {
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
   * Executes sync for a single queue item using the registered handler.
   */
  public async syncItem(item: OfflineQueueItem): Promise<boolean> {
    const handler = this.handlers.get(item.entity);
    if (!handler) {
      console.warn(`[SyncQueueManager] No handler registered for entity: ${item.entity}`);
      return false;
    }

    try {
      const result = await handler(item);
      if (result !== false) {
        await this.dequeue(item.id);
        return true;
      }
    } catch (error) {
      console.error(`[SyncQueueManager] Handler error for item ${item.id}:`, error);
    }

    // Handle failure and retry scheduling
    const nextRetry = item.retryCount + 1;
    if (nextRetry >= this.maxRetries) {
      console.warn(`[SyncQueueManager] Max retries (${this.maxRetries}) exceeded for item ${item.id}`);
      await this.dequeue(item.id);
      return false;
    }

    item.retryCount = nextRetry;
    await this.updateItem(item);
    return false;
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
      SyncQueueManager.instance = null;
    }
  }
}

export const syncQueueManager = SyncQueueManager.getInstance();
