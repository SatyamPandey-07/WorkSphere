/**
 * OfflineMutationQueue.ts
 *
 * Implements a unified, resilient client-side and server-side offline mutation engine:
 * 1. Background SyncManager API retry loop with full and decorrelated jitter backoff (#9618).
 * 2. Causal dependency buffering and vector clock monotonicity engine to prevent vector clock forks (#9636).
 * 3. Graceful fallback to `window.online` and `visibilitychange` listeners on iOS Safari.
 */

import {
  calculateFullJitterBackoff,
  calculateDecorrelatedJitterBackoff,
} from "@/lib/utils/backoff";
import {
  openDatabaseWithMigration,
  assertConnectionUsable,
} from "@/lib/offline/migrationCoordinator";

export const DEFAULT_SYNC_TAG = "sync-offline-mutations";
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;
export const DEFAULT_DECORRELATED_FACTOR = 3;

/** Minimum number of mutations in a batch or minimum payload bytes before compression is considered (#9728). */
export const COMPRESSION_MIN_MUTATION_COUNT = 5;
export const COMPRESSION_MIN_BYTES = 256;

/**
 * Checks whether native CompressionStream (gzip) or Node zlib is supported in current environment.
 */
export function isCompressionStreamSupported(): boolean {
  if (
    typeof CompressionStream !== "undefined" ||
    (typeof globalThis !== "undefined" && typeof (globalThis as any).CompressionStream !== "undefined")
  ) {
    return true;
  }
  // Node / test environment fallback
  try {
    if (typeof require !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const zlib = require("node:zlib") || require("zlib");
      return typeof zlib?.gzipSync === "function";
    }
  } catch {}
  return false;
}

/**
 * Compresses an input string or Uint8Array using browser native CompressionStream (gzip),
 * with graceful fallback to node:zlib in Node/Jest test environments.
 * Returns null if compression is unsupported or fails.
 */
export async function compressPayloadGzip(
  data: string | Uint8Array,
): Promise<Uint8Array | null> {
  const rawBytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;

  const CS =
    typeof CompressionStream !== "undefined"
      ? CompressionStream
      : typeof globalThis !== "undefined"
        ? (globalThis as any).CompressionStream
        : undefined;

  if (typeof CS === "function") {
    try {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(rawBytes);
          controller.close();
        },
      });

      const compressedStream = stream.pipeThrough(new CS("gzip"));
      const reader = compressedStream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.length;
        }
      }

      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    } catch (err) {
      console.warn("[OfflineMutationQueue] Native CompressionStream failed, attempting fallback:", err);
    }
  }

  // Node/Jest test environment fallback via node:zlib
  try {
    if (typeof require !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const zlib = require("node:zlib") || require("zlib");
      if (typeof zlib.gzipSync === "function") {
        return new Uint8Array(zlib.gzipSync(Buffer.from(rawBytes)));
      }
    }
  } catch (err) {
    console.warn("[OfflineMutationQueue] zlib fallback failed:", err);
  }

  return null;
}

/**
 * Evaluates whether a payload or batch is eligible for gzip compression.
 * Must have > 5 mutations (or >= minBytes) and compression must not increase payload size.
 */
export function isCompressionEligible(
  mutationCount: number,
  originalByteLength: number,
  compressedByteLength?: number,
): boolean {
  if (
    mutationCount <= COMPRESSION_MIN_MUTATION_COUNT &&
    originalByteLength < COMPRESSION_MIN_BYTES
  ) {
    return false;
  }
  if (
    compressedByteLength !== undefined &&
    compressedByteLength >= originalByteLength
  ) {
    return false;
  }
  return true;
}

export type HttpMethod = "POST" | "PUT" | "PATCH" | "DELETE";
export type MutationStatus =
  | "PENDING"
  | "SYNCING"
  | "COMPLETED"
  | "FAILED"
  | "APPLIED"
  | "BUFFERED"
  | "DUPLICATE"
  | "REJECTED";

export interface OfflineMutation<T = unknown> {
  id: string;
  tag?: string;
  endpoint?: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  payload: T;
  timestamp?: number;
  retryCount?: number;
  lastAttemptAt?: number;
  status?: MutationStatus;
  lastError?: string;
  idempotencyKey?: string;
  clientId?: string;
  vectorClock?: Record<string, number>;
  parentClock?: Record<string, number>;
  metadata?: Record<string, unknown>;
}

export interface MutationEnqueueResult<TPayload = unknown> {
  status: MutationStatus;
  mutationId: string;
  appliedMutations: OfflineMutation<TPayload>[];
  bufferedCount: number;
  currentClock: Record<string, number>;
  reason?: string;
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
export const OFFLINE_MUTATIONS_DB_VERSION = 2;
export const OFFLINE_MUTATIONS_STORE_NAME = "offline_mutations";

/**
 * Persistent IndexedDB storage for offline mutations.
 * Uses the coordinated migration pipeline when IndexedDB is present, and
 * falls back to InMemoryMutationStorage only when IndexedDB is unavailable.
 */
export class IndexedDBMutationStorage implements OfflineMutationStorage {
  private inMemoryFallback = new InMemoryMutationStorage();

  private async getDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return null;
    const db = await openDatabaseWithMigration(OFFLINE_MUTATIONS_DB_NAME, {
      context: "page",
      targetVersion: OFFLINE_MUTATIONS_DB_VERSION,
    });
    assertConnectionUsable(OFFLINE_MUTATIONS_DB_NAME, db);
    return db;
  }

  async getItem(id: string): Promise<OfflineMutation | undefined> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.getItem(id);
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readonly");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async getAll(): Promise<OfflineMutation[]> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.getAll();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readonly");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async saveItem(mutation: OfflineMutation): Promise<void> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.saveItem(mutation);
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readwrite");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        store.put(mutation);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error || new DOMException("Transaction aborted", "AbortError"));
      } catch (err) {
        reject(err);
      }
    });
  }

  async removeItem(id: string): Promise<void> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.removeItem(id);
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readwrite");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error || new DOMException("Transaction aborted", "AbortError"));
      } catch (err) {
        reject(err);
      }
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    if (!db) return this.inMemoryFallback.clear();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(OFFLINE_MUTATIONS_STORE_NAME, "readwrite");
        const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error || new DOMException("Transaction aborted", "AbortError"));
      } catch (err) {
        reject(err);
      }
    });
  }
}

export interface OfflineMutationQueueConfig {
  nodeId?: string;
  initialClock?: Record<string, number>;
  maxBufferSize?: number;
}

export interface OfflineMutationQueueOptions extends OfflineMutationQueueConfig {
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

export class OfflineMutationQueue<TPayload = unknown> {
  // Background Sync Properties
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

  // Causal Monotonic Vector Clock Properties
  private readonly nodeId: string;
  private localClock: Record<string, number> = {};
  private pendingPool: Map<string, OfflineMutation<TPayload>> = new Map();
  private appliedIds: Set<string> = new Set();
  private appliedHistory: OfflineMutation<TPayload>[] = [];
  private readonly maxBufferSize: number;

  private onApplyCallback?: (mutation: OfflineMutation<TPayload>) => void;
  private onBufferCallback?: (mutation: OfflineMutation<TPayload>) => void;

  constructor(options: OfflineMutationQueueOptions = {}) {
    // 1. Background sync options
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
    if (typeof window !== "undefined") {
      this.usingFallback = !this.isBackgroundSyncSupported();
      if (this.usingFallback) {
        this.setupFallbackListeners();
      }
    }

    // 2. Causal vector clock options
    this.nodeId = options.nodeId || "server";
    this.maxBufferSize = options.maxBufferSize || 5000;

    if (options.initialClock) {
      for (const [node, counter] of Object.entries(options.initialClock)) {
        this.validateCounter(node, counter, "initialClock");
        this.localClock[node] = counter;
      }
    }

    if (this.localClock[this.nodeId] === undefined) {
      this.localClock[this.nodeId] = 0;
    }
  }

  // --- Clock & State Access (Causal Sync) ---

  public getNodeId(): string {
    return this.nodeId;
  }

  public getLocalClock(): Record<string, number> {
    return { ...this.localClock };
  }

  public getPendingCount(): number {
    return this.pendingPool.size;
  }

  public getPendingMutations(): any {
    if (this.pendingPool.size > 0) {
      return Array.from(this.pendingPool.values());
    }
    return this.storage
      .getAll()
      .then((items) => items.filter((i) => i.status === "PENDING"));
  }

  public async getQueue(): Promise<OfflineMutation[]> {
    return this.storage.getAll();
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

  // --- Background Sync Registration & Capabilities ---

  public isBackgroundSyncSupported(): boolean {
    if (typeof window === "undefined" && typeof globalThis === "undefined") {
      return false;
    }
    const globalScope =
      typeof window !== "undefined" ? window : (globalThis as any);
    return "SyncManager" in globalScope;
  }

  public isUsingFallback(): boolean {
    return this.usingFallback;
  }

  public async registerBackgroundSync(tag?: string): Promise<boolean> {
    const targetTag = tag ?? this.syncTag;
    if (this.isBackgroundSyncSupported()) {
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          if (registration && "sync" in registration) {
            await (registration as any).sync.register(targetTag);
            this.usingFallback = false;
            return true;
          }
        }
      } catch (err) {
        console.warn(
          `[OfflineMutationQueue] Failed to register sync tag "${targetTag}":`,
          err,
        );
      }
    }

    this.usingFallback = true;
    this.setupFallbackListeners();
    return false;
  }

  private setupFallbackListeners(): void {
    if (this.fallbackListenersAttached || typeof window === "undefined") {
      return;
    }

    const onlineHandler = () => {
      this.flush({ reason: "reconnection" }).catch((err) =>
        console.warn(
          "[OfflineMutationQueue] Fallback online flush error:",
          err,
        ),
      );
    };

    const visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        this.flush({ reason: "visibility" }).catch((err) =>
          console.warn(
            "[OfflineMutationQueue] Fallback visibility flush error:",
            err,
          ),
        );
      }
    };

    window.addEventListener("online", onlineHandler);
    document.addEventListener("visibilitychange", visibilityHandler);

    this.fallbackListenersAttached = true;
    this.cleanupFallback = () => {
      window.removeEventListener("online", onlineHandler);
      document.removeEventListener("visibilitychange", visibilityHandler);
      this.fallbackListenersAttached = false;
    };
  }

  public destroy(): void {
    if (this.cleanupFallback) {
      this.cleanupFallback();
      this.cleanupFallback = undefined;
    }
  }

  public calculate5xxDecorrelatedJitter(): number {
    const delay = calculateDecorrelatedJitterBackoff(this.current5xxDelay, {
      baseDelay: this.baseDelayMs,
      maxDelay: this.maxDelayMs,
      factor: this.decorrelatedFactor,
    });
    this.current5xxDelay = delay;
    return delay;
  }

  public calculateReconnectionJitter(attempt = 1): number {
    return calculateFullJitterBackoff(attempt, {
      baseDelay: this.baseDelayMs,
      maxDelay: this.maxDelayMs,
    });
  }

  public reset5xxDelay(): void {
    this.current5xxDelay = this.baseDelayMs;
  }

  public getCurrent5xxDelay(): number {
    return this.current5xxDelay;
  }

  public async enqueueBooking<T = unknown>(
    bookingPayload: T,
    options: {
      endpoint?: string;
      method?: HttpMethod;
      headers?: Record<string, string>;
      idempotencyKey?: string;
    } = {},
  ): Promise<OfflineMutation<T>> {
    return this.enqueue({
      endpoint: options.endpoint ?? "/api/bookings",
      method: options.method ?? "POST",
      payload: bookingPayload,
      headers: options.headers,
      idempotencyKey: options.idempotencyKey,
    }) as any;
  }

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
          let bodyPayload: BodyInit | undefined =
            mutation.method !== "DELETE" && mutation.payload !== undefined
              ? typeof mutation.payload === "string"
                ? mutation.payload
                : JSON.stringify(mutation.payload)
              : undefined;

          // Compression support (#9728):
          // Check if payload is eligible for compression (count > 5 if batch, or payload bytes >= minBytes)
          if (typeof bodyPayload === "string" && bodyPayload.length > 0) {
            const rawBytes = new TextEncoder().encode(bodyPayload);
            const mutationCount =
              Array.isArray((mutation.payload as any)?.mutations)
                ? (mutation.payload as any).mutations.length
                : 1;

            if (isCompressionEligible(mutationCount, rawBytes.length)) {
              const compressed = await compressPayloadGzip(rawBytes);
              if (
                compressed &&
                isCompressionEligible(mutationCount, rawBytes.length, compressed.length)
              ) {
                bodyPayload = compressed;
                headers["Content-Encoding"] = "gzip";
              }
            }
          }

          const response = await this.fetchFn(mutation.endpoint || "", {
            method: mutation.method || "POST",
            headers,
            body: bodyPayload,
          });

          if (response.ok) {
            mutation.status = "COMPLETED";
            await this.storage.removeItem(mutation.id);
            this.reset5xxDelay();
            succeeded++;
            this.onMutationSuccess?.(mutation);
            continue;
          }

          if (response.status >= 500 && response.status < 600) {
            mutation.retryCount = (mutation.retryCount || 0) + 1;
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

            if (backoffMs > 0 && !options.skipDelay) {
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
            continue;
          }

          mutation.retryCount = (mutation.retryCount || 0) + 1;
          mutation.status = "FAILED";
          mutation.lastError = `HTTP ${response.status}: Client Error`;
          await this.storage.saveItem(mutation);
          failed++;
          this.onMutationFailure?.(mutation, new Error(mutation.lastError));
        } catch (networkError: any) {
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

  // --- Dynamic Enqueue (Handles both Background Sync and Causal Sync) ---

  public enqueue(input: any): any {
    // 1. If background sync input (has endpoint/method or lacks vectorClock)
    if (input.endpoint || input.method || !input.vectorClock) {
      const id =
        input.id ||
        (typeof crypto !== "undefined" && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `mutation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

      const mutation: OfflineMutation = {
        id,
        tag: input.tag ?? this.syncTag,
        endpoint: input.endpoint || "/api/bookings",
        method: input.method || "POST",
        headers: input.headers,
        payload: input.payload,
        timestamp: input.timestamp ?? Date.now(),
        retryCount: input.retryCount ?? 0,
        status: input.status ?? "PENDING",
        idempotencyKey: input.idempotencyKey ?? id,
      };

      return (async () => {
        await this.storage.saveItem(mutation as OfflineMutation);
        await this.registerBackgroundSync(mutation.tag);
        if (
          this.autoFlush &&
          typeof navigator !== "undefined" &&
          navigator.onLine &&
          this.usingFallback
        ) {
          void this.flush({ reason: "immediate" });
        }
        return mutation;
      })();
    }

    // 2. Causal Monotonic Vector Clock Enqueue
    const mutation = input as OfflineMutation<TPayload>;
    this.validateMutation(mutation);

    // Idempotency Check
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

    const client = mutation.clientId!;
    const clientCounter = mutation.vectorClock?.[client] || 0;
    const currentLocalCounter = this.localClock[client] || 0;

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

    // Evaluate Causal Readiness
    if (!this.canApply(mutation)) {
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

    // Apply Ready Mutation & Cascade
    const applied: OfflineMutation<TPayload>[] = [];

    this.applyMutationDirectly(mutation);
    applied.push(mutation);

    let progress = true;
    while (progress) {
      progress = false;

      for (const [id, orphan] of Array.from(this.pendingPool.entries())) {
        if (this.canApply(orphan)) {
          this.pendingPool.delete(id);
          this.applyMutationDirectly(orphan);
          applied.push(orphan);
          progress = true;
          break;
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

  public enqueueBatch(
    mutations: OfflineMutation<TPayload>[],
  ): MutationEnqueueResult<TPayload>[] {
    return mutations.map((m) => this.enqueue(m));
  }

  public canApply(mutation: OfflineMutation<TPayload>): boolean {
    const client = mutation.clientId!;
    const clientClock = mutation.vectorClock?.[client] || 0;
    const localClientClock = this.localClock[client] || 0;

    if (clientClock !== localClientClock + 1) {
      return false;
    }

    if (mutation.parentClock) {
      for (const [node, parentVal] of Object.entries(mutation.parentClock)) {
        const localVal = this.localClock[node] || 0;
        if (parentVal > localVal) {
          return false;
        }
      }
    }

    if (mutation.vectorClock) {
      for (const [node, counter] of Object.entries(mutation.vectorClock)) {
        if (node === client) continue;
        const localVal = this.localClock[node] || 0;
        if (counter > localVal) {
          return false;
        }
      }
    }

    return true;
  }

  private applyMutationDirectly(mutation: OfflineMutation<TPayload>): void {
    const client = mutation.clientId!;

    this.localClock[client] = mutation.vectorClock![client];

    if (mutation.vectorClock) {
      for (const [node, counter] of Object.entries(mutation.vectorClock)) {
        if (
          this.localClock[node] === undefined ||
          counter > this.localClock[node]
        ) {
          this.localClock[node] = counter;
        }
      }
    }

    this.appliedIds.add(mutation.id);
    this.appliedHistory.push(mutation);
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

  public clear(): void {
    this.pendingPool.clear();
    this.appliedIds.clear();
    this.appliedHistory = [];
    this.localClock = { [this.nodeId]: 0 };
    this.storage.clear().catch(() => {});
    this.reset5xxDelay();
  }
}

export const offlineMutationQueue = new OfflineMutationQueue();
