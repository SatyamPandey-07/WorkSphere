import * as Y from "yjs";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { redis } from "@/lib/redis";
import {
  base64ToBytes,
  bytesToBase64,
  isStateVectorBehind,
} from "./snapshotManager";
import { compressYjsUpdate } from "./yjsCompression";

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
 *
 * When a nomad is editing a board over unstable mobile coverage the socket can
 * drop mid-edit. The journal persists every unconfirmed local transaction block
 * to IndexedDB (surviving browser restarts) and re-streams the backlog in
 * sequence order once the transport reconnects, before awareness sync resumes.
 * A per-block checksum plus a post-sync document checksum let peers detect
 * corruption and divergence instead of silently drifting apart.
 *
 * Differential snapshot pruning and state-vector compaction (#7741)
 *
 * Long drawing sessions append thousands of micro-updates to the journal. Once
 * the room holds more than `DEFAULT_MAX_JOURNAL_RECORDS` raw records or more
 * than `DEFAULT_MAX_COMPACTION_BYTES` of them, a background worker encodes the
 * whole document with `Y.encodeStateAsUpdate(doc)` and, in one atomic
 * IndexedDB transaction, stores that baseline snapshot and deletes every
 * historical record the snapshot's state vector supersedes. The document is
 * round-tripped through a scratch `Y.Doc` before and after the write so a
 * failed compaction can never silently drop edits.
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

/** A single durable, ordered change block queued while offline. */
export interface JournalBlock {
  /** Monotonic per-room sequence number (the replay ordering key). */
  seq: number;
  roomName: string;
  /** Serialized `Y.encodeStateAsUpdate` bytes, stored as a plain array. */
  update: number[];
  /** FNV-1a 64-bit checksum of `update` for corruption detection. */
  checksum: string;
  createdAt: number;
}

/** A consolidated baseline for a room produced by journal compaction. */
export interface CanvasSnapshot {
  roomName: string;
  /** `Y.encodeStateAsUpdate(doc)` bytes, stored as a plain array. */
  update: number[];
  /** `Y.encodeStateVector(doc)` bytes captured alongside `update`. */
  stateVector: number[];
  /** FNV-1a checksum of `update` for integrity verification. */
  checksum: string;
  /** Number of raw journal records folded into this snapshot. */
  opsAtSnapshot: number;
  createdAt: number;
}

/** Per-room bookkeeping kept across browser restarts. */
export interface CanvasJournalMeta {
  roomName: string;
  lastSeq: number;
  /** Number of records folded into the most recent snapshot. */
  opsAtSnapshot?: number;
  compactedAt?: number;
}

/** Snapshot of the journal's on-disk footprint for a room. */
export interface CanvasJournalStats {
  roomName: string;
  /** Number of raw update records still stored. */
  recordCount: number;
  /** Sum of the raw update payload sizes, in bytes. */
  totalBytes: number;
  /** Highest sequence number ever issued for the room. */
  latestSeq: number;
  /** Records folded into the last snapshot. */
  opsSinceSnapshot: number;
  hasSnapshot: boolean;
  snapshotChecksum: string | null;
  snapshotBytes: number;
}

/** Outcome of an atomic snapshot + prune transaction. */
export interface CanvasCompactionResult {
  snapshot: CanvasSnapshot;
  /** Number of raw journal records deleted by the transaction. */
  deletedRecords: number;
  /** Bytes of raw journal records reclaimed by the transaction. */
  reclaimedBytes: number;
}

/** Outcome of replaying a stored snapshot plus any surviving journal blocks. */
export interface JournalRestoreResult {
  /** True when applying the snapshot/journal changed the local document. */
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
  /** Number of blocks successfully re-streamed and cleared. */
  replayed: number;
  /** Checksum of the local document after replay. */
  checksum: string;
  /** Whether local and remote checksums matched (`null` when not supplied). */
  converged: boolean | null;
}

/**
 * Minimal transport abstraction the provider streams updates through. The
 * caller wires this to its WebSocket/PartyKit connection.
 */
export interface CanvasTransport {
  send(update: Uint8Array): void;
  isConnected(): boolean;
}

export interface CompactionConfig {
  maxOperations?: number;
  checkpointIntervalMs?: number;
  /**
   * Force-enable/disable the IndexedDB journal. Defaults to on whenever a
   * transport is supplied and IndexedDB is available.
   */
  enableJournal?: boolean;
  /** Override the journal database name (tests / multiple boards). */
  journalDbName?: string;
  /** Transport used for live streaming and offline replay. */
  transport?: CanvasTransport;
  /** Invoked after a reconnect replay completes, to resume awareness sync. */
  onReconnected?: (result: ReplayResult) => void;
  /** Raw journal record threshold. Defaults to 500. */
  maxJournalRecords?: number;
  /** Raw journal byte threshold. Defaults to 5 MB. */
  maxCompactionBytes?: number;
  /** Run threshold compaction in the background. Defaults to on. */
  enableAutoCompaction?: boolean;
  /** Invoked after a successful compaction. */
  onCompacted?: (result: CanvasCompactionResult) => void;
  /** Invoked when a background compaction fails. */
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

/**
 * FNV-1a 64-bit hash of a byte array, rendered as a zero-padded hex string.
 * Deterministic and dependency-free so it runs identically in the browser and
 * on the server. Two peers that have integrated the same set of Yjs updates
 * produce byte-identical `Y.encodeStateAsUpdate` output, so equal checksums
 * imply converged documents.
 */
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

/** True when two encoded state vectors describe the same client clocks. */
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

/**
 * Yields to the event loop so a background compaction never monopolises the
 * main thread for the whole encode/verify/commit sequence.
 */
function yieldToMainThread(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Durable, room-scoped append-only journal backed by IndexedDB.
 *
 * Sequence numbers are persisted in a companion `meta` store so they stay
 * monotonic across removals and browser restarts. Consolidated snapshots live
 * in their own store, one per room, and are written in the same transaction
 * that prunes the journal records they supersede.
 */
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

  /** Drop the cached connection (test isolation / forced reopen). */
  resetCache(): void {
    this.dbPromise = null;
  }

  /** Close the cached connection once pending work settles. */
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

  /**
   * Persist one transaction block with the next sequence number.
   *
   * The counter read-modify-write and the block insert share a single
   * `readwrite` transaction so concurrent offline edits can't observe a stale
   * counter and collide on the same sequence number.
   */
  async append(
    roomName: string,
    update: Uint8Array,
  ): Promise<JournalBlock | null> {
    if (!roomName || !roomName.trim() || !update || update.length === 0) {
      return null;
    }
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
  }

  /** All pending blocks for a room, ordered by ascending sequence. */
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
    const db = await this.getDb();
    await db.delete(JOURNAL_STORE, seq);
  }

  async clearRoom(roomName: string): Promise<void> {
    const trimmed = roomName.trim();
    const blocks = await this.listPending(trimmed);
    const db = await this.getDb();
    const tx = db.transaction(JOURNAL_STORE, "readwrite");
    await Promise.all([
      ...blocks.map((block) => tx.store.delete(block.seq)),
      tx.done,
    ]);
  }

  async size(roomName: string): Promise<number> {
    return (await this.listPending(roomName)).length;
  }

  /** On-disk footprint of a room's raw records and baseline snapshot. */
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

  /** Stored baseline snapshot for a room, if any. */
  async loadSnapshot(roomName: string): Promise<CanvasSnapshot | null> {
    const db = await this.getDb();
    const snapshot = await db.get(SNAPSHOT_STORE, roomName.trim());
    return snapshot ?? null;
  }

  /** Persist a snapshot without pruning (repair / test helper). */
  async saveSnapshot(snapshot: CanvasSnapshot): Promise<CanvasSnapshot> {
    const record: CanvasSnapshot = {
      ...snapshot,
      roomName: snapshot.roomName.trim(),
    };
    const db = await this.getDb();
    await db.put(SNAPSHOT_STORE, record);
    return record;
  }

  async deleteSnapshot(roomName: string): Promise<void> {
    const db = await this.getDb();
    await db.delete(SNAPSHOT_STORE, roomName.trim());
  }

  /**
   * Atomically stores `snapshot` and deletes every journal record whose
   * sequence number is at or below `throughSeq`.
   *
   * Both writes share one `readwrite` transaction across the snapshot, journal
   * and meta stores, so a crash can never leave the baseline persisted while
   * the superseded history survives (or vice versa). A snapshot whose state
   * vector does not cover a record is never allowed to prune it.
   */
  async compact(
    snapshot: CanvasSnapshot,
    throughSeq: number,
  ): Promise<CanvasCompactionResult> {
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
      // Replayed blocks and recovered snapshots are already persisted; never
      // re-journal them or count them toward the compaction threshold.
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

    // Start the periodic checkpoint timer.
    this.startPeriodicCheckpoint();
  }

  /**
   * Routes a fresh local update either straight to the wire (online) or into
   * the durable journal (offline).
   */
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

  /** Seeds the in-memory footprint counters from an existing database. */
  private async ensureJournalCounters(): Promise<void> {
    if (this.countersLoaded || !this.journal) return;
    const stats = await this.journal.getStats(this.roomName);
    this.journaledRecords = stats.recordCount;
    this.journaledBytes = stats.totalBytes;
    this.countersLoaded = true;
  }

  /** Current connection state as tracked by the provider. */
  public get isConnected(): boolean {
    return this.connected;
  }

  /** Result of the most recent successful compaction, if any. */
  public get lastCompaction(): CanvasCompactionResult | null {
    return this.lastCompactionResult;
  }

  /**
   * Update connection state. Transitioning from offline to online triggers a
   * journal replay so queued blocks are flushed before live sync resumes.
   */
  public setConnected(connected: boolean): void {
    const wasOffline = !this.connected;
    this.connected = connected;
    if (connected && wasOffline && this.journal) {
      void this.replayJournal();
    }
  }

  /** Number of unconfirmed blocks currently buffered for this room. */
  public async pendingJournalCount(): Promise<number> {
    return this.journal ? this.journal.size(this.roomName) : 0;
  }

  /** Storage footprint of the journal and baseline snapshot for this room. */
  public async getJournalStats(): Promise<CanvasJournalStats | null> {
    return this.journal ? this.journal.getStats(this.roomName) : null;
  }

  /** Resolves once every queued offline journal write has settled. */
  public async flushPendingWrites(): Promise<void> {
    for (let guard = 0; guard < 1024 && this.pendingWrites.size > 0; guard++) {
      await Promise.all([...this.pendingWrites]);
    }
  }

  /**
   * Re-streams all pending journal blocks in topological (sequence) order,
   * verifying each block's checksum before it goes on the wire and clearing it
   * once acknowledged. If `remoteChecksum` is supplied, the local document
   * checksum is compared against it to confirm post-sync convergence.
   */
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

        // Nothing to stream to yet: keep the backlog for the next attempt.
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

  /** Checksum of the current local document state. */
  public getDocumentChecksum(): string {
    return computeChecksum(Y.encodeStateAsUpdate(this.doc));
  }

  /** True when the local document matches the supplied remote checksum. */
  public verifyConvergence(remoteChecksum: string): boolean {
    return this.getDocumentChecksum() === remoteChecksum;
  }

  /**
   * Encodes current Y.Doc transaction history into a single update blob using
   * `Y.encodeStateAsUpdate`, without touching storage.
   */
  public compactState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /**
   * Evaluates the configured 500-record / 5 MB thresholds and schedules a
   * background compaction when either is exceeded.
   *
   * @returns `true` when a compaction was scheduled by this call.
   */
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

  /** Resolves once any scheduled and in-flight compaction has settled. */
  public async waitForCompaction(): Promise<void> {
    for (let guard = 0; guard < 16; guard++) {
      const pending = this.scheduledCompaction ?? this.compactionInFlight;
      if (!pending) return;
      await pending;
    }
  }

  /**
   * Compacts the IndexedDB journal: encodes the full document into one
   * baseline snapshot, then atomically swaps it in for the raw records it
   * supersedes. The document is verified to round-trip both before the write
   * and after it is persisted.
   *
   * @returns the compaction result, or `null` when there is nothing to prune.
   */
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

    // Capture the journal boundary *before* encoding. Records appended while
    // we encode carry a higher sequence and are therefore never pruned by a
    // snapshot that predates them.
    const stats = await journal.getStats(this.roomName);
    if (stats.recordCount === 0) return null;

    // Hydrate the document from the stored baseline and every surviving block
    // before encoding. Without this a cold-started provider could snapshot a
    // partially restored document and prune history it never integrated.
    await this.restoreFromJournal();

    // --- Verify document state before compaction -------------------------
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

    // --- Atomic snapshot write + superseded history purge ----------------
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

    // --- Verify document state after compaction --------------------------
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

    // The live document must still cover everything the snapshot represents.
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

  /**
   * Applies `update` to a scratch document and asserts that it round-trips to
   * the same checksum and state vector.
   */
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

  /**
   * Flushes the compacted document snapshot to Redis storage and returns the
   * encoded bytes.
   */
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

  /**
   * Restores this room from its compacted baseline plus any journal blocks
   * that survived the last purge. A snapshot that fails checksum or state
   * vector verification is rejected instead of being applied.
   */
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

  /**
   * Loads the compacted snapshot for a joining peer and merges it into the
   * document.
   */
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

  /**
   * Defers a compaction to an idle callback so encoding and IndexedDB writes do
   * not compete with pointer/drawing events on the main thread.
   */
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
