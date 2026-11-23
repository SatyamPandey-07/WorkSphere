/**
 * OfflineMutationQueue.ts
 *
 * Implements a resilient client-side mutation outbox queue integrated with the
 * W3C Background Sync API (ServiceWorkerRegistration.sync).
 *
 * Capabilities:
 * - One-shot Background Sync registration on supported browsers (Chromium).
 * - Graceful fallback to `window.online` and `visibilitychange` listeners on iOS Safari / WebKit.
 * - Full Jitter exponential backoff on reconnection to prevent thundering herd spikes.
 * - Decorrelated Jitter backoff during repeated HTTP 5xx API server errors.
 */

import {
  calculateFullJitterBackoff,
  calculateDecorrelatedJitterBackoff,
} from "@/lib/utils/backoff";

export const DEFAULT_SYNC_TAG = "sync-offline-mutations";
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;
export const DEFAULT_DECORRELATED_FACTOR = 3;

export type HttpMethod = "POST" | "PUT" | "PATCH" | "DELETE";
export type MutationStatus = "PENDING" | "SYNCING" | "COMPLETED" | "FAILED";

export interface OfflineMutation<T = unknown> {
  id: string;
  tag: string;
  endpoint: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  payload: T;
  timestamp: number;
  retryCount: number;
  lastAttemptAt?: number;
  status: MutationStatus;
  lastError?: string;
  idempotencyKey?: string;
}

export interface OfflineMutationStorage {
  getItem(id: string): Promise<OfflineMutation | undefined>;
  getAll(): Promise<OfflineMutation[]>;
  saveItem(mutation: OfflineMutation): Promise<void>;
  removeItem(id: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryMutationStorage implements OfflineMutationStorage {
  private store = new Map<string, OfflineMutation>();

  async getItem(id: string): Promise<OfflineMutation | undefined> {
    const item = this.store.get(id);
    return item ? { ...item } : undefined;
  }

  async getAll(): Promise<OfflineMutation[]> {
    return Array.from(this.store.values()).map((item) => ({ ...item }));
  }

  async saveItem(mutation: OfflineMutation): Promise<void> {
    this.store.set(mutation.id, { ...mutation });
  }

  async removeItem(id: string): Promise<void> {
    this.store.delete(id);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export const OFFLINE_MUTATIONS_DB_NAME = "WorkSphereOfflineMutationsDB";
export const OFFLINE_MUTATIONS_STORE_NAME = "offline_mutations";

/**
 * Persistent IndexedDB storage for offline mutations.
 * Falls back to InMemoryMutationStorage if IndexedDB is blocked or unavailable.
 */
export class IndexedDBMutationStorage implements OfflineMutationStorage {
  private inMemoryFallback = new InMemoryMutationStorage();

  private async getDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return null;
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(OFFLINE_MUTATIONS_DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(OFFLINE_MUTATIONS_STORE_NAME)) {
            db.createObjectStore(OFFLINE_MUTATIONS_STORE_NAME, {
              keyPath: "id",
            });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async getItem(id: string): Promise<OfflineMutation | undefined> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.getItem(id);
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readonly");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async getAll(): Promise<OfflineMutation[]> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.getAll();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readonly");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async saveItem(mutation: OfflineMutation): Promise<void> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.saveItem(mutation);
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readwrite");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        store.put(mutation);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async removeItem(id: string): Promise<void> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.removeItem(id);
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readwrite");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.clear();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readwrite");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export interface OfflineMutationQueueOptions {
  syncTag?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  decorrelatedFactor?: number;
  storage?: OfflineMutationStorage;
  customFetch?: typeof fetch;
  applyFullJitterOnReconnection?: boolean;
  autoFlush?: boolean;
  onMutationSuccess?: (mutation: OfflineMutation) => void;
  onMutationFailure?: (mutation: OfflineMutation, error: Error) => void;
  onSyncComplete?: (results: { succeeded: number; failed: number }) => void;
}

export class OfflineMutationQueue {
  private readonly syncTag: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly decorrelatedFactor: number;
  private readonly storage: OfflineMutationStorage;
  private readonly fetchFn: typeof fetch;
  private readonly applyFullJitterOnReconnection: boolean;
  private readonly autoFlush: boolean;

  private isFlushing = false;
  private usingFallback = false;
  private fallbackListenersAttached = false;
  private cleanupFallback?: () => void;
  private current5xxDelay: number;

  private onMutationSuccess?: (mutation: OfflineMutation) => void;
  private onMutationFailure?: (mutation: OfflineMutation, error: Error) => void;
  private onSyncComplete?: (results: {
    succeeded: number;
    failed: number;
  }) => void;

  constructor(options: OfflineMutationQueueOptions = {}) {
    this.syncTag = options.syncTag ?? DEFAULT_SYNC_TAG;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.decorrelatedFactor =
      options.decorrelatedFactor ?? DEFAULT_DECORRELATED_FACTOR;
    this.storage = options.storage ?? new InMemoryMutationStorage();
    this.fetchFn =
      options.customFetch ??
      (typeof fetch !== "undefined"
        ? fetch.bind(globalThis)
        : (undefined as any));
    this.applyFullJitterOnReconnection =
      options.applyFullJitterOnReconnection ?? true;
    this.autoFlush = options.autoFlush ?? false;
    this.current5xxDelay = this.baseDelayMs;

    this.onMutationSuccess = options.onMutationSuccess;
    this.onMutationFailure = options.onMutationFailure;
    this.onSyncComplete = options.onSyncComplete;

    // Check environment: if window is present but SyncManager is not, setup fallback listeners immediately
    if (typeof window !== "undefined" && !this.isBackgroundSyncSupported()) {
      this.setupFallbackListeners();
    }
  }

  /**
   * Checks whether the current runtime environment supports W3C ServiceWorker SyncManager.
   */
  public isBackgroundSyncSupported(): boolean {
    const hasSyncManager =
      (typeof window !== "undefined" && "SyncManager" in window) ||
      (typeof globalThis !== "undefined" && "SyncManager" in globalThis);
    const hasServiceWorker =
      typeof navigator !== "undefined" &&
      navigator.serviceWorker !== undefined &&
      navigator.serviceWorker !== null;
    return Boolean(hasSyncManager && hasServiceWorker);
  }

  /**
   * Returns whether the queue is currently relying on iOS Safari / WebKit window online fallback.
   */
  public isUsingFallback(): boolean {
    return this.usingFallback;
  }

  /**
   * Sets up graceful fallback listeners for platforms lacking Background Sync API (e.g. iOS Safari).
   */
  public setupFallbackListeners(): void {
    if (this.fallbackListenersAttached || typeof window === "undefined") {
      return;
    }

    this.usingFallback = true;
    this.fallbackListenersAttached = true;

    const handleOnline = () => {
      void this.flush({ reason: "reconnection" });
    };

    const handleVisibilityChange = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        (typeof navigator === "undefined" || navigator.onLine)
      ) {
        void this.flush({ reason: "visibility" });
      }
    };

    window.addEventListener("online", handleOnline);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    this.cleanupFallback = () => {
      window.removeEventListener("online", handleOnline);
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
      this.fallbackListenersAttached = false;
    };
  }

  /**
   * Dismantles fallback listeners and releases references.
   */
  public destroy(): void {
    if (this.cleanupFallback) {
      this.cleanupFallback();
      this.cleanupFallback = undefined;
    }
  }

  /**
   * Registers a one-shot background sync tag with the active ServiceWorkerRegistration.
   * Returns true if registered successfully, or false if falling back to window online listeners.
   */
  public async registerBackgroundSync(tag?: string): Promise<boolean> {
    const targetTag = tag ?? this.syncTag;

    if (this.isBackgroundSyncSupported()) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (
          registration &&
          "sync" in registration &&
          typeof (registration as any).sync?.register === "function"
        ) {
          await (registration as any).sync.register(targetTag);
          this.usingFallback = false;
          return true;
        }
      } catch (err) {
        console.warn(
          `[OfflineMutationQueue] ServiceWorker sync.register("${targetTag}") failed:`,
          err,
        );
      }
    }

    // Graceful fallback for iOS Safari or when registration is rejected
    this.setupFallbackListeners();
    return false;
  }

  /**
   * Enqueues a new mutation to be synchronized upon reconnection or immediately if online.
   */
  public async enqueue<T = unknown>(
    input: Omit<
      OfflineMutation<T>,
      "id" | "timestamp" | "retryCount" | "status" | "tag"
    > & {
      id?: string;
      tag?: string;
      timestamp?: number;
      retryCount?: number;
      status?: MutationStatus;
    },
  ): Promise<OfflineMutation<T>> {
    const id =
      input.id ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `mutation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

    const mutation: OfflineMutation<T> = {
      id,
      tag: input.tag ?? this.syncTag,
      endpoint: input.endpoint,
      method: input.method,
      headers: input.headers,
      payload: input.payload,
      timestamp: input.timestamp ?? Date.now(),
      retryCount: input.retryCount ?? 0,
      status: input.status ?? "PENDING",
      idempotencyKey: input.idempotencyKey ?? id,
    };

    await this.storage.saveItem(mutation as OfflineMutation);

    // Register Background Sync or fallback to online listener
    await this.registerBackgroundSync(mutation.tag);

    // If online in fallback mode and autoFlush is enabled, flush immediately
    if (
      this.autoFlush &&
      typeof navigator !== "undefined" &&
      navigator.onLine &&
      this.usingFallback
    ) {
      void this.flush({ reason: "immediate" });
    }

    return mutation;
  }

  /**
   * Convenience helper to enqueue booking creations or updates for background synchronization.
   */
  public async enqueueBooking<T = unknown>(
    bookingPayload: T,
    options: {
      endpoint?: string;
      method?: HttpMethod;
      headers?: Record<string, string>;
      idempotencyKey?: string;
    } = {},
  ): Promise<OfflineMutation<T>> {
    return this.enqueue<T>({
      endpoint: options.endpoint ?? "/api/bookings",
      method: options.method ?? "POST",
      payload: bookingPayload,
      headers: options.headers,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /**
   * Retrieves all mutations currently stored in the queue.
   */
  public async getQueue(): Promise<OfflineMutation[]> {
    return this.storage.getAll();
  }

  /**
   * Retrieves pending mutations waiting to be synced.
   */
  public async getPendingMutations(): Promise<OfflineMutation[]> {
    const all = await this.storage.getAll();
    return all.filter((item) => item.status === "PENDING");
  }

  /**
   * Computes Full Jitter backoff delay for reconnection to prevent thundering herd spikes.
   */
  public calculateReconnectionJitter(attempt: number = 1): number {
    return calculateFullJitterBackoff(attempt, {
      baseDelay: this.baseDelayMs,
      maxDelay: Math.min(this.maxDelayMs, 10000),
    });
  }

  /**
   * Computes Decorrelated Jitter backoff delay for repeated 5xx API server responses.
   */
  public calculate5xxDecorrelatedJitter(): number {
    const nextDelay = calculateDecorrelatedJitterBackoff(this.current5xxDelay, {
      baseDelay: this.baseDelayMs,
      maxDelay: this.maxDelayMs,
      factor: this.decorrelatedFactor,
    });
    this.current5xxDelay = nextDelay;
    return nextDelay;
  }

  /**
   * Resets the 5xx decorrelated delay state to base delay.
   */
  public reset5xxDelay(): void {
    this.current5xxDelay = this.baseDelayMs;
  }

  /**
   * Gets the current 5xx decorrelated delay value.
   */
  public getCurrent5xxDelay(): number {
    return this.current5xxDelay;
  }

  /**
   * Flushes the offline mutation queue, executing requests and applying jitter backoff on errors.
   */
  public async flush(
    options: {
      reason?: "reconnection" | "sync_event" | "immediate" | "visibility";
      skipDelay?: boolean;
    } = {},
  ): Promise<{
    succeeded: number;
    failed: number;
  }> {
    if (this.isFlushing) {
      return { succeeded: 0, failed: 0 };
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { succeeded: 0, failed: 0 };
    }

    this.isFlushing = true;

    try {
      // Apply Full Jitter delay on reconnection to avoid thundering herd spikes
      if (
        options.reason === "reconnection" &&
        this.applyFullJitterOnReconnection &&
        !options.skipDelay
      ) {
        const jitterDelay = this.calculateReconnectionJitter(1);
        if (jitterDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, jitterDelay));
        }
      }

      let succeeded = 0;
      let failed = 0;

      const mutations = await this.storage.getAll();
      const pendingMutations = mutations.filter(
        (m) => m.status === "PENDING" || m.status === "SYNCING",
      );

      for (const mutation of pendingMutations) {
        mutation.status = "SYNCING";
        mutation.lastAttemptAt = Date.now();
        await this.storage.saveItem(mutation);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Idempotency-Key": mutation.idempotencyKey || mutation.id,
          ...(mutation.headers || {}),
        };

        try {
          const bodyPayload =
            mutation.method !== "DELETE" && mutation.payload !== undefined
              ? typeof mutation.payload === "string"
                ? mutation.payload
                : JSON.stringify(mutation.payload)
              : undefined;

          const response = await this.fetchFn(mutation.endpoint, {
            method: mutation.method,
            headers,
            body: bodyPayload,
          });

          // 2xx Success: mutation synced successfully
          if (response.ok) {
            mutation.status = "COMPLETED";
            await this.storage.removeItem(mutation.id);
            this.reset5xxDelay();
            succeeded++;
            this.onMutationSuccess?.(mutation);
            continue;
          }

          // 5xx Server Error: apply Decorrelated Jitter backoff
          if (response.status >= 500 && response.status < 600) {
            mutation.retryCount += 1;
            mutation.lastError = `HTTP ${response.status}: Server Error`;

            const backoffMs = this.calculate5xxDecorrelatedJitter();

            if (mutation.retryCount >= this.maxRetries) {
              mutation.status = "FAILED";
              await this.storage.saveItem(mutation);
              failed++;
              this.onMutationFailure?.(mutation, new Error(mutation.lastError));
            } else {
              mutation.status = "PENDING";
              await this.storage.saveItem(mutation);
            }

            // Pause execution using calculated decorrelated jitter delay before processing further
            if (backoffMs > 0 && !options.skipDelay) {
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
            continue;
          }

          // 4xx Client Error: permanent failure for this mutation
          mutation.retryCount += 1;
          mutation.status = "FAILED";
          mutation.lastError = `HTTP ${response.status}: Client Error`;
          await this.storage.saveItem(mutation);
          failed++;
          this.onMutationFailure?.(mutation, new Error(mutation.lastError));
        } catch (networkError: any) {
          // Network failure: retain mutation as PENDING and exit flush loop
          mutation.status = "PENDING";
          mutation.lastError = networkError?.message || "Network Error";
          await this.storage.saveItem(mutation);
          break;
        }
      }

      this.onSyncComplete?.({ succeeded, failed });
      return { succeeded, failed };
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Clears all mutations from the queue.
   */
  public async clear(): Promise<void> {
    await this.storage.clear();
    this.reset5xxDelay();
  }
}

export const offlineMutationQueue = new OfflineMutationQueue();
