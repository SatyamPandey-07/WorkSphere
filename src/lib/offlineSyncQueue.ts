/**
 * Resilient Offline Background Sync Queue with Exponential Backoff, Jitter,
 * Concurrency Throttling, and Dead-Letter Queue (DLQ) handling.
 */

export type SyncItemStatus =
  | "pending"
  | "processing"
  | "retry"
  | "completed"
  | "dead_letter";

export interface SyncQueueItem<T = unknown> {
  id: string;
  type: string;
  payload: T;
  status: SyncItemStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  maxRetries: number;
  nextAttemptAt: number;
  lastError?: string;
}

export interface QueueConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
  concurrency: number;
  jitterFactor: number;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  maxRetries: 5,
  concurrency: 3,
  jitterFactor: 0.5,
};

export interface QueueStats {
  pending: number;
  processing: number;
  retry: number;
  completed: number;
  deadLetter: number;
  total: number;
}

export type SyncQueueEventType =
  | "queue:start"
  | "queue:progress"
  | "queue:item_success"
  | "queue:item_retry"
  | "queue:item_dlq"
  | "queue:drained"
  | "queue:idle";

export interface SyncQueueEvent {
  type: SyncQueueEventType;
  item?: SyncQueueItem;
  stats: QueueStats;
  error?: Error;
}

/**
 * Calculates exponential backoff with full jitter to avoid thundering-herd problems.
 * Formula: delay = min(maxDelay, baseDelay * 2^attempt) + randomJitter
 */
export function calculateBackoff(
  attempt: number,
  config: Partial<QueueConfig> = {},
  randomFn: () => number = Math.random,
): number {
  const base = config.baseDelayMs ?? DEFAULT_QUEUE_CONFIG.baseDelayMs;
  const max = config.maxDelayMs ?? DEFAULT_QUEUE_CONFIG.maxDelayMs;
  const jitterFactor = config.jitterFactor ?? DEFAULT_QUEUE_CONFIG.jitterFactor;

  const rawBackoff = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  const jitter = rawBackoff * jitterFactor * randomFn();

  return Math.round(Math.min(max, rawBackoff + jitter));
}

/**
 * Generates a unique queue item identifier.
 */
function generateId(): string {
  return `sync_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class OfflineSyncQueueManager {
  private config: QueueConfig;
  private items: Map<string, SyncQueueItem> = new Map();
  private listeners: Set<(event: SyncQueueEvent) => void> = new Set();
  private activeProcessing = false;
  private abortController: AbortController | null = null;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }

  /**
   * Enqueues an action payload for offline sync.
   */
  public enqueue<T = unknown>(
    type: string,
    payload: T,
    options: { maxRetries?: number; id?: string } = {},
  ): SyncQueueItem<T> {
    const now = Date.now();
    const id = options.id || generateId();

    const item: SyncQueueItem<T> = {
      id,
      type,
      payload,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      maxRetries: options.maxRetries ?? this.config.maxRetries,
      nextAttemptAt: now,
    };

    this.items.set(id, item as SyncQueueItem);
    this.emitEvent("queue:progress", item as SyncQueueItem);
    return item;
  }

  /**
   * Retrieves a single queue item by ID.
   */
  public getItem(id: string): SyncQueueItem | undefined {
    return this.items.get(id);
  }

  /**
   * Retrieves items optionally filtered by status.
   */
  public getItems(status?: SyncItemStatus): SyncQueueItem[] {
    const all = Array.from(this.items.values());
    if (!status) return all;
    return all.filter((i) => i.status === status);
  }

  /**
   * Aggregates item counts by current status.
   */
  public getStats(): QueueStats {
    let pending = 0;
    let processing = 0;
    let retry = 0;
    let completed = 0;
    let deadLetter = 0;

    for (const item of this.items.values()) {
      switch (item.status) {
        case "pending":
          pending++;
          break;
        case "processing":
          processing++;
          break;
        case "retry":
          retry++;
          break;
        case "completed":
          completed++;
          break;
        case "dead_letter":
          deadLetter++;
          break;
      }
    }

    return {
      pending,
      processing,
      retry,
      completed,
      deadLetter,
      total: this.items.size,
    };
  }

  /**
   * Subscribe to queue lifecycle and progress events.
   */
  public subscribe(listener: (event: SyncQueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Returns true if queue processing is actively executing.
   */
  public isProcessing(): boolean {
    return this.activeProcessing;
  }

  /**
   * Cancels active queue processing.
   */
  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.activeProcessing = false;
    this.emitEvent("queue:idle");
  }

  /**
   * Clears all items from the queue.
   */
  public clear(): void {
    this.cancel();
    this.items.clear();
    this.emitEvent("queue:progress");
  }

  /**
   * Purges completed items to prevent memory unbounded growth.
   */
  public clearCompleted(): number {
    let purged = 0;
    for (const [id, item] of this.items.entries()) {
      if (item.status === "completed") {
        this.items.delete(id);
        purged++;
      }
    }
    if (purged > 0) {
      this.emitEvent("queue:progress");
    }
    return purged;
  }

  /**
   * Re-queues a dead-letter item (or all dead-letter items) for retry.
   */
  public retryDeadLetter(id?: string): number {
    const now = Date.now();
    let count = 0;

    if (id) {
      const item = this.items.get(id);
      if (item && item.status === "dead_letter") {
        item.status = "pending";
        item.attempts = 0;
        item.nextAttemptAt = now;
        item.updatedAt = now;
        item.lastError = undefined;
        count++;
        this.emitEvent("queue:progress", item);
      }
    } else {
      for (const item of this.items.values()) {
        if (item.status === "dead_letter") {
          item.status = "pending";
          item.attempts = 0;
          item.nextAttemptAt = now;
          item.updatedAt = now;
          item.lastError = undefined;
          count++;
        }
      }
      if (count > 0) {
        this.emitEvent("queue:progress");
      }
    }

    return count;
  }

  /**
   * Processes ready items using concurrency-limited workers.
   */
  public async process(
    handler: (item: SyncQueueItem) => Promise<void>,
  ): Promise<QueueStats> {
    if (this.activeProcessing) {
      return this.getStats();
    }

    this.activeProcessing = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.emitEvent("queue:start");

    try {
      while (this.activeProcessing && !signal.aborted) {
        const now = Date.now();

        // Get ready items (pending or retry where nextAttemptAt <= now)
        const readyItems = Array.from(this.items.values()).filter(
          (item) =>
            (item.status === "pending" || item.status === "retry") &&
            item.nextAttemptAt <= now,
        );

        if (readyItems.length === 0) {
          break;
        }

        // Process up to `concurrency` items concurrently
        const batch = readyItems.slice(0, this.config.concurrency);

        await Promise.all(
          batch.map(async (item) => {
            if (signal.aborted) return;
            await this.processItem(item, handler);
          }),
        );
      }
    } finally {
      this.activeProcessing = false;
      this.abortController = null;
      const finalStats = this.getStats();

      if (finalStats.pending === 0 && finalStats.retry === 0) {
        this.emitEvent("queue:drained");
      } else {
        this.emitEvent("queue:idle");
      }
    }

    return this.getStats();
  }

  /**
   * Processes a single item with error handling, backoff, and DLQ escalation.
   */
  private async processItem(
    item: SyncQueueItem,
    handler: (item: SyncQueueItem) => Promise<void>,
  ): Promise<void> {
    const now = Date.now();
    item.status = "processing";
    item.updatedAt = now;
    item.attempts++;
    this.emitEvent("queue:progress", item);

    try {
      await handler(item);

      item.status = "completed";
      item.updatedAt = Date.now();
      item.lastError = undefined;
      this.emitEvent("queue:item_success", item);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : String(err || "Unknown error");
      item.updatedAt = Date.now();
      item.lastError = errorMsg;

      if (item.attempts >= item.maxRetries) {
        // Exceeded maximum retry attempts -> escalate to Dead-Letter Queue
        item.status = "dead_letter";
        this.emitEvent("queue:item_dlq", item, err instanceof Error ? err : new Error(errorMsg));
      } else {
        // Schedule next retry with exponential backoff & jitter
        const delay = calculateBackoff(item.attempts, this.config);
        item.status = "retry";
        item.nextAttemptAt = Date.now() + delay;
        this.emitEvent("queue:item_retry", item, err instanceof Error ? err : new Error(errorMsg));
      }
    }
  }

  private emitEvent(
    type: SyncQueueEventType,
    item?: SyncQueueItem,
    error?: Error,
  ): void {
    const event: SyncQueueEvent = {
      type,
      item,
      stats: this.getStats(),
      error,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[OfflineSyncQueue] Listener exception:", err);
      }
    }
  }
}

/**
 * Singleton instance for app-wide offline sync queueing.
 */
export const globalSyncQueue = new OfflineSyncQueueManager();

/**
 * Factory helper for custom queue configurations.
 */
export function createOfflineSyncQueue(
  config?: Partial<QueueConfig>,
): OfflineSyncQueueManager {
  return new OfflineSyncQueueManager(config);
}
