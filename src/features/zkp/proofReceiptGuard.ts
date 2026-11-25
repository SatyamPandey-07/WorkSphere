export type ProofReceiptStatus =
  | 'valid'
  | 'expired'
  | 'replayed_nullifier'
  | 'not_found';

export interface ProofReceipt {
  proofHash: string;
  nullifier: string;
  verifiedAtMs: number;
  expiresAtMs: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ProofReceiptCheckResult {
  status: ProofReceiptStatus;
  allowed: boolean;
  receipt?: ProofReceipt;
  reason?: string;
}

export interface ConsumedNullifierRecord {
  nullifier: string;
  consumedAtMs: number;
  expiresAtMs: number;
}

export interface ProofReceiptHydrationResult {
  hydratedReceipts: number;
  hydratedNullifiers: number;
  prunedExpired: number;
  persistenceActive: boolean;
}

export interface ProofReceiptGuardOptions {
  defaultTtlMs?: number;
  maxEntries?: number;
  singleUseNullifiers?: boolean;
  nowFn?: () => number;
  /** Enable IndexedDB persistence when available (defaults to true). */
  persist?: boolean;
  /** Custom IndexedDB database name (useful for isolated tests or namespaces). */
  dbName?: string;
  /** Automatically hydrate persisted state from IndexedDB on construction (defaults to true). */
  autoHydrate?: boolean;
}

export const DEFAULT_PROOF_RECEIPT_DB_NAME = 'WorkSphereZkpProofReceiptDB';
export const PROOF_RECEIPT_DB_VERSION = 1;
export const RECEIPTS_STORE_NAME = 'receipts';
export const NULLIFIERS_STORE_NAME = 'consumed_nullifiers';

function cloneReceipt(r: ProofReceipt): ProofReceipt {
  return {
    proofHash: r.proofHash,
    nullifier: r.nullifier,
    verifiedAtMs: r.verifiedAtMs,
    expiresAtMs: r.expiresAtMs,
    metadata: r.metadata ? { ...r.metadata } : undefined,
  };
}

function getIndexedDbFactory(): IDBFactory | null {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB !== null) {
      return indexedDB;
    }
  } catch {
    // Accessing indexedDB in restricted environments can throw SecurityError
  }
  return null;
}

export class ProofReceiptGuard {
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private readonly singleUseNullifiers: boolean;
  private readonly nowFn: () => number;
  private readonly persist: boolean;
  private readonly dbName: string;

  private readonly receiptsByHash = new Map<string, ProofReceipt>();
  private readonly consumedNullifiers = new Map<string, ConsumedNullifierRecord>();

  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private dbInstance: IDBDatabase | null = null;
  private initialHydrationPromise: Promise<ProofReceiptHydrationResult> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private mutationGeneration = 0;
  private readonly dirtyReceiptHashes = new Set<string>();
  private readonly deletedReceiptHashes = new Set<string>();
  private readonly dirtyNullifiers = new Set<string>();

  constructor(options: ProofReceiptGuardOptions = {}) {
    this.defaultTtlMs =
      typeof options.defaultTtlMs === 'number' &&
      Number.isFinite(options.defaultTtlMs) &&
      options.defaultTtlMs > 0
        ? Math.floor(options.defaultTtlMs)
        : 300_000;
    this.maxEntries =
      typeof options.maxEntries === 'number' &&
      Number.isFinite(options.maxEntries) &&
      options.maxEntries > 0
        ? Math.floor(options.maxEntries)
        : 500;
    this.singleUseNullifiers = options.singleUseNullifiers ?? true;
    this.nowFn = options.nowFn ?? Date.now;
    this.persist = options.persist ?? true;
    this.dbName = options.dbName?.trim() || DEFAULT_PROOF_RECEIPT_DB_NAME;

    if ((options.autoHydrate ?? true) && this.isPersistenceEnabled()) {
      this.initialHydrationPromise = this.hydrate(this.nowFn()).catch(() => ({
        hydratedReceipts: 0,
        hydratedNullifiers: 0,
        prunedExpired: 0,
        persistenceActive: false,
      }));
    }
  }

  public isPersistenceEnabled(): boolean {
    return this.persist && getIndexedDbFactory() !== null;
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (!this.isPersistenceEnabled()) {
      return Promise.resolve(null);
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    const factory = getIndexedDbFactory();
    if (!factory) {
      return Promise.resolve(null);
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = factory.open(this.dbName, PROOF_RECEIPT_DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(RECEIPTS_STORE_NAME)) {
            const receiptsStore = db.createObjectStore(RECEIPTS_STORE_NAME, {
              keyPath: 'proofHash',
            });
            receiptsStore.createIndex('expiresAtMs', 'expiresAtMs', { unique: false });
          }
          if (!db.objectStoreNames.contains(NULLIFIERS_STORE_NAME)) {
            const nullifiersStore = db.createObjectStore(NULLIFIERS_STORE_NAME, {
              keyPath: 'nullifier',
            });
            nullifiersStore.createIndex('expiresAtMs', 'expiresAtMs', { unique: false });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          this.dbInstance = db;
          db.onversionchange = () => {
            db.close();
            if (this.dbInstance === db) {
              this.dbInstance = null;
              this.dbPromise = null;
            }
          };
          resolve(db);
        };

        request.onerror = () => {
          this.dbPromise = null;
          resolve(null);
        };

        request.onblocked = () => {
          resolve(null);
        };
      } catch {
        this.dbPromise = null;
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  private enqueueDbWork(work: (db: IDBDatabase) => Promise<void>): void {
    if (!this.isPersistenceEnabled()) return;

    this.writeQueue = this.writeQueue
      .then(async () => {
        if (this.initialHydrationPromise) {
          await this.initialHydrationPromise.catch(() => undefined);
        }
        const db = await this.openDb();
        if (!db) return;
        await work(db);
      })
      .catch(() => undefined);
  }

  private deleteReceiptFromDb(proofHash: string): void {
    this.enqueueDbWork(
      (db) =>
        new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(RECEIPTS_STORE_NAME, 'readwrite');
            tx.objectStore(RECEIPTS_STORE_NAME).delete(proofHash);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        })
    );
  }

  private deleteNullifierFromDb(nullifier: string): void {
    this.enqueueDbWork(
      (db) =>
        new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(NULLIFIERS_STORE_NAME, 'readwrite');
            tx.objectStore(NULLIFIERS_STORE_NAME).delete(nullifier);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        })
    );
  }

  public async ready(): Promise<ProofReceiptHydrationResult> {
    if (this.initialHydrationPromise) {
      return this.initialHydrationPromise;
    }
    return {
      hydratedReceipts: 0,
      hydratedNullifiers: 0,
      prunedExpired: 0,
      persistenceActive: this.isPersistenceEnabled(),
    };
  }

  public async flush(): Promise<void> {
    if (this.initialHydrationPromise) {
      await this.initialHydrationPromise.catch(() => undefined);
    }
    await this.writeQueue;
  }

  public async hydrate(nowMs = this.nowFn()): Promise<ProofReceiptHydrationResult> {
    const db = await this.openDb();
    if (!db) {
      return {
        hydratedReceipts: 0,
        hydratedNullifiers: 0,
        prunedExpired: 0,
        persistenceActive: false,
      };
    }

    const startGeneration = this.mutationGeneration;

    return new Promise<ProofReceiptHydrationResult>((resolve) => {
      try {
        const tx = db.transaction(
          [RECEIPTS_STORE_NAME, NULLIFIERS_STORE_NAME],
          'readwrite'
        );
        const receiptStore = tx.objectStore(RECEIPTS_STORE_NAME);
        const nullifierStore = tx.objectStore(NULLIFIERS_STORE_NAME);

        const receiptsReq = receiptStore.getAll();
        const nullifiersReq = nullifierStore.getAll();

        let persistedReceipts: ProofReceipt[] = [];
        let persistedNullifiers: ConsumedNullifierRecord[] = [];
        let prunedExpired = 0;
        let hydratedReceipts = 0;
        let hydratedNullifiers = 0;

        receiptsReq.onsuccess = () => {
          persistedReceipts = Array.isArray(receiptsReq.result)
            ? (receiptsReq.result as ProofReceipt[])
            : [];
          for (const receipt of persistedReceipts) {
            if (!receipt || typeof receipt.proofHash !== 'string' || this.isExpired(receipt, nowMs)) {
              if (receipt && typeof receipt.proofHash === 'string') {
                receiptStore.delete(receipt.proofHash);
                prunedExpired += 1;
              }
            }
          }
        };

        nullifiersReq.onsuccess = () => {
          persistedNullifiers = Array.isArray(nullifiersReq.result)
            ? (nullifiersReq.result as ConsumedNullifierRecord[])
            : [];
          for (const record of persistedNullifiers) {
            if (!record || typeof record.nullifier !== 'string' || nowMs >= record.expiresAtMs) {
              if (record && typeof record.nullifier === 'string') {
                nullifierStore.delete(record.nullifier);
                prunedExpired += 1;
              }
            }
          }
        };

        tx.oncomplete = () => {
          // If clear() was called while hydrating, skip merging stale entries
          const wasCleared = this.mutationGeneration !== startGeneration;

          if (!wasCleared) {
            // Hydrate unexpired receipts (oldest first so newest survive maxEntries eviction)
            const validReceipts = persistedReceipts
              .filter(
                (r) =>
                  r &&
                  typeof r.proofHash === 'string' &&
                  typeof r.nullifier === 'string' &&
                  !this.isExpired(r, nowMs)
              )
              .sort((a, b) => a.verifiedAtMs - b.verifiedAtMs);

            const hydratedMap = new Map<string, ProofReceipt>();
            for (const receipt of validReceipts) {
              if (
                this.dirtyReceiptHashes.has(receipt.proofHash) ||
                this.deletedReceiptHashes.has(receipt.proofHash)
              ) {
                continue;
              }
              if (!this.receiptsByHash.has(receipt.proofHash)) {
                hydratedMap.set(receipt.proofHash, cloneReceipt(receipt));
                hydratedReceipts += 1;
              }
            }

            // Preserve in-memory entries registered concurrently before hydration finished
            for (const [key, value] of this.receiptsByHash.entries()) {
              hydratedMap.delete(key);
              hydratedMap.set(key, value);
            }

            while (hydratedMap.size > this.maxEntries) {
              const oldest = hydratedMap.keys().next().value;
              if (oldest === undefined) break;
              hydratedMap.delete(oldest);
              if (!this.dirtyReceiptHashes.has(oldest)) {
                hydratedReceipts = Math.max(0, hydratedReceipts - 1);
              }
            }

            this.receiptsByHash.clear();
            for (const [key, value] of hydratedMap.entries()) {
              this.receiptsByHash.set(key, value);
            }

            // Hydrate unexpired consumed nullifiers
            for (const record of persistedNullifiers) {
              if (
                !record ||
                typeof record.nullifier !== 'string' ||
                nowMs >= record.expiresAtMs ||
                this.dirtyNullifiers.has(record.nullifier)
              ) {
                continue;
              }
              const existing = this.consumedNullifiers.get(record.nullifier);
              if (!existing || record.expiresAtMs > existing.expiresAtMs) {
                this.consumedNullifiers.set(record.nullifier, {
                  nullifier: record.nullifier,
                  consumedAtMs: record.consumedAtMs,
                  expiresAtMs: record.expiresAtMs,
                });
                hydratedNullifiers += 1;
              }
            }
          }

          resolve({
            hydratedReceipts,
            hydratedNullifiers,
            prunedExpired,
            persistenceActive: true,
          });
        };

        tx.onerror = () => {
          resolve({
            hydratedReceipts: 0,
            hydratedNullifiers: 0,
            prunedExpired: 0,
            persistenceActive: false,
          });
        };

        tx.onabort = () => {
          resolve({
            hydratedReceipts: 0,
            hydratedNullifiers: 0,
            prunedExpired: 0,
            persistenceActive: false,
          });
        };
      } catch {
        resolve({
          hydratedReceipts: 0,
          hydratedNullifiers: 0,
          prunedExpired: 0,
          persistenceActive: false,
        });
      }
    });
  }

  public isExpired(receipt: ProofReceipt, nowMs = this.nowFn()): boolean {
    return nowMs >= receipt.expiresAtMs;
  }

  public purgeExpired(nowMs = this.nowFn()): number {
    let purged = 0;
    const expiredReceiptKeys: string[] = [];
    const expiredNullifiers: string[] = [];

    for (const [key, receipt] of this.receiptsByHash.entries()) {
      if (this.isExpired(receipt, nowMs)) {
        this.receiptsByHash.delete(key);
        this.deletedReceiptHashes.add(key);
        expiredReceiptKeys.push(key);
        purged += 1;
      }
    }

    for (const [nullifier, record] of this.consumedNullifiers.entries()) {
      if (nowMs >= record.expiresAtMs) {
        this.consumedNullifiers.delete(nullifier);
        this.dirtyNullifiers.add(nullifier);
        expiredNullifiers.push(nullifier);
        purged += 1;
      }
    }

    if (expiredReceiptKeys.length > 0 || expiredNullifiers.length > 0) {
      this.enqueueDbWork(
        (db) =>
          new Promise<void>((resolve) => {
            try {
              const stores: string[] = [];
              if (expiredReceiptKeys.length > 0) stores.push(RECEIPTS_STORE_NAME);
              if (expiredNullifiers.length > 0) stores.push(NULLIFIERS_STORE_NAME);

              const tx = db.transaction(stores, 'readwrite');
              if (expiredReceiptKeys.length > 0) {
                const receiptStore = tx.objectStore(RECEIPTS_STORE_NAME);
                for (const key of expiredReceiptKeys) {
                  receiptStore.delete(key);
                }
              }
              if (expiredNullifiers.length > 0) {
                const nullifierStore = tx.objectStore(NULLIFIERS_STORE_NAME);
                for (const nullifier of expiredNullifiers) {
                  nullifierStore.delete(nullifier);
                }
              }

              tx.oncomplete = () => resolve();
              tx.onerror = () => resolve();
              tx.onabort = () => resolve();
            } catch {
              resolve();
            }
          })
      );
    }

    return purged;
  }

  public registerReceipt(
    input: {
      proofHash: string;
      nullifier: string;
      verifiedAtMs?: number;
      ttlMs?: number;
      expiresAtMs?: number;
      metadata?: Record<string, string | number | boolean>;
    },
    nowMs = this.nowFn()
  ): ProofReceipt {
    if (!input.proofHash) throw new Error('proofHash is required');
    if (!input.nullifier) throw new Error('nullifier is required');

    this.purgeExpired(nowMs);

    const verifiedAtMs =
      typeof input.verifiedAtMs === 'number' && Number.isFinite(input.verifiedAtMs)
        ? Math.floor(input.verifiedAtMs)
        : nowMs;
    const ttlMs =
      typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs) && input.ttlMs > 0
        ? Math.floor(input.ttlMs)
        : this.defaultTtlMs;
    const expiresAtMs =
      typeof input.expiresAtMs === 'number' && Number.isFinite(input.expiresAtMs)
        ? Math.floor(input.expiresAtMs)
        : verifiedAtMs + ttlMs;

    const stored: ProofReceipt = {
      proofHash: input.proofHash,
      nullifier: input.nullifier,
      verifiedAtMs,
      expiresAtMs,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };

    if (this.receiptsByHash.has(stored.proofHash)) {
      this.receiptsByHash.delete(stored.proofHash);
    }

    const evictedKeys: string[] = [];
    while (this.receiptsByHash.size >= this.maxEntries) {
      const oldest = this.receiptsByHash.keys().next().value;
      if (oldest === undefined) break;
      this.receiptsByHash.delete(oldest);
      this.deletedReceiptHashes.add(oldest);
      evictedKeys.push(oldest);
    }

    this.receiptsByHash.set(stored.proofHash, stored);
    this.dirtyReceiptHashes.add(stored.proofHash);
    this.deletedReceiptHashes.delete(stored.proofHash);

    const snapshot = cloneReceipt(stored);
    this.enqueueDbWork(
      (db) =>
        new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(RECEIPTS_STORE_NAME, 'readwrite');
            const store = tx.objectStore(RECEIPTS_STORE_NAME);
            for (const evicted of evictedKeys) {
              store.delete(evicted);
            }
            store.put(snapshot);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        })
    );

    return cloneReceipt(stored);
  }

  public lookup(proofHash: string, nowMs = this.nowFn()): ProofReceiptCheckResult {
    const existing = this.receiptsByHash.get(proofHash);
    if (!existing) {
      this.purgeExpired(nowMs);
      return {
        status: 'not_found',
        allowed: false,
        reason: 'No cached proof receipt found',
      };
    }

    if (this.isExpired(existing, nowMs)) {
      this.receiptsByHash.delete(proofHash);
      this.deletedReceiptHashes.add(proofHash);
      this.deleteReceiptFromDb(proofHash);
      this.purgeExpired(nowMs);
      return {
        status: 'expired',
        allowed: false,
        receipt: cloneReceipt(existing),
        reason: 'Proof receipt TTL has expired',
      };
    }

    this.purgeExpired(nowMs);

    if (this.singleUseNullifiers && this.hasConsumedNullifier(existing.nullifier, nowMs)) {
      return {
        status: 'replayed_nullifier',
        allowed: false,
        receipt: cloneReceipt(existing),
        reason: 'Nullifier has already been consumed',
      };
    }

    return {
      status: 'valid',
      allowed: true,
      receipt: cloneReceipt(existing),
    };
  }

  public consumeProof(
    proofHash: string,
    nowMs = this.nowFn()
  ): ProofReceiptCheckResult {
    const check = this.lookup(proofHash, nowMs);
    if (check.allowed && check.receipt && this.singleUseNullifiers) {
      const existingRecord = this.consumedNullifiers.get(check.receipt.nullifier);
      const record: ConsumedNullifierRecord = {
        nullifier: check.receipt.nullifier,
        consumedAtMs: nowMs,
        expiresAtMs: existingRecord
          ? Math.max(existingRecord.expiresAtMs, check.receipt.expiresAtMs)
          : check.receipt.expiresAtMs,
      };
      this.consumedNullifiers.set(record.nullifier, record);
      this.dirtyNullifiers.add(record.nullifier);

      this.enqueueDbWork(
        (db) =>
          new Promise<void>((resolve) => {
            try {
              const tx = db.transaction(NULLIFIERS_STORE_NAME, 'readwrite');
              tx.objectStore(NULLIFIERS_STORE_NAME).put({ ...record });
              tx.oncomplete = () => resolve();
              tx.onerror = () => resolve();
              tx.onabort = () => resolve();
            } catch {
              resolve();
            }
          })
      );
    }
    return check;
  }

  public hasConsumedNullifier(nullifier: string, nowMs = this.nowFn()): boolean {
    const record = this.consumedNullifiers.get(nullifier);
    if (!record) return false;
    if (nowMs >= record.expiresAtMs) {
      this.consumedNullifiers.delete(nullifier);
      this.dirtyNullifiers.add(nullifier);
      this.deleteNullifierFromDb(nullifier);
      return false;
    }
    return true;
  }

  public size(nowMs = this.nowFn()): number {
    this.purgeExpired(nowMs);
    return this.receiptsByHash.size;
  }

  public clear(): void {
    this.mutationGeneration += 1;
    this.receiptsByHash.clear();
    this.consumedNullifiers.clear();
    this.dirtyReceiptHashes.clear();
    this.deletedReceiptHashes.clear();
    this.dirtyNullifiers.clear();

    this.enqueueDbWork(
      (db) =>
        new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(
              [RECEIPTS_STORE_NAME, NULLIFIERS_STORE_NAME],
              'readwrite'
            );
            tx.objectStore(RECEIPTS_STORE_NAME).clear();
            tx.objectStore(NULLIFIERS_STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        })
    );
  }

  public close(): void {
    if (this.dbInstance) {
      this.dbInstance.close();
      this.dbInstance = null;
    }
    this.dbPromise = null;
  }
}
