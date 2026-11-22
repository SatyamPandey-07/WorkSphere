/**
 * OfflineMutationQueue.ts
 *
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
