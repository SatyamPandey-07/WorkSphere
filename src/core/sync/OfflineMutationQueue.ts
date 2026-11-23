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
=======

 * Causal dependency buffering and vector clock monotonicity engine for offline mutations.
 * Resolves vector clock forks caused by out-of-order network arrival of disconnected mutations (#9636).
 *
 * Enforces the Birman-Schiper-Stephenson causal delivery condition:
 * 1. Immediate successor: mutation.clock[clientId] === localClock[clientId] + 1
 * 2. Predecessor dependencies: for all other nodes k !== clientId, mutation.clock[k] <= localClock[k]
 *
 * Out-of-order or orphan mutations are buffered in a pending dependency pool and
 * automatically cascade-applied in strict causal sequence when their predecessors arrive.
 */

export interface OfflineMutation<TPayload = unknown> {
  id: string;
  clientId: string;
  vectorClock: Record<string, number>;
  parentClock?: Record<string, number>;
  payload: TPayload;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export type MutationStatus = "APPLIED" | "BUFFERED" | "DUPLICATE" | "REJECTED";

export interface MutationEnqueueResult<TPayload = unknown> {
  status: MutationStatus;
  mutationId: string;
  appliedMutations: OfflineMutation<TPayload>[];
  bufferedCount: number;
  currentClock: Record<string, number>;
  reason?: string;
}

export interface OfflineMutationQueueConfig {
  nodeId?: string;
  initialClock?: Record<string, number>;
  maxBufferSize?: number;
}

export class OfflineMutationQueue<TPayload = unknown> {
  private readonly nodeId: string;
  private localClock: Record<string, number> = {};
  private pendingPool: Map<string, OfflineMutation<TPayload>> = new Map();
  private appliedIds: Set<string> = new Set();
  private appliedHistory: OfflineMutation<TPayload>[] = [];
  private readonly maxBufferSize: number;

  private onApplyCallback?: (mutation: OfflineMutation<TPayload>) => void;
  private onBufferCallback?: (mutation: OfflineMutation<TPayload>) => void;

  constructor(config: OfflineMutationQueueConfig = {}) {
    this.nodeId = config.nodeId || "server";
    this.maxBufferSize = config.maxBufferSize || 5000;

    if (config.initialClock) {
      for (const [node, counter] of Object.entries(config.initialClock)) {
        this.validateCounter(node, counter, "initialClock");
        this.localClock[node] = counter;
      }
    }

    if (this.localClock[this.nodeId] === undefined) {
      this.localClock[this.nodeId] = 0;
    }
  }

  // --- Clock & State Access ---

  public getNodeId(): string {
    return this.nodeId;
  }

  public getLocalClock(): Record<string, number> {
    return { ...this.localClock };
  }

  public getPendingCount(): number {
    return this.pendingPool.size;
  }

  public getPendingMutations(): OfflineMutation<TPayload>[] {
    return Array.from(this.pendingPool.values());
  }

  public getAppliedHistory(): OfflineMutation<TPayload>[] {
    return [...this.appliedHistory];
  }

  public isApplied(mutationId: string): boolean {
    return this.appliedIds.has(mutationId);
  }

  public isPending(mutationId: string): boolean {
    return this.pendingPool.has(mutationId);
  }

  public onApply(
    callback: (mutation: OfflineMutation<TPayload>) => void,
  ): void {
    this.onApplyCallback = callback;
  }

  public onBuffer(
    callback: (mutation: OfflineMutation<TPayload>) => void,
  ): void {
    this.onBufferCallback = callback;
  }

  // --- Mutation Ingestion & Causal Buffering ---

  /**
   * Enqueues an incoming offline mutation.
   *
   * - If already applied or duplicate: returns 'DUPLICATE'.
   * - If causal dependencies are met: applies immediately and cascades any unblocked orphans.
   * - If causal dependencies are missing (orphan mutation): buffers in pending pool.
   */
  public enqueue(
    mutation: OfflineMutation<TPayload>,
  ): MutationEnqueueResult<TPayload> {
    this.validateMutation(mutation);

    // 1. Idempotency / Stale Check
    if (this.appliedIds.has(mutation.id)) {
      return {
        status: "DUPLICATE",
        mutationId: mutation.id,
        appliedMutations: [],
        bufferedCount: this.pendingPool.size,
        currentClock: this.getLocalClock(),
        reason: "Mutation already applied",
      };
    }

    const client = mutation.clientId;
    const clientCounter = mutation.vectorClock[client] || 0;
    const currentLocalCounter = this.localClock[client] || 0;

    // If client's clock is already past or equal to this counter, it is a stale/duplicate message
    if (clientCounter <= currentLocalCounter) {
      return {
        status: "DUPLICATE",
        mutationId: mutation.id,
        appliedMutations: [],
        bufferedCount: this.pendingPool.size,
        currentClock: this.getLocalClock(),
        reason: `Stale mutation: client clock ${clientCounter} <= local clock ${currentLocalCounter}`,
      };
    }

    // 2. Evaluate Causal Readiness
    if (!this.canApply(mutation)) {
      // Buffer in pending dependency pool
      if (this.pendingPool.size >= this.maxBufferSize) {
        throw new Error(
          `OfflineMutationQueue buffer overflow: exceeded maxBufferSize of ${this.maxBufferSize}`,
        );
      }

      this.pendingPool.set(mutation.id, mutation);
      this.onBufferCallback?.(mutation);

      return {
        status: "BUFFERED",
        mutationId: mutation.id,
        appliedMutations: [],
        bufferedCount: this.pendingPool.size,
        currentClock: this.getLocalClock(),
        reason: "Buffered awaiting missing causal predecessor mutations",
      };
    }

    // 3. Apply Ready Mutation & Cascade Unblocked Orphans
    const applied: OfflineMutation<TPayload>[] = [];

    // Apply the primary mutation
    this.applyMutationDirectly(mutation);
    applied.push(mutation);

    // Cascade resolution over pending pool
    let progress = true;
    while (progress) {
      progress = false;

      for (const [id, orphan] of Array.from(this.pendingPool.entries())) {
        if (this.canApply(orphan)) {
          this.pendingPool.delete(id);
          this.applyMutationDirectly(orphan);
          applied.push(orphan);
          progress = true;
          break; // Restart scan to evaluate against the newly advanced vector clock
        }
      }
    }

    return {
      status: "APPLIED",
      mutationId: mutation.id,
      appliedMutations: applied,
      bufferedCount: this.pendingPool.size,
      currentClock: this.getLocalClock(),
    };
  }

  /**
   * Enqueues an ordered or unordered batch of mutations.
   */
  public enqueueBatch(
    mutations: OfflineMutation<TPayload>[],
  ): MutationEnqueueResult<TPayload>[] {
    return mutations.map((m) => this.enqueue(m));
  }

  /**
   * Evaluates the causal predecessor condition:
   * 1. If explicit parentClock is supplied:
   *    All parentClock node values must be <= localClock.
   *    And mutation.vectorClock[clientId] === (localClock[clientId] || 0) + 1.
   * 2. Standard Birman-Schiper-Stephenson condition:
   *    mutation.vectorClock[clientId] === (localClock[clientId] || 0) + 1
   *    AND for all other nodes k !== clientId, mutation.vectorClock[k] <= (localClock[k] || 0).
   */
  public canApply(mutation: OfflineMutation<TPayload>): boolean {
    const client = mutation.clientId;
    const clientClock = mutation.vectorClock[client] || 0;
    const localClientClock = this.localClock[client] || 0;

    // Must be the immediate next counter from this client
    if (clientClock !== localClientClock + 1) {
      return false;
    }

    // If explicit parentClock is provided, check each dependency
    if (mutation.parentClock) {
      for (const [node, parentVal] of Object.entries(mutation.parentClock)) {
        const localVal = this.localClock[node] || 0;
        if (parentVal > localVal) {
          return false;
        }
      }
    }

    // Check all other nodes in the vector clock
    for (const [node, counter] of Object.entries(mutation.vectorClock)) {
      if (node === client) continue;
      const localVal = this.localClock[node] || 0;
      if (counter > localVal) {
        return false;
      }
    }

    return true;
  }

  /**
   * Applies the mutation to the local state and advances the vector clock monotonically.
   */
  private applyMutationDirectly(mutation: OfflineMutation<TPayload>): void {
    const client = mutation.clientId;

    // Advance client counter monotonically
    this.localClock[client] = mutation.vectorClock[client];

    // Component-wise merge for any concurrent peer clocks embedded in vectorClock
    for (const [node, counter] of Object.entries(mutation.vectorClock)) {
      if (
        this.localClock[node] === undefined ||
        counter > this.localClock[node]
      ) {
        this.localClock[node] = counter;
      }
    }

    // Mark as applied
    this.appliedIds.add(mutation.id);
    this.appliedHistory.push(mutation);

    // Trigger callback
    this.onApplyCallback?.(mutation);
  }

  private validateMutation(mutation: OfflineMutation<TPayload>): void {
    if (!mutation || typeof mutation !== "object") {
      throw new TypeError("OfflineMutation must be an object");
    }
    if (
      !mutation.id ||
      typeof mutation.id !== "string" ||
      mutation.id.trim().length === 0
    ) {
      throw new TypeError("OfflineMutation requires a non-empty string id");
    }
    if (
      !mutation.clientId ||
      typeof mutation.clientId !== "string" ||
      mutation.clientId.trim().length === 0
    ) {
      throw new TypeError(
        "OfflineMutation requires a non-empty string clientId",
      );
    }
    if (!mutation.vectorClock || typeof mutation.vectorClock !== "object") {
      throw new TypeError("OfflineMutation requires a vectorClock object");
    }
    if (mutation.vectorClock[mutation.clientId] === undefined) {
      throw new TypeError(
        `OfflineMutation vectorClock must contain clientId "${mutation.clientId}"`,
      );
    }

    for (const [node, counter] of Object.entries(mutation.vectorClock)) {
      this.validateCounter(node, counter, "vectorClock");
    }

    if (mutation.parentClock) {
      for (const [node, counter] of Object.entries(mutation.parentClock)) {
        this.validateCounter(node, counter, "parentClock");
      }
    }
  }

  private validateCounter(node: string, counter: unknown, label: string): void {
    if (typeof node !== "string" || node.trim().length === 0) {
      throw new TypeError(`${label} contains an empty node identifier.`);
    }
    if (
      typeof counter !== "number" ||
      !Number.isSafeInteger(counter) ||
      counter < 0
    ) {
      throw new RangeError(
        `${label} counter for "${node}" must be a non-negative integer.`,
      );
    }
  }

  /**
   * Clears queue state (useful for tests or cache resets).
   */
  public clear(): void {
    this.pendingPool.clear();
    this.appliedIds.clear();
    this.appliedHistory = [];
    this.localClock = { [this.nodeId]: 0 };

 * Deterministic offline mutation queue with:
 * 1. Causal / FIFO replay ordering.
 * 2. Persistent IndexedDB mutation journal to survive page reloads and browser restarts.
 * 3. Automatic rollback of optimistic UI state when an offline mutation is rejected due
 *    to optimistic concurrency failure (HTTP 409 Conflict) or unprocessable entity (HTTP 422).
 * 4. In-memory runtime rollback callback registration ensuring functions are NEVER serialized
 *    into IndexedDB.
 * 5. Dependency-aware rollback handling for chained mutations.
 * 6. Dispatching `mutation:rollback` custom events for UI toast notifications.
 * 7. Automatic journal cleanup after fatal rejections or successful drain.
 */

export type MutationStatus = 'PENDING' | 'IN_FLIGHT' | 'FAILED';

export interface MutationErrorLike {
  status?: number;
  statusCode?: number;
  nonRetriable?: boolean;
  message?: string;
}

export interface QueuedMutation<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  orderKey: number;
  enqueuedAt: number;
  seq: number;
  attempts: number;
  maxRetries: number;
  status: MutationStatus;
  lastError?: string;
  /** Optional dependency link to a parent mutation ID in chained mutations */
  dependsOn?: string;
  /** Optional entity key to group sequential mutations affecting the same resource */
  entityKey?: string;
}

export interface EnqueueMutationInput<TPayload = unknown> {
  id?: string;
  type: string;
  payload: TPayload;
  orderKey?: number;
  maxRetries?: number;
  now?: number;
  /**
   * Runtime callback invoked to restore pre-mutation state on concurrency conflict.
   * Stored in-memory and never serialized into IndexedDB.
   */
  rollbackState?: () => void;
  /** Optional parent mutation ID this mutation depends upon */
  dependsOn?: string;
  /** Optional entity identifier (e.g. 'seat:A1', 'note:123') */
  entityKey?: string;
}

export type MutationExecutor<TPayload = unknown> = (
  mutation: QueuedMutation<TPayload>
) => Promise<void>;

export interface DrainSummary {
  succeeded: string[];
  requeued: string[];
  failed: string[];
  rolledBack: string[];
}

export interface QueueSnapshot<TPayload = unknown> {
  pendingCount: number;
  failedCount: number;
  items: Array<QueuedMutation<TPayload>>;
}

export interface MutationRollbackEventDetail {
  mutationId: string;
  mutationType: string;
  status: number;
  reason: string;
  rollbackSucceeded: boolean;
  error?: string;
  cascade?: boolean;
}

export const MUTATION_ROLLBACK_EVENT = 'mutation:rollback';

const DB_NAME = 'worksphere-offline-mutations';
const STORE_NAME = 'mutation_journal';
const DB_VERSION = 1;

let idCounter = 0;

function nextMutationId(): string {
  idCounter += 1;
  return `mut_${Date.now()}_${idCounter}`;
}

/**
 * Checks whether an error represents a fatal concurrency conflict or semantic failure
 * that must trigger immediate rollback rather than retry:
 * - HTTP 409 (Conflict)
 * - HTTP 422 (Unprocessable Entity)
 */
export function isConcurrencyRejection(err: unknown): {
  isConflict: boolean;
  status: number;
  reason: string;
} {
  if (!err || typeof err !== 'object') {
    return { isConflict: false, status: 0, reason: '' };
  }
  const candidate = err as MutationErrorLike;
  const status = candidate.status ?? candidate.statusCode;
  const message = candidate.message || (err instanceof Error ? err.message : 'Optimistic concurrency rejection');

  if (status === 409) {
    return {
      isConflict: true,
      status: 409,
      reason: message || 'Remote state conflict (HTTP 409 Conflict)',
    };
  }

  if (status === 422) {
    return {
      isConflict: true,
      status: 422,
      reason: message || 'Unprocessable mutation (HTTP 422 Unprocessable Entity)',
    };
  }

  return { isConflict: false, status: typeof status === 'number' ? status : 0, reason: message };
}

/**
 * Checks whether an error is permanently non-retriable (4xx except 408/429).
 */
export function isNonRetriableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as MutationErrorLike;
  if (candidate.nonRetriable === true) return true;
  const code = candidate.status ?? candidate.statusCode;
  if (typeof code === 'number' && code >= 400 && code < 500) {
    return code !== 408 && code !== 429;
  }
  return false;
}

export interface OfflineMutationQueueOptions {
  defaultMaxRetries?: number;
  dbName?: string;
  enablePersistence?: boolean;
}

export class OfflineMutationQueue<TPayload = unknown> {
  private readonly items = new Map<string, QueuedMutation<TPayload>>();
  /**
   * In-memory runtime rollback callbacks mapped by mutation ID.
   * Never serialized to disk/IndexedDB.
   */
  private readonly rollbackCallbacks = new Map<string, () => void>();
  private seqCounter = 0;
  private readonly defaultMaxRetries: number;
  private readonly dbName: string;
  private readonly enablePersistence: boolean;
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(options: OfflineMutationQueueOptions = {}) {
    this.defaultMaxRetries = Math.max(1, options.defaultMaxRetries ?? 3);
    this.dbName = options.dbName ?? DB_NAME;
    this.enablePersistence = options.enablePersistence ?? true;
  }

  /**
   * Registers or reconnects an in-memory rollback callback for a mutation.
   */
  public registerRollbackHandler(mutationId: string, callback: () => void): void {
    if (typeof callback === 'function') {
      this.rollbackCallbacks.set(mutationId, callback);
    }
  }

  /**
   * Initializes IndexedDB connection and loads persisted journal entries into memory.
   */
  public async init(): Promise<void> {
    if (!this.enablePersistence || typeof indexedDB === 'undefined') {
      return;
    }

    try {
      const db = await this.getDb();
      if (!db) return;

      const persistedItems = await this.readAllFromDb(db);
      for (const item of persistedItems) {
        if (!this.items.has(item.id)) {
          this.items.set(item.id, item);
          if (item.seq > this.seqCounter) {
            this.seqCounter = item.seq;
          }
        }
      }
    } catch (err) {
      console.warn('[OfflineMutationQueue] Failed to initialize persistent IndexedDB journal:', err);
    }
  }

  private async getDb(): Promise<IDBDatabase | null> {
    if (!this.enablePersistence || typeof indexedDB === 'undefined') {
      return null;
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.dbName, DB_VERSION);

        req.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };

        req.onsuccess = (event) => {
          resolve((event.target as IDBOpenDBRequest).result);
        };

        req.onerror = () => {
          console.warn('[OfflineMutationQueue] IndexedDB open error');
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  private async readAllFromDb(db: IDBDatabase): Promise<QueuedMutation<TPayload>[]> {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          resolve((req.result as QueuedMutation<TPayload>[]) || []);
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  private async persistItem(entry: QueuedMutation<TPayload>): Promise<void> {
    const db = await this.getDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        // Strip out any non-serializable properties just in case
        const clean: QueuedMutation<TPayload> = {
          id: entry.id,
          type: entry.type,
          payload: entry.payload,
          orderKey: entry.orderKey,
          enqueuedAt: entry.enqueuedAt,
          seq: entry.seq,
          attempts: entry.attempts,
          maxRetries: entry.maxRetries,
          status: entry.status,
          lastError: entry.lastError,
          dependsOn: entry.dependsOn,
          entityKey: entry.entityKey,
        };

        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(clean);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async deleteFromDb(id: string): Promise<void> {
    const db = await this.getDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Enqueues an optimistic mutation with optional rollbackState handler.
   */
  public enqueue(input: EnqueueMutationInput<TPayload>): QueuedMutation<TPayload> {
    const now = input.now ?? Date.now();
    this.seqCounter += 1;
    const id = input.id?.trim() || nextMutationId();

    const entry: QueuedMutation<TPayload> = {
      id,
      type: input.type,
      payload: input.payload,
      orderKey: input.orderKey ?? now,
      enqueuedAt: now,
      seq: this.seqCounter,
      attempts: 0,
      maxRetries: Math.max(1, input.maxRetries ?? this.defaultMaxRetries),
      status: 'PENDING',
      dependsOn: input.dependsOn,
      entityKey: input.entityKey,
    };

    this.items.set(id, { ...entry });

    // Store runtime rollback handler in-memory only
    if (typeof input.rollbackState === 'function') {
      this.rollbackCallbacks.set(id, input.rollbackState);
    }

    // Persist cleanly to IndexedDB
    void this.persistItem(entry);

    return { ...entry };
  }

  private getOrderedPending(): QueuedMutation<TPayload>[] {
    return Array.from(this.items.values())
      .filter((item) => item.status === 'PENDING')
      .sort((a, b) => {
        if (a.orderKey !== b.orderKey) return a.orderKey - b.orderKey;
        if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
        return a.seq - b.seq;
      });
  }

  /**
   * Dispatches the `mutation:rollback` notification event to the window / global target.
   */
  private dispatchRollbackEvent(detail: MutationRollbackEventDetail): void {
    const target: any =
      typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
          ? globalThis
          : null;

    if (target && typeof target.dispatchEvent === 'function') {
      try {
        const CustomEventCtor =
          typeof CustomEvent !== 'undefined'
            ? CustomEvent
            : target.CustomEvent;

        if (typeof CustomEventCtor === 'function') {
          const event = new CustomEventCtor(MUTATION_ROLLBACK_EVENT, {
            detail,
            bubbles: true,
            cancelable: false,
          });
          target.dispatchEvent(event);
        } else {
          // Fallback event object if CustomEvent constructor is absent
          target.dispatchEvent({
            type: MUTATION_ROLLBACK_EVENT,
            detail,
          });
        }
      } catch (evtErr) {
        console.error('[OfflineMutationQueue] Error dispatching rollback event:', evtErr);
      }
    }
  }

  /**
   * Executes rollback and journal cleanup for a rejected mutation and any downstream dependent mutations.
   *
   * CHAINED MUTATIONS STRATEGY:
   * When Mutation 1 is rejected with 409/422:
   * 1. We execute Mutation 1's pre-mutation snapshot rollback callback.
   * 2. Any downstream mutations that explicitly depend on Mutation 1 (via `dependsOn === item.id`),
   *    or sequentially mutate the exact same `entityKey`, are also invalidated and rolled back in reverse
   *    order so they do not attempt to execute on an invalid base state.
   * 3. Completely unrelated mutations (different entityKey or independent) are preserved untouched.
   */
  private async handleRollbackAndCleanup(
    failedItem: QueuedMutation<TPayload>,
    status: number,
    reason: string
  ): Promise<string[]> {
    const affectedIds: string[] = [];

    // Find any direct or transitive dependent mutations currently queued
    const dependents: QueuedMutation<TPayload>[] = [];
    for (const other of this.items.values()) {
      if (other.id === failedItem.id) continue;
      const isDirectChild = other.dependsOn === failedItem.id;
      const isSameEntitySuccessor =
        failedItem.entityKey &&
        other.entityKey === failedItem.entityKey &&
        other.seq > failedItem.seq;

      if (isDirectChild || isSameEntitySuccessor) {
        dependents.push(other);
      }
    }

    // Sort dependents descending by sequence so rollbacks unwind in reverse chronological order
    dependents.sort((a, b) => b.seq - a.seq);

    // Rollback dependents first (if any have registered callbacks)
    for (const dep of dependents) {
      let depRollbackOk = true;
      const depCb = this.rollbackCallbacks.get(dep.id);
      if (depCb) {
        try {
          depCb();
        } catch (cbErr) {
          depRollbackOk = false;
          console.error(`[OfflineMutationQueue] Chained rollback failed for mutation ${dep.id}:`, cbErr);
        }
      }

      this.rollbackCallbacks.delete(dep.id);
      this.items.delete(dep.id);
      await this.deleteFromDb(dep.id);
      affectedIds.push(dep.id);

      this.dispatchRollbackEvent({
        mutationId: dep.id,
        mutationType: dep.type,
        status,
        reason: `Cascaded rollback: parent mutation ${failedItem.id} failed with ${status}`,
        rollbackSucceeded: depRollbackOk,
        cascade: true,
      });
    }

    // Now roll back the root rejected mutation
    let rootRollbackOk = true;
    const rootCb = this.rollbackCallbacks.get(failedItem.id);
    if (rootCb) {
      try {
        rootCb();
      } catch (cbErr) {
        rootRollbackOk = false;
        console.error(`[OfflineMutationQueue] Rollback callback failed for mutation ${failedItem.id}:`, cbErr);
      }
    }

    this.rollbackCallbacks.delete(failedItem.id);
    this.items.delete(failedItem.id);
    await this.deleteFromDb(failedItem.id);
    affectedIds.push(failedItem.id);

    this.dispatchRollbackEvent({
      mutationId: failedItem.id,
      mutationType: failedItem.type,
      status,
      reason,
      rollbackSucceeded: rootRollbackOk,
      cascade: false,
    });

    return affectedIds;
  }

  /**
   * Replays pending queued mutations through the provided executor in causal/FIFO order.
   */
  async drain(executor: MutationExecutor<TPayload>): Promise<DrainSummary> {
    const succeeded: string[] = [];
    const requeued: string[] = [];
    const failed: string[] = [];
    const rolledBack: string[] = [];

    const pendingBatch = this.getOrderedPending();

    for (const item of pendingBatch) {
      const current = this.items.get(item.id);
      if (!current || current.status !== 'PENDING') continue;

      current.status = 'IN_FLIGHT';
      this.items.set(current.id, current);

      try {
        await executor({ ...current });
        // Succeeded: remove from in-memory items and persistent journal
        this.items.delete(current.id);
        this.rollbackCallbacks.delete(current.id);
        await this.deleteFromDb(current.id);
        succeeded.push(current.id);
      } catch (err) {
        const conflict = isConcurrencyRejection(err);

        // Fatal optimistic concurrency or unprocessable entity failure (409 / 422)
        if (conflict.isConflict) {
          const removed = await this.handleRollbackAndCleanup(current, conflict.status, conflict.reason);
          rolledBack.push(...removed);
          failed.push(current.id);
          continue;
        }

        const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
        current.attempts += 1;
        current.lastError = message;

        if (isNonRetriableError(err) || current.attempts >= current.maxRetries) {
          current.status = 'FAILED';
          this.items.set(current.id, current);
          void this.persistItem(current);
          failed.push(current.id);
        } else {
          current.status = 'PENDING';
          this.items.set(current.id, current);
          void this.persistItem(current);
          requeued.push(current.id);
        }
      }
    }

    return { succeeded, requeued, failed, rolledBack };
  }

  retryFailed(id?: string): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.status !== 'FAILED') continue;
      if (id && item.id !== id) continue;
      item.status = 'PENDING';
      item.attempts = 0;
      delete item.lastError;
      this.items.set(item.id, item);
      void this.persistItem(item);
      count += 1;
    }
    return count;
  }

  discard(id: string): boolean {
    this.rollbackCallbacks.delete(id);
    void this.deleteFromDb(id);
    return this.items.delete(id);
  }

  getSnapshot(): QueueSnapshot<TPayload> {
    const all = Array.from(this.items.values()).sort((a, b) => a.seq - b.seq);
    let pendingCount = 0;
    let failedCount = 0;
    for (const item of all) {
      if (item.status === 'PENDING' || item.status === 'IN_FLIGHT') pendingCount += 1;
      if (item.status === 'FAILED') failedCount += 1;
    }
    return {
      pendingCount,
      failedCount,
      items: all.map((x) => ({ ...x })),
    };
  }

  /**
   * Helper to clear entire queue and wipe IndexedDB store (useful in tests).
   */
  async clear(): Promise<void> {
    this.items.clear();
    this.rollbackCallbacks.clear();
    const db = await this.getDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }

  }
}

