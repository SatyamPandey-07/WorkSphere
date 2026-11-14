import * as Y from "yjs";
import { compressYjsUpdate } from "./yjsCompression";

export interface JournalEntry {
  id?: number;
  roomId: string;
  timestamp: number;
  payload: Uint8Array;
}

export interface CanvasProviderOptions {
  dbName?: string;
  storeName?: string;
  maxReplayBufferBytes?: number;
  compactionThreshold?: number;
  openDatabase?: (name: string) => Promise<IDBDatabase>;
}

const DEFAULT_DB_NAME = "worksphere-canvas-journal";
const DEFAULT_STORE_NAME = "changeJournal";
const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024; // 16 MB hard cap
const DEFAULT_COMPACTION_THRESHOLD = 32;

function defaultOpenDatabase(
  dbName: string,
  storeName: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new DOMException("Failed to open IndexedDB", "UnknownError"),
      );
  });
}

/**
 * IndexedDB-backed CRDT change-journal provider for collaborative whiteboards.
 * Compacts binary Yjs updates prior to persistence and guarantees explicit buffer
 * reference release inside `finally` blocks when write transactions abort or fail.
 */
export class CanvasJournalProvider {
  private readonly roomId: string;
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly maxReplayBufferBytes: number;
  private readonly compactionThreshold: number;
  private readonly openDatabaseFn: (name: string) => Promise<IDBDatabase>;

  private db: IDBDatabase | null = null;
  private replayBuffer: Uint8Array[] = [];
  private replayBufferBytes = 0;
  private inflightPromises = new Set<Promise<void>>();
  private destroyed = false;

  constructor(roomId: string, options: CanvasProviderOptions = {}) {
    this.roomId = roomId;
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
    this.maxReplayBufferBytes =
      options.maxReplayBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.compactionThreshold =
      options.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
    this.openDatabaseFn =
      options.openDatabase ??
      ((name) => defaultOpenDatabase(name, this.storeName));
  }

  get pendingUpdateCount(): number {
    return this.replayBuffer.length;
  }

  get pendingBytes(): number {
    return this.replayBufferBytes;
  }

  get activeTransactionCount(): number {
    return this.inflightPromises.size;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (this.destroyed) {
      throw new DOMException(
        "CanvasJournalProvider has been destroyed",
        "AbortError",
      );
    }
    if (!this.db) {
      this.db = await this.openDatabaseFn(this.dbName);
    }
    return this.db;
  }

  /**
   * Queues a binary CRDT update into the replay buffer, compacting updates
   * when the queue grows beyond `compactionThreshold` or `maxReplayBufferBytes`.
   */
  enqueueUpdate(update: Uint8Array): void {
    if (this.destroyed || !update || update.byteLength === 0) return;

    this.replayBuffer.push(update);
    this.replayBufferBytes += update.byteLength;

    if (
      this.replayBuffer.length >= this.compactionThreshold ||
      this.replayBufferBytes > this.maxReplayBufferBytes
    ) {
      this.compactReplayBuffer();
    }
  }

  /**
   * Merges buffered Yjs updates into a single compacted binary delta and drops
   * references to intermediate Uint8Arrays so they can be reclaimed immediately.
   */
  compactReplayBuffer(): Uint8Array | null {
    if (this.replayBuffer.length === 0) return null;

    let batch: Uint8Array[] | null = this.replayBuffer.splice(
      0,
      this.replayBuffer.length,
    );
    this.replayBufferBytes = 0;

    try {
      const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
      const compacted = compressYjsUpdate(merged);
      this.replayBuffer.push(compacted);
      this.replayBufferBytes = compacted.byteLength;
      return compacted;
    } finally {
      if (batch) {
        for (let i = 0; i < batch.length; i++) {
          batch[i] = null as unknown as Uint8Array;
        }
        batch.length = 0;
        batch = null;
      }
    }
  }

  /**
   * Commits buffered binary updates to IndexedDB in a single compacted payload.
   * Explicitly nulls out buffer and transaction handler references in `finally`
   * so aborted/errored transactions never retain Uint8Arrays in heap memory.
   */
  async flushJournal(): Promise<void> {
    if (this.destroyed || this.replayBuffer.length === 0) return;

    const compacted = this.compactReplayBuffer();
    if (!compacted) return;

    // Transfer ownership of the compacted buffer out of the replay queue for this commit
    let payloadToCommit: Uint8Array | null =
      this.replayBuffer.shift() ?? compacted;
    this.replayBufferBytes = 0;

    const commitPromise = (async () => {
      let tx: IDBTransaction | null = null;
      let store: IDBObjectStore | null = null;
      let req: IDBRequest | null = null;

      try {
        const db = await this.getDb();

        await new Promise<void>((resolve, reject) => {
          tx = db.transaction(this.storeName, "readwrite");
          store = tx.objectStore(this.storeName);

          const detachHandlers = () => {
            if (tx) {
              tx.oncomplete = null;
              tx.onabort = null;
              tx.onerror = null;
            }
            if (req) {
              req.onsuccess = null;
              req.onerror = null;
            }
          };

          tx.oncomplete = () => {
            detachHandlers();
            resolve();
          };

          tx.onabort = () => {
            const err =
              tx?.error ??
              new DOMException(
                "IndexedDB write transaction aborted",
                "AbortError",
              );
            detachHandlers();
            reject(err);
          };

          tx.onerror = () => {
            const err =
              tx?.error ??
              new DOMException(
                "IndexedDB write transaction error",
                "UnknownError",
              );
            detachHandlers();
            reject(err);
          };

          req = store.put({
            roomId: this.roomId,
            timestamp: Date.now(),
            payload: payloadToCommit!,
          });

          req.onerror = () => {
            // Let tx.onerror / tx.onabort reject cleanly without duplicate unhandled rejections
          };
        });
      } finally {
        // Explicit reference release so GC can reclaim detached/uncommitted ArrayBuffers
        payloadToCommit = null;
        req = null;
        store = null;
        tx = null;
      }
    })();

    this.inflightPromises.add(commitPromise);
    try {
      await commitPromise;
    } finally {
      this.inflightPromises.delete(commitPromise);
    }
  }

  /**
   * Releases all queued binary buffers and closes the database connection.
   */
  destroy(): void {
    this.destroyed = true;
    for (let i = 0; i < this.replayBuffer.length; i++) {
      this.replayBuffer[i] = null as unknown as Uint8Array;
    }
    this.replayBuffer.length = 0;
    this.replayBufferBytes = 0;
    this.inflightPromises.clear();

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
