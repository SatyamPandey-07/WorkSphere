import { initOfflineDB } from "../db";
import type { SyncItem, SyncResult, ISyncPlugin, SyncItemStatus } from "../types";
import { BackoffManager, jitteredReconnectDelay } from "@/lib/utils/backoff";
import { withWebLock } from "@/lib/webLock";

export const DEFAULT_SYNC_LOCK_NAME = "worksphere:global-sync-lock";
export const DEFAULT_SYNC_CHANNEL_NAME = "worksphere:global-sync-channel";
export const MAX_SYNC_RETRIES = 5;

/**
 * Generic SyncEngine managing domain sync plugins, persistent queues,
 * exponential backoff retry scheduling, and cross-tab lock orchestration.
 */
export class SyncEngine<T = unknown> {
  private plugins = new Map<string, ISyncPlugin<any>>();
  private backoffManager = new BackoffManager({ maxRetries: MAX_SYNC_RETRIES });
  private syncChannel: BroadcastChannel | null = null;
  private isRunning = false;

  constructor() {
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      this.syncChannel = new BroadcastChannel(DEFAULT_SYNC_CHANNEL_NAME);
      this.syncChannel.onmessage = (event) => {
        if (event.data?.type === "SYNC_TRIGGERED") {
          void this.processAll();
        }
      };
    }
  }

  /**
   * Registers a domain sync plugin (e.g. reviews, notes, tags).
   */
  public registerPlugin<P>(plugin: ISyncPlugin<P>): this {
    this.plugins.set(plugin.domain, plugin);
    return this;
  }

  /**
   * Enqueues an item into the persistent IndexedDB queue.
   */
  public async enqueue(domain: string, payload: T, id?: string): Promise<string> {
    const itemId = id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sync-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    const db = await initOfflineDB();

    const item: SyncItem<T> = {
      id: itemId,
      domain,
      payload,
      timestamp: Date.now(),
      retryCount: 0,
      status: "PENDING",
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["pending_sync_queue"], "readwrite");
      const store = tx.objectStore("pending_sync_queue");
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    this.notifyPeers();
    return itemId;
  }

  /**
   * Retrieves pending sync items for a specific domain or all domains.
   */
  public async getQueue(domain?: string): Promise<SyncItem<T>[]> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pending_sync_queue"], "readonly");
      const store = tx.objectStore("pending_sync_queue");
      const req = store.getAll();

      req.onsuccess = () => {
        const all = (req.result as SyncItem<T>[]) || [];
        if (domain) {
          resolve(all.filter((item) => item.domain === domain));
        } else {
          resolve(all);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Updates an item's status in the queue.
   */
  public async updateItem(item: SyncItem<T>): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pending_sync_queue"], "readwrite");
      const store = tx.objectStore("pending_sync_queue");
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Removes synced/discarded item from the queue.
   */
  public async removeItem(id: string): Promise<void> {
    const db = await initOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["pending_sync_queue"], "readwrite");
      const store = tx.objectStore("pending_sync_queue");
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Processes all pending sync items across all registered plugins.
   */
  public async processAll(): Promise<Record<string, SyncResult>> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return {};
    }

    return withWebLock(async () => {
      if (this.isRunning) return {};
      this.isRunning = true;
      const results: Record<string, SyncResult> = {};

      try {
        const items = await this.getQueue();
        const groupedByDomain = new Map<string, SyncItem<T>[]>();

        for (const item of items) {
          if (item.status === "SYNCING") continue;
          const group = groupedByDomain.get(item.domain) ?? [];
          group.push(item);
          groupedByDomain.set(item.domain, group);
        }

        for (const [domain, domainItems] of groupedByDomain) {
          const plugin = this.plugins.get(domain);
          if (!plugin) continue;

          // Mark items as SYNCING
          for (const item of domainItems) {
            item.status = "SYNCING";
            await this.updateItem(item);
          }

          try {
            const res = await plugin.sync(domainItems);
            results[domain] = res;

            if (res.success && res.syncedIds) {
              for (const syncedId of res.syncedIds) {
                await this.removeItem(syncedId);
              }
              if (plugin.onSuccess) {
                const syncedItems = domainItems.filter((i) => res.syncedIds.includes(i.id));
                await plugin.onSuccess(syncedItems);
              }
            }

            // Handle conflicts or partial failures
            if (res.conflicts && res.conflicts.length > 0) {
              for (const conflict of res.conflicts) {
                const item = domainItems.find((i) => i.id === conflict.id);
                if (item) {
                  item.status = "CONFLICT";
                  item.conflictDetails = { serverState: conflict.serverState as any };
                  if (plugin.resolveConflict) {
                    const resolved = await plugin.resolveConflict(item, conflict.serverState);
                    if (resolved !== null) {
                      item.payload = resolved as any;
                      item.status = "PENDING";
                      item.retryCount = 0;
                    }
                  }
                  await this.updateItem(item);
                }
              }
            }

            if (res.failedIds && res.failedIds.length > 0) {
              for (const failedId of res.failedIds) {
                const item = domainItems.find((i) => i.id === failedId);
                if (item) {
                  item.retryCount += 1;
                  item.status = item.retryCount >= MAX_SYNC_RETRIES ? "FAILED" : "PENDING";
                  await this.updateItem(item);
                }
              }
            }
          } catch (err: any) {
            console.error(`[SyncEngine] Domain ${domain} sync error:`, err);
            for (const item of domainItems) {
              item.retryCount += 1;
              item.status = item.retryCount >= MAX_SYNC_RETRIES ? "FAILED" : "PENDING";
              await this.updateItem(item);
            }
            if (plugin.onFailure) {
              await plugin.onFailure(err, domainItems);
            }
          }
        }
      } finally {
        this.isRunning = false;
      }

      return results;
    }, DEFAULT_SYNC_LOCK_NAME);
  }

  private notifyPeers(): void {
    if (this.syncChannel) {
      try {
        this.syncChannel.postMessage({ type: "SYNC_TRIGGERED", timestamp: Date.now() });
      } catch {
        // BroadcastChannel delivery failure is non-fatal
      }
    }
  }
}

export const globalSyncEngine = new SyncEngine();
