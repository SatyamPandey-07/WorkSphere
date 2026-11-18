import * as Y from "yjs";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { redis } from "@/lib/redis";
import {
  base64ToBytes,
  bytesToBase64,
  isStateVectorBehind,
} from "./snapshotManager";
import { compressYjsUpdate } from "./yjsCompression";
import {
  CrdtFrameMessageType,
  CrdtFrameReassembler,
  encodeCrdtFrames,
} from "./dataChannelFraming";

/* ------------------------------------------------------------------------- *
 * IndexedDB change-journal provider (#7713)
 *
 * Compacts binary Yjs updates before persisting them and guarantees explicit
 * buffer reference release inside `finally` blocks when write transactions
 * abort or fail.
 * ------------------------------------------------------------------------- */

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

/* ------------------------------------------------------------------------- *
 * Offline change-journal replay buffer for decentralized canvas sync (#7528)
 * Differential snapshot pruning and state-vector compaction (#7741)
 * ------------------------------------------------------------------------- */

export const CANVAS_JOURNAL_DB = "worksphere-crdt-canvas-journal";
const JOURNAL_STORE = "journal";
const JOURNAL_META_STORE = "meta";
const SNAPSHOT_STORE = "snapshots";
const JOURNAL_DB_VERSION = 2;

/** Compact once a room holds more than this many raw journal records. */
export const DEFAULT_MAX_JOURNAL_RECORDS = 500;

/** Compact once a room's raw journal records exceed this many bytes (5 MB). */
export const DEFAULT_MAX_COMPACTION_BYTES = 5 * 1024 * 1024;

/** Sentinel transaction origin for updates that came from journal replay. */
export const JOURNAL_REPLAY_ORIGIN = "journal-replay";

/** Sentinel transaction origin for updates applied from a stored snapshot. */
export const SNAPSHOT_RECOVERY_ORIGIN = "snapshot-recovery";

/** Sentinel transaction origin for internal tombstone enforcement. */
export const TOMBSTONE_ENFORCEMENT_ORIGIN = "crdt-tombstone-enforcement";

/** A single durable, ordered change block queued while offline. */
export interface JournalBlock {
  seq: number;
  roomName: string;
  update: number[];
  checksum: string;
  createdAt: number;
}

/** A consolidated baseline for a room produced by journal compaction. */
export interface CanvasSnapshot {
  roomName: string;
  update: number[];
  stateVector: number[];
  checksum: string;
  opsAtSnapshot: number;
  createdAt: number;
}

/** Per-room bookkeeping kept across browser restarts. */
export interface CanvasJournalMeta {
  roomName: string;
  lastSeq: number;
  opsAtSnapshot?: number;
  compactedAt?: number;
}

/** Snapshot of the journal's on-disk footprint for a room. */
export interface CanvasJournalStats {
  roomName: string;
  recordCount: number;
  totalBytes: number;
  latestSeq: number;
  opsSinceSnapshot: number;
  hasSnapshot: boolean;
  snapshotChecksum: string | null;
  snapshotBytes: number;
}

/** Outcome of an atomic snapshot + prune transaction. */
export interface CanvasCompactionResult {
  snapshot: CanvasSnapshot;
  deletedRecords: number;
  reclaimedBytes: number;
}

/** Outcome of replaying a stored snapshot plus any surviving journal blocks. */
export interface JournalRestoreResult {
  restored: boolean;
  appliedBlocks: number;
  checksum: string;
  stateVector: number[];
}

/** Thrown when a snapshot fails checksum, state-vector or round-trip checks. */
export class CanvasSnapshotIntegrityError extends Error {
  constructor(message = "Canvas snapshot failed integrity verification") {
    super(message);
    this.name = "CanvasSnapshotIntegrityError";
  }
}

/** Outcome of a journal replay, including post-sync convergence state. */
export interface ReplayResult {
  replayed: number;
  checksum: string;
  converged: boolean | null;
}

export interface CanvasTransport {
  send(update: Uint8Array): void;
  isConnected(): boolean;
}

export interface CompactionConfig {
  maxOperations?: number;
  checkpointIntervalMs?: number;
  enableJournal?: boolean;
  journalDbName?: string;
  transport?: CanvasTransport;
  onReconnected?: (result: ReplayResult) => void;
  maxJournalRecords?: number;
  maxCompactionBytes?: number;
  enableAutoCompaction?: boolean;
  onCompacted?: (result: CanvasCompactionResult) => void;
  onCompactionError?: (error: unknown) => void;
}

interface CanvasJournalDB extends DBSchema {
  journal: {
    key: number;
    value: JournalBlock;
    indexes: { "by-room": string };
  };
  meta: {
    key: string;
    value: CanvasJournalMeta;
  };
  snapshots: {
    key: string;
    value: CanvasSnapshot;
  };
}

interface RedisCheckpointClient {
  get(key: string): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
}

interface IdleGlobal {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}

const SNAPSHOT_REDIS_KEY_PREFIX = "crdt:room:";

export function computeChecksum(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function stateVectorsEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  const leftClock = Y.decodeStateVector(left);
  const rightClock = Y.decodeStateVector(right);
  if (leftClock.size !== rightClock.size) return false;
  for (const [clientId, clock] of leftClock) {
    if ((rightClock.get(clientId) ?? 0) !== clock) return false;
  }
  return true;
}

function yieldToMainThread(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

const journalWriteQueues = new Map<string, Promise<void>>();

function withJournalWriteLock<T>(
  databaseName: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = journalWriteQueues.get(databaseName) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  journalWriteQueues.set(databaseName, settled);
  void settled.then(() => {
    if (journalWriteQueues.get(databaseName) === settled) {
      journalWriteQueues.delete(databaseName);
    }
  });
  return current;
}

export class CanvasChangeJournal {
  private dbPromise: Promise<IDBPDatabase<CanvasJournalDB>> | null = null;

  constructor(private readonly dbName: string = CANVAS_JOURNAL_DB) {}

  private getDb(): Promise<IDBPDatabase<CanvasJournalDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<CanvasJournalDB>(
        this.dbName,
        JOURNAL_DB_VERSION,
        {
          upgrade(db) {
            if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
              const store = db.createObjectStore(JOURNAL_STORE, {
                keyPath: "seq",
              });
              store.createIndex("by-room", "roomName");
            }
            if (!db.objectStoreNames.contains(JOURNAL_META_STORE)) {
              db.createObjectStore(JOURNAL_META_STORE, { keyPath: "roomName" });
            }
            if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
              db.createObjectStore(SNAPSHOT_STORE, { keyPath: "roomName" });
            }
          },
        },
      );
    }
    return this.dbPromise;
  }

  resetCache(): void {
    this.dbPromise = null;
  }

  async close(): Promise<void> {
    const dbPromise = this.dbPromise;
    this.dbPromise = null;
    if (!dbPromise) return;
    try {
      (await dbPromise).close();
    } catch {
      // A failed open has nothing to close.
    }
  }

  async append(
    roomName: string,
    update: Uint8Array,
  ): Promise<JournalBlock | null> {
    if (!roomName || !roomName.trim() || !update || update.length === 0) {
      return null;
    }
    return withJournalWriteLock(this.dbName, async () => {
      const trimmed = roomName.trim();
      const db = await this.getDb();
      const tx = db.transaction([JOURNAL_META_STORE, JOURNAL_STORE], "readwrite");
      const metaStore = tx.objectStore(JOURNAL_META_STORE);
      const journalStore = tx.objectStore(JOURNAL_STORE);

      const meta = await metaStore.get(trimmed);
      const seq = (meta?.lastSeq ?? 0) + 1;
      await metaStore.put({ ...meta, roomName: trimmed, lastSeq: seq });

      const block: JournalBlock = {
        seq,
        roomName: trimmed,
        update: Array.from(update),
        checksum: computeChecksum(update),
        createdAt: Date.now(),
      };
      await journalStore.put(block);
      await tx.done;
      return block;
    });
  }

  async listPending(roomName: string): Promise<JournalBlock[]> {
    const db = await this.getDb();
    const blocks = await db.getAllFromIndex(
      JOURNAL_STORE,
      "by-room",
      roomName.trim(),
    );
    return blocks.sort((a, b) => a.seq - b.seq);
  }

  async remove(seq: number): Promise<void> {
    await withJournalWriteLock(this.dbName, async () => {
      const db = await this.getDb();
      await db.delete(JOURNAL_STORE, seq);
    });
  }

  async clearRoom(roomName: string): Promise<void> {
    await withJournalWriteLock(this.dbName, async () => {
      const trimmed = roomName.trim();
      const blocks = await this.listPending(trimmed);
      const db = await this.getDb();
      const tx = db.transaction(JOURNAL_STORE, "readwrite");
      await Promise.all([
        ...blocks.map((block) => tx.store.delete(block.seq)),
        tx.done,
      ]);
    });
  }

  async size(roomName: string): Promise<number> {
    return (await this.listPending(roomName)).length;
  }

  async getStats(roomName: string): Promise<CanvasJournalStats> {
    const trimmed = roomName.trim();
    const db = await this.getDb();
    const [blocks, meta, snapshot] = await Promise.all([
      db.getAllFromIndex(JOURNAL_STORE, "by-room", trimmed),
      db.get(JOURNAL_META_STORE, trimmed),
      db.get(SNAPSHOT_STORE, trimmed),
    ]);

    const totalBytes = blocks.reduce(
      (sum, block) => sum + block.update.length,
      0,
    );
    const latestSeq =
      meta?.lastSeq ??
      blocks.reduce((max, block) => Math.max(max, block.seq), 0);

    return {
      roomName: trimmed,
      recordCount: blocks.length,
      totalBytes,
      latestSeq,
      opsSinceSnapshot: meta?.opsAtSnapshot ?? 0,
      hasSnapshot: snapshot != null,
      snapshotChecksum: snapshot?.checksum ?? null,
      snapshotBytes: snapshot?.update.length ?? 0,
    };
  }

  async loadSnapshot(roomName: string): Promise<CanvasSnapshot | null> {
    const db = await this.getDb();
    const snapshot = await db.get(SNAPSHOT_STORE, roomName.trim());
    return snapshot ?? null;
  }

  async saveSnapshot(snapshot: CanvasSnapshot): Promise<CanvasSnapshot> {
    return withJournalWriteLock(this.dbName, async () => {
      const record: CanvasSnapshot = {
        ...snapshot,
        roomName: snapshot.roomName.trim(),
      };
      const db = await this.getDb();
      await db.put(SNAPSHOT_STORE, record);
      return record;
    });
  }

  async deleteSnapshot(roomName: string): Promise<void> {
    await withJournalWriteLock(this.dbName, async () => {
      const db = await this.getDb();
      await db.delete(SNAPSHOT_STORE, roomName.trim());
    });
  }

  async compact(
    snapshot: CanvasSnapshot,
    throughSeq: number,
  ): Promise<CanvasCompactionResult> {
    return withJournalWriteLock(this.dbName, async () => {
      const record: CanvasSnapshot = {
        ...snapshot,
        roomName: snapshot.roomName.trim(),
      };
      const db = await this.getDb();
      const tx = db.transaction(
        [SNAPSHOT_STORE, JOURNAL_STORE, JOURNAL_META_STORE],
        "readwrite",
      );

      const snapshotStore = tx.objectStore(SNAPSHOT_STORE);
      const journalStore = tx.objectStore(JOURNAL_STORE);
      const metaStore = tx.objectStore(JOURNAL_META_STORE);

      await snapshotStore.put(record);

      const blocks = await journalStore.index("by-room").getAll(record.roomName);
      const superseded = blocks.filter((block) => block.seq <= throughSeq);
      await Promise.all(
        superseded.map((block) => journalStore.delete(block.seq)),
      );

      const meta = await metaStore.get(record.roomName);
      await metaStore.put({
        ...meta,
        roomName: record.roomName,
        lastSeq: Math.max(meta?.lastSeq ?? 0, throughSeq),
        opsAtSnapshot: record.opsAtSnapshot,
        compactedAt: record.createdAt,
      });

      await tx.done;

      return {
        snapshot: record,
        deletedRecords: superseded.length,
        reclaimedBytes: superseded.reduce(
          (sum, block) => sum + block.update.length,
          0,
        ),
      };
    });
  }
}

/* ------------------------------------------------------------------------- *
 * CRDT Tombstone-Safe Canvas Element Abstraction (#7492)
 *
 * Enforces tombstone semantics across decentralized Yjs peers:
 * - Once an element is marked `deleted: true` (or removed from the active
 *   elements map and recorded in the `tombstones` Y.Map), concurrent attribute
 *   mutations (e.g. color/position updates arriving over high-latency links)
 *   are silently discarded and never resurrect ghost elements.
 * - Only an explicit `restoreElement()` call clears the tombstone and
 *   re-enables mutations on that item ID.
 * ------------------------------------------------------------------------- */

export interface CanvasVectorElement {
  id: string;
  type: "rect" | "circle" | "stroke" | "text" | "sticky";
  x: number;
  y: number;
  width?: number;
  height?: number;
  color: string;
  label?: string;
  deleted?: boolean;
  deletedAt?: number;
  updatedAt: number;
}

export interface TombstoneRecord {
  id: string;
  deleted: true;
  deletedAt: number;
  snapshot?: Omit<CanvasVectorElement, "deleted" | "deletedAt">;
}

export const CANVAS_ELEMENTS_MAP = "canvas:elements";
export const CANVAS_TOMBSTONES_MAP = "canvas:tombstones";

/**
 * Tombstone-aware CRDT abstraction over a Yjs document's vector elements.
 */
export class TombstoneCanvasState {
  public readonly doc: Y.Doc;
  public readonly elements: Y.Map<Y.Map<unknown>>;
  public readonly tombstones: Y.Map<TombstoneRecord>;
  private enforcing = false;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.elements = doc.getMap<Y.Map<unknown>>(CANVAS_ELEMENTS_MAP);
    this.tombstones = doc.getMap<TombstoneRecord>(CANVAS_TOMBSTONES_MAP);

    // Observe remote or concurrent updates to ensure deleted items are never
    // resurrected by late-arriving property mutations.
    this.doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (this.enforcing || tx.origin === TOMBSTONE_ENFORCEMENT_ORIGIN) return;
      this.reconcileTombstones();
    });
  }

  /**
   * Reconciles `elements` against `tombstones` after any Yjs transaction so
   * concurrent attribute updates on a deleted key cannot resurrect the item.
   */
  public reconcileTombstones(): void {
    this.enforcing = true;
    try {
      this.doc.transact(() => {
        // 1. Any item recorded in `tombstones` with `deleted: true` must remain
        //    deleted and absent from active canvas elements.
        this.tombstones.forEach((record, id) => {
          if (record?.deleted === true && this.elements.has(id)) {
            const entry = this.elements.get(id);
            if (entry && entry.get("deleted") !== true) {
              entry.set("deleted", true);
            }
            this.elements.delete(id);
          }
        });

        // 2. Any item inside `elements` carrying `deleted: true` must be
        //    recorded in `tombstones` and pruned from active `elements`.
        const toTombstone: string[] = [];
        this.elements.forEach((entry, id) => {
          if (entry instanceof Y.Map && entry.get("deleted") === true) {
            toTombstone.push(id);
          }
        });

        for (const id of toTombstone) {
          const entry = this.elements.get(id);
          if (!this.tombstones.has(id)) {
            const snapshot = entry ? this.extractPlainElement(id, entry) : undefined;
            this.tombstones.set(id, {
              id,
              deleted: true,
              deletedAt:
                typeof entry?.get("deletedAt") === "number"
                  ? (entry.get("deletedAt") as number)
                  : Date.now(),
              snapshot: snapshot
                ? (({ deleted: _d, deletedAt: _da, ...rest }) => rest)(snapshot)
                : undefined,
            });
          }
          this.elements.delete(id);
        }
      }, TOMBSTONE_ENFORCEMENT_ORIGIN);
    } finally {
      this.enforcing = false;
    }
  }

  private extractPlainElement(
    id: string,
    entry: Y.Map<unknown>,
  ): CanvasVectorElement {
    return {
      id,
      type: (entry.get("type") as CanvasVectorElement["type"]) ?? "rect",
      x: typeof entry.get("x") === "number" ? (entry.get("x") as number) : 0,
      y: typeof entry.get("y") === "number" ? (entry.get("y") as number) : 0,
      width:
        typeof entry.get("width") === "number"
          ? (entry.get("width") as number)
          : undefined,
      height:
        typeof entry.get("height") === "number"
          ? (entry.get("height") as number)
          : undefined,
      color:
        typeof entry.get("color") === "string"
          ? (entry.get("color") as string)
          : "#3b82f6",
      label:
        typeof entry.get("label") === "string"
          ? (entry.get("label") as string)
          : undefined,
      deleted: entry.get("deleted") === true,
      deletedAt:
        typeof entry.get("deletedAt") === "number"
          ? (entry.get("deletedAt") as number)
          : undefined,
      updatedAt:
        typeof entry.get("updatedAt") === "number"
          ? (entry.get("updatedAt") as number)
          : Date.now(),
    };
  }

  public isTombstoned(id: string): boolean {
    const tombstone = this.tombstones.get(id);
    if (tombstone?.deleted === true) return true;
    const entry = this.elements.get(id);
    return entry instanceof Y.Map && entry.get("deleted") === true;
  }

  /**
   * Creates or upserts an active vector element unless its ID is tombstoned.
   */
  public upsertElement(
    element: Omit<CanvasVectorElement, "deleted" | "deletedAt" | "updatedAt"> & {
      updatedAt?: number;
    },
    origin?: unknown,
  ): boolean {
    if (this.isTombstoned(element.id)) {
      return false;
    }

    this.doc.transact(() => {
      let entry = this.elements.get(element.id);
      if (!entry) {
        entry = new Y.Map<unknown>();
        this.elements.set(element.id, entry);
      }
      entry.set("id", element.id);
      entry.set("type", element.type);
      entry.set("x", element.x);
      entry.set("y", element.y);
      if (element.width !== undefined) entry.set("width", element.width);
      if (element.height !== undefined) entry.set("height", element.height);
      entry.set("color", element.color);
      if (element.label !== undefined) entry.set("label", element.label);
      entry.set("deleted", false);
      entry.set("updatedAt", element.updatedAt ?? Date.now());
    }, origin);

    return true;
  }

  /**
   * Mutates attributes (such as `color`, `x`, `y`) on an existing active element.
   * If the element has been tombstoned (`deleted: true` or removed from parent
   * `Y.Map`), the mutation is silently discarded rather than recreating a ghost
   * element.
   */
  public updateElementAttributes(
    id: string,
    patch: Partial<Omit<CanvasVectorElement, "id" | "deleted" | "deletedAt">>,
    origin?: unknown,
  ): boolean {
    if (this.isTombstoned(id)) {
      return false;
    }

    const entry = this.elements.get(id);
    if (!entry || entry.get("deleted") === true) {
      return false;
    }

    this.doc.transact(() => {
      if (patch.type !== undefined) entry.set("type", patch.type);
      if (patch.x !== undefined) entry.set("x", patch.x);
      if (patch.y !== undefined) entry.set("y", patch.y);
      if (patch.width !== undefined) entry.set("width", patch.width);
      if (patch.height !== undefined) entry.set("height", patch.height);
      if (patch.color !== undefined) entry.set("color", patch.color);
      if (patch.label !== undefined) entry.set("label", patch.label);
      entry.set("updatedAt", patch.updatedAt ?? Date.now());
    }, origin);

    return true;
  }

  /**
   * Marks an item with `deleted: true`, records a durable tombstone, and removes
   * it from the active `Y.Map` so concurrent delta updates cannot resurrect it.
   */
  public deleteElement(id: string, origin?: unknown): boolean {
    if (this.isTombstoned(id) && !this.elements.has(id)) {
      return false;
    }

    const now = Date.now();
    this.doc.transact(() => {
      const entry = this.elements.get(id);
      const snapshot = entry ? this.extractPlainElement(id, entry) : undefined;
      if (entry) {
        entry.set("deleted", true);
        entry.set("deletedAt", now);
      }
      this.tombstones.set(id, {
        id,
        deleted: true,
        deletedAt: now,
        snapshot: snapshot
          ? (({ deleted: _d, deletedAt: _da, ...rest }) => rest)(snapshot)
          : undefined,
      });
      this.elements.delete(id);
    }, origin);

    return true;
  }

  /**
   * Explicitly restores a previously deleted element (undo/restore flow).
   */
  public restoreElement(
    id: string,
    fallback?: Omit<CanvasVectorElement, "id" | "deleted" | "deletedAt" | "updatedAt">,
    origin?: unknown,
  ): boolean {
    const tombstone = this.tombstones.get(id);
    if (!tombstone) return false;

    const base =
      tombstone.snapshot ??
      (fallback ? { id, ...fallback, updatedAt: Date.now() } : undefined);
    if (!base) return false;

    this.doc.transact(() => {
      this.tombstones.delete(id);
      const entry = new Y.Map<unknown>();
      entry.set("id", id);
      entry.set("type", base.type);
      entry.set("x", base.x);
      entry.set("y", base.y);
      if (base.width !== undefined) entry.set("width", base.width);
      if (base.height !== undefined) entry.set("height", base.height);
      entry.set("color", base.color);
      if (base.label !== undefined) entry.set("label", base.label);
      entry.set("deleted", false);
      entry.set("updatedAt", Date.now());
      this.elements.set(id, entry);
    }, origin);

    return true;
  }

  /**
   * Returns all active (non-tombstoned) vector elements on the canvas.
   */
  public getActiveElements(): CanvasVectorElement[] {
    const active: CanvasVectorElement[] = [];
    this.elements.forEach((entry, id) => {
      if (this.isTombstoned(id)) return;
      if (!(entry instanceof Y.Map)) return;
      if (entry.get("deleted") === true) return;
      active.push(this.extractPlainElement(id, entry));
    });
    return active;
  }

  public getElement(id: string): CanvasVectorElement | null {
    if (this.isTombstoned(id)) return null;
    const entry = this.elements.get(id);
    if (!entry || entry.get("deleted") === true) return null;
    return this.extractPlainElement(id, entry);
  }
}

/**
 * Canvas provider that owns the live `Y.Doc`, the offline IndexedDB journal and
 * the background snapshot compactor.
 */
export class NomadCanvasProvider {
  public doc: Y.Doc;
  public roomName: string;
  public readonly journal: CanvasChangeJournal | null;
  public readonly canvasState: TombstoneCanvasState;

  private opCount = 0;
  private readonly maxOps: number;
  private readonly maxJournalRecords: number;
  private readonly maxCompactionBytes: number;
  private readonly autoCompaction: boolean;
  private readonly checkpointIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private idleHandle: number | null = null;
  private idleUsesTimeout = false;
  private compactionInFlight: Promise<CanvasCompactionResult | null> | null =
    null;
  private scheduledCompaction: Promise<CanvasCompactionResult | null> | null =
    null;
  private readonly pendingWrites = new Set<Promise<void>>();
  private journaledRecords = 0;
  private journaledBytes = 0;
  private countersLoaded = false;
  private destroyed = false;
  private lastCompactionResult: CanvasCompactionResult | null = null;
  private readonly transport?: CanvasTransport;
  private readonly onReconnected?: (result: ReplayResult) => void;
  private readonly onCompacted?: (result: CanvasCompactionResult) => void;
  private readonly onCompactionError?: (error: unknown) => void;
  private connected: boolean;
  private replaying = false;

  constructor(roomName: string, config: CompactionConfig = {}) {
    this.roomName = roomName;
    this.doc = new Y.Doc();
    this.canvasState = new TombstoneCanvasState(this.doc);
    this.maxOps = Math.max(1, Math.floor(config.maxOperations ?? 500));
    this.maxJournalRecords = Math.max(
      1,
      Math.floor(config.maxJournalRecords ?? DEFAULT_MAX_JOURNAL_RECORDS),
    );
    this.maxCompactionBytes = Math.max(
      1,
      Math.floor(config.maxCompactionBytes ?? DEFAULT_MAX_COMPACTION_BYTES),
    );
    this.autoCompaction = config.enableAutoCompaction ?? true;
    this.checkpointIntervalMs = Math.max(
      0,
      Math.floor(config.checkpointIntervalMs ?? 5 * 60 * 1000),
    );
    this.transport = config.transport;
    this.onReconnected = config.onReconnected;
    this.onCompacted = config.onCompacted;
    this.onCompactionError = config.onCompactionError;
    this.connected = config.transport ? config.transport.isConnected() : true;

    const journalEnabled =
      config.enableJournal ??
      (!!config.transport && typeof indexedDB !== "undefined");
    this.journal = journalEnabled
      ? new CanvasChangeJournal(config.journalDbName)
      : null;

    // Listen to local & remote update transactions.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (
        origin === JOURNAL_REPLAY_ORIGIN ||
        origin === SNAPSHOT_RECOVERY_ORIGIN
      ) {
        return;
      }

      this.opCount++;
      if (this.opCount >= this.maxOps) {
        this.opCount = 0;
        void this.compactAndCheckpoint().catch((error) =>
          this.reportCompactionError(error),
        );
      }

      this.dispatchUpdate(update);
    });

    this.startPeriodicCheckpoint();
  }

  private dispatchUpdate(update: Uint8Array): void {
    if (!this.transport) return;
    if (this.transport.isConnected()) {
      this.transport.send(update);
      return;
    }

    const write = this.journalUpdate(update);
    this.pendingWrites.add(write);
    void write.finally(() => this.pendingWrites.delete(write));
  }

  private async journalUpdate(update: Uint8Array): Promise<void> {
    if (!this.journal) return;
    try {
      await this.ensureJournalCounters();
      const block = await this.journal.append(this.roomName, update);
      if (!block) return;

      this.journaledRecords += 1;
      this.journaledBytes += block.update.length;

      const overRecordLimit = this.journaledRecords > this.maxJournalRecords;
      const overByteLimit = this.journaledBytes > this.maxCompactionBytes;
      if (this.autoCompaction && (overRecordLimit || overByteLimit)) {
        void this.scheduleCompaction();
      }
    } catch (err) {
      console.error("[CRDT Journal] Failed to persist offline update:", err);
    }
  }

  private async ensureJournalCounters(): Promise<void> {
    if (this.countersLoaded || !this.journal) return;
    const stats = await this.journal.getStats(this.roomName);
    this.journaledRecords = stats.recordCount;
    this.journaledBytes = stats.totalBytes;
    this.countersLoaded = true;
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public get lastCompaction(): CanvasCompactionResult | null {
    return this.lastCompactionResult;
  }

  public setConnected(connected: boolean): void {
    const wasOffline = !this.connected;
    this.connected = connected;
    if (connected && wasOffline && this.journal) {
      void this.replayJournal();
    }
  }

  public async pendingJournalCount(): Promise<number> {
    return this.journal ? this.journal.size(this.roomName) : 0;
  }

  public async getJournalStats(): Promise<CanvasJournalStats | null> {
    return this.journal ? this.journal.getStats(this.roomName) : null;
  }

  public async flushPendingWrites(): Promise<void> {
    for (let guard = 0; guard < 1024 && this.pendingWrites.size > 0; guard++) {
      await Promise.all([...this.pendingWrites]);
    }
  }

  public async replayJournal(remoteChecksum?: string): Promise<ReplayResult> {
    if (this.replaying) {
      return {
        replayed: 0,
        checksum: this.getDocumentChecksum(),
        converged: remoteChecksum
          ? this.getDocumentChecksum() === remoteChecksum
          : null,
      };
    }

    this.replaying = true;
    let replayed = 0;
    try {
      const pending = this.journal
        ? await this.journal.listPending(this.roomName)
        : [];

      for (const block of pending) {
        const update = new Uint8Array(block.update);

        if (computeChecksum(update) !== block.checksum) {
          console.error(
            `[CRDT Journal] Checksum mismatch on block #${block.seq}; dropping corrupt block`,
          );
          if (this.journal) await this.journal.remove(block.seq);
          continue;
        }

        if (!this.transport) break;

        try {
          this.transport.send(update);
        } catch (err) {
          console.error(
            "[CRDT Journal] Transport failed mid-replay; keeping remaining blocks:",
            err,
          );
          break;
        }

        if (this.journal) await this.journal.remove(block.seq);
        replayed++;
      }

      const checksum = this.getDocumentChecksum();
      const converged =
        remoteChecksum != null ? checksum === remoteChecksum : null;
      if (remoteChecksum != null && !converged) {
        console.warn(
          `[CRDT Journal] Post-sync divergence for room ${this.roomName}: local=${checksum} remote=${remoteChecksum}`,
        );
      }

      const result: ReplayResult = { replayed, checksum, converged };
      this.onReconnected?.(result);
      return result;
    } finally {
      this.replaying = false;
    }
  }

  public getDocumentChecksum(): string {
    return computeChecksum(Y.encodeStateAsUpdate(this.doc));
  }

  public verifyConvergence(remoteChecksum: string): boolean {
    return this.getDocumentChecksum() === remoteChecksum;
  }

  public compactState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  public async maybeScheduleCompaction(): Promise<boolean> {
    if (!this.journal || this.destroyed || !this.autoCompaction) return false;

    const stats = await this.journal.getStats(this.roomName);
    this.countersLoaded = true;
    this.journaledRecords = stats.recordCount;
    this.journaledBytes = stats.totalBytes;

    if (
      stats.recordCount > this.maxJournalRecords ||
      stats.totalBytes > this.maxCompactionBytes
    ) {
      void this.scheduleCompaction();
      return true;
    }
    return false;
  }

  public async waitForCompaction(): Promise<void> {
    for (let guard = 0; guard < 16; guard++) {
      const pending = this.scheduledCompaction ?? this.compactionInFlight;
      if (!pending) return;
      await pending;
    }
  }

  public async compactJournal(): Promise<CanvasCompactionResult | null> {
    if (this.destroyed || !this.journal) return null;
    if (this.compactionInFlight) return this.compactionInFlight;

    const task = this.runCompaction();
    this.compactionInFlight = task;
    try {
      return await task;
    } finally {
      if (this.compactionInFlight === task) this.compactionInFlight = null;
    }
  }

  private async runCompaction(): Promise<CanvasCompactionResult | null> {
    const journal = this.journal;
    if (!journal || this.destroyed) return null;

    const stats = await journal.getStats(this.roomName);
    if (stats.recordCount === 0) return null;

    await this.restoreFromJournal();

    const update = Y.encodeStateAsUpdate(this.doc);
    const stateVector = Y.encodeStateVector(this.doc);
    const checksum = computeChecksum(update);

    if (checksum !== this.getDocumentChecksum()) {
      throw new CanvasSnapshotIntegrityError(
        `Pre-compaction state mismatch for room ${this.roomName}`,
      );
    }
    this.assertSnapshotReconstructs(
      update,
      stateVector,
      checksum,
      "pre-compaction",
    );

    await yieldToMainThread();

    const result = await journal.compact(
      {
        roomName: this.roomName,
        update: Array.from(update),
        stateVector: Array.from(stateVector),
        checksum,
        opsAtSnapshot: stats.recordCount,
        createdAt: Date.now(),
      },
      stats.latestSeq,
    );

    this.journaledRecords = Math.max(
      0,
      this.journaledRecords - result.deletedRecords,
    );
    this.journaledBytes = Math.max(
      0,
      this.journaledBytes - result.reclaimedBytes,
    );
    this.countersLoaded = true;

    await yieldToMainThread();

    const persisted = await journal.loadSnapshot(this.roomName);
    if (!persisted) {
      throw new CanvasSnapshotIntegrityError(
        `Snapshot for room ${this.roomName} was not persisted`,
      );
    }

    const persistedUpdate = new Uint8Array(persisted.update);
    const persistedVector = new Uint8Array(persisted.stateVector);
    if (computeChecksum(persistedUpdate) !== persisted.checksum) {
      throw new CanvasSnapshotIntegrityError(
        `Persisted snapshot for room ${this.roomName} failed checksum verification`,
      );
    }
    if (computeChecksum(persistedUpdate) !== checksum) {
      throw new CanvasSnapshotIntegrityError(
        `Persisted snapshot for room ${this.roomName} does not match the encoded state`,
      );
    }
    this.assertSnapshotReconstructs(
      persistedUpdate,
      persistedVector,
      persisted.checksum,
      "post-compaction",
    );

    if (isStateVectorBehind(Y.encodeStateVector(this.doc), persistedVector)) {
      throw new CanvasSnapshotIntegrityError(
        `Post-compaction document for room ${this.roomName} lost state covered by the snapshot`,
      );
    }

    this.opCount = 0;
    this.lastCompactionResult = result;
    this.onCompacted?.(result);
    return result;
  }

  private assertSnapshotReconstructs(
    update: Uint8Array,
    stateVector: Uint8Array,
    checksum: string,
    phase: string,
  ): void {
    const scratch = new Y.Doc();
    try {
      Y.applyUpdate(scratch, update);

      const roundTrip = Y.encodeStateAsUpdate(scratch);
      const roundTripChecksum = computeChecksum(roundTrip);
      if (roundTripChecksum !== checksum) {
        throw new CanvasSnapshotIntegrityError(
          `${phase} round-trip checksum mismatch for room ${this.roomName}: expected ${checksum}, got ${roundTripChecksum}`,
        );
      }

      if (!stateVectorsEqual(Y.encodeStateVector(scratch), stateVector)) {
        throw new CanvasSnapshotIntegrityError(
          `${phase} state vector mismatch for room ${this.roomName}`,
        );
      }
    } finally {
      scratch.destroy();
    }
  }

  public async compactAndCheckpoint(): Promise<Uint8Array> {
    const result = await this.compactJournal();
    const bytes = result
      ? new Uint8Array(result.snapshot.update)
      : this.compactState();

    try {
      const client = redis as unknown as RedisCheckpointClient | null;
      if (client && typeof client.set === "function") {
        await client.set(
          `${SNAPSHOT_REDIS_KEY_PREFIX}${this.roomName}:snapshot`,
          bytesToBase64(bytes),
        );
      }
    } catch (err) {
      console.error(
        "[CRDT Compaction] Failed to flush snapshot to Redis:",
        err,
      );
    }

    return bytes;
  }

  public async restoreFromJournal(): Promise<JournalRestoreResult> {
    const journal = this.journal;
    const localBefore = this.getDocumentChecksum();
    const stateVectorBefore = Array.from(Y.encodeStateVector(this.doc));

    if (!journal) {
      return {
        restored: false,
        appliedBlocks: 0,
        checksum: localBefore,
        stateVector: stateVectorBefore,
      };
    }

    const snapshot = await journal.loadSnapshot(this.roomName);
    if (snapshot) {
      const update = new Uint8Array(snapshot.update);
      const stateVector = new Uint8Array(snapshot.stateVector);

      if (computeChecksum(update) !== snapshot.checksum) {
        throw new CanvasSnapshotIntegrityError(
          `Snapshot for room ${this.roomName} failed checksum verification`,
        );
      }
      this.assertSnapshotReconstructs(
        update,
        stateVector,
        snapshot.checksum,
        "restore",
      );

      Y.applyUpdate(this.doc, update, SNAPSHOT_RECOVERY_ORIGIN);
    }

    const pending = await journal.listPending(this.roomName);
    let appliedBlocks = 0;
    for (const block of pending) {
      const update = new Uint8Array(block.update);
      if (computeChecksum(update) !== block.checksum) {
        console.warn(
          `[CRDT Journal] Dropping corrupt block #${block.seq} for room ${this.roomName}`,
        );
        await journal.remove(block.seq);
        continue;
      }
      Y.applyUpdate(this.doc, update, JOURNAL_REPLAY_ORIGIN);
      appliedBlocks++;
    }

    const checksum = this.getDocumentChecksum();
    return {
      restored: checksum !== localBefore,
      appliedBlocks,
      checksum,
      stateVector: Array.from(Y.encodeStateVector(this.doc)),
    };
  }

  public async loadRoomSnapshot(): Promise<boolean> {
    const redisKey = `${SNAPSHOT_REDIS_KEY_PREFIX}${this.roomName}:snapshot`;
    try {
      const client = redis as unknown as RedisCheckpointClient | null;
      if (client && typeof client.get === "function") {
        const snapshotBase64 = await client.get(redisKey);
        if (typeof snapshotBase64 === "string" && snapshotBase64.length > 0) {
          Y.applyUpdate(
            this.doc,
            base64ToBytes(snapshotBase64),
            SNAPSHOT_RECOVERY_ORIGIN,
          );
          return true;
        }
      }
    } catch (err) {
      console.error("[CRDT Compaction] Error loading snapshot:", err);
    }
    return false;
  }

  private startPeriodicCheckpoint(): void {
    if (this.checkpointIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      if (this.opCount > 0) {
        void this.compactAndCheckpoint().catch((error) =>
          this.reportCompactionError(error),
        );
      }
    }, this.checkpointIntervalMs);
  }

  private scheduleCompaction(): Promise<CanvasCompactionResult | null> {
    if (this.destroyed || !this.journal) return Promise.resolve(null);
    if (this.scheduledCompaction) return this.scheduledCompaction;

    const scheduled = new Promise<CanvasCompactionResult | null>((resolve) => {
      const execute = () => {
        this.idleHandle = null;
        void this.compactJournal().then(resolve, (error) => {
          this.reportCompactionError(error);
          resolve(null);
        });
      };

      const idle = globalThis as unknown as IdleGlobal;
      if (typeof idle.requestIdleCallback === "function") {
        this.idleUsesTimeout = false;
        this.idleHandle = idle.requestIdleCallback(execute, { timeout: 2000 });
      } else {
        this.idleUsesTimeout = true;
        this.idleHandle = setTimeout(execute, 0) as unknown as number;
      }
    });

    this.scheduledCompaction = scheduled;
    void scheduled.finally(() => {
      if (this.scheduledCompaction === scheduled) {
        this.scheduledCompaction = null;
      }
    });
    return scheduled;
  }

  private reportCompactionError(error: unknown): void {
    console.error("[CRDT Compaction] Background compaction failed:", error);
    this.onCompactionError?.(error);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.idleHandle !== null) {
      const idle = globalThis as unknown as IdleGlobal;
      if (this.idleUsesTimeout) {
        clearTimeout(this.idleHandle);
      } else {
        idle.cancelIdleCallback?.(this.idleHandle);
      }
      this.idleHandle = null;
    }

    this.pendingWrites.clear();
    this.doc.destroy();
  }
}

export const DELTA_SYNC_REMOTE_ORIGIN = "crdt-delta-sync-remote";

export interface DeltaSyncMetrics {
  stateVectorBytesSent: number;
  deltaBytesSent: number;
  fullStateBytesEquivalent: number;
  framesSent: number;
  framesReceived: number;
  duplicateUpdatesIgnored: number;
}

function fingerprintUpdate(bytes: Uint8Array): string {
  let hash = 0x811c9ce5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.length}:${(hash >>> 0).toString(16)}`;
}

export class CrdtDeltaSyncSession {
  public readonly doc: Y.Doc;
  public readonly peerId: string;
  public readonly canvasState: TombstoneCanvasState;
  private readonly sendFrame: (frame: Uint8Array) => void;
  private readonly maxChunkPayloadSize?: number;
  private readonly reassembler = new CrdtFrameReassembler();
  private readonly appliedFingerprints = new Set<string>();
  private nextMessageId = 1;
  private lastKnownRemoteStateVector: Uint8Array | null = null;

  public readonly metrics: DeltaSyncMetrics = {
    stateVectorBytesSent: 0,
    deltaBytesSent: 0,
    fullStateBytesEquivalent: 0,
    framesSent: 0,
    framesReceived: 0,
    duplicateUpdatesIgnored: 0,
  };

  constructor(options: {
    doc: Y.Doc;
    peerId: string;
    sendFrame: (frame: Uint8Array) => void;
    maxChunkPayloadSize?: number;
  }) {
    this.doc = options.doc;
    this.peerId = options.peerId;
    this.canvasState = new TombstoneCanvasState(this.doc);
    this.sendFrame = options.sendFrame;
    this.maxChunkPayloadSize = options.maxChunkPayloadSize;
  }

  private allocateMessageId(): number {
    const id = this.nextMessageId >>> 0;
    this.nextMessageId = (this.nextMessageId + 1) >>> 0 || 1;
    return id;
  }

  public initiateStateVectorHandshake(): Uint8Array {
    const stateVector = Y.encodeStateVector(this.doc);
    const frames = encodeCrdtFrames(stateVector, {
      messageId: this.allocateMessageId(),
      messageType: CrdtFrameMessageType.STATE_VECTOR,
      maxChunkPayloadSize: this.maxChunkPayloadSize,
    });

    this.metrics.stateVectorBytesSent += stateVector.byteLength;
    this.metrics.framesSent += frames.length;

    for (const frame of frames) {
      this.sendFrame(frame);
    }
    return stateVector;
  }

  public sendDeltaForStateVector(remoteStateVector: Uint8Array): Uint8Array {
    this.lastKnownRemoteStateVector = new Uint8Array(remoteStateVector);
    const delta = Y.encodeStateAsUpdate(this.doc, remoteStateVector);
    const fullEquivalent = Y.encodeStateAsUpdate(this.doc);

    this.metrics.deltaBytesSent += delta.byteLength;
    this.metrics.fullStateBytesEquivalent += fullEquivalent.byteLength;

    this.appliedFingerprints.add(fingerprintUpdate(delta));

    const frames = encodeCrdtFrames(delta, {
      messageId: this.allocateMessageId(),
      messageType: CrdtFrameMessageType.DELTA_UPDATE,
      maxChunkPayloadSize: this.maxChunkPayloadSize,
    });

    this.metrics.framesSent += frames.length;
    for (const frame of frames) {
      this.sendFrame(frame);
    }
    return delta;
  }

  public broadcastLocalDelta(update: Uint8Array): void {
    if (!update || update.byteLength === 0) return;
    this.appliedFingerprints.add(fingerprintUpdate(update));

    const frames = encodeCrdtFrames(update, {
      messageId: this.allocateMessageId(),
      messageType: CrdtFrameMessageType.DELTA_UPDATE,
      maxChunkPayloadSize: this.maxChunkPayloadSize,
    });

    this.metrics.deltaBytesSent += update.byteLength;
    this.metrics.framesSent += frames.length;
    for (const frame of frames) {
      this.sendFrame(frame);
    }
  }

  public receiveFrame(rawFrame: Uint8Array | ArrayBuffer): {
    completed: boolean;
    messageType?: CrdtFrameMessageType;
    appliedDelta?: boolean;
  } {
    this.metrics.framesReceived += 1;
    const message = this.reassembler.pushFrame(rawFrame);
    if (!message) {
      return { completed: false };
    }

    if (message.messageType === CrdtFrameMessageType.STATE_VECTOR) {
      this.sendDeltaForStateVector(message.payload);
      return {
        completed: true,
        messageType: CrdtFrameMessageType.STATE_VECTOR,
      };
    }

    if (
      message.messageType === CrdtFrameMessageType.DELTA_UPDATE ||
      message.messageType === CrdtFrameMessageType.FULL_SYNC_FALLBACK
    ) {
      const applied = this.applyDeltaIdempotently(message.payload);
      return {
        completed: true,
        messageType: message.messageType,
        appliedDelta: applied,
      };
    }

    return { completed: true, messageType: message.messageType };
  }

  public applyDeltaIdempotently(delta: Uint8Array): boolean {
    if (!delta || delta.byteLength === 0) {
      this.metrics.duplicateUpdatesIgnored += 1;
      return false;
    }

    const fp = fingerprintUpdate(delta);
    if (this.appliedFingerprints.has(fp)) {
      this.metrics.duplicateUpdatesIgnored += 1;
      return false;
    }

    const beforeVector = Y.encodeStateVector(this.doc);
    Y.applyUpdate(this.doc, delta, DELTA_SYNC_REMOTE_ORIGIN);
    this.canvasState.reconcileTombstones();
    const afterVector = Y.encodeStateVector(this.doc);

    this.appliedFingerprints.add(fp);
    if (this.appliedFingerprints.size > 1024) {
      const oldest = this.appliedFingerprints.values().next().value;
      if (oldest !== undefined) {
        this.appliedFingerprints.delete(oldest);
      }
    }

    if (
      beforeVector.byteLength === afterVector.byteLength &&
      beforeVector.every((b, idx) => b === afterVector[idx])
    ) {
      this.metrics.duplicateUpdatesIgnored += 1;
      return false;
    }

    return true;
  }

  public getLastKnownRemoteStateVector(): Uint8Array | null {
    return this.lastKnownRemoteStateVector
      ? new Uint8Array(this.lastKnownRemoteStateVector)
      : null;
  }
}