 fix/canvas-provider-idb-memory-leak
﻿import * as Y from "yjs";
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

import * as Y from "yjs";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { redis } from "@/lib/redis";

/**
 * Offline change-journal replay buffer for decentralized canvas sync (#7528).
 *
 * When a nomad is editing a board over unstable mobile coverage the socket can
 * drop mid-edit. The journal persists every unconfirmed local transaction block
 * to IndexedDB (surviving browser restarts) and re-streams the backlog in
 * sequence order once the transport reconnects, before awareness sync resumes.
 * A per-block checksum plus a post-sync document checksum let peers detect
 * corruption and divergence instead of silently drifting apart.
 */

export const CANVAS_JOURNAL_DB = "worksphere-crdt-canvas-journal";
const JOURNAL_STORE = "journal";
const JOURNAL_META_STORE = "meta";
const JOURNAL_DB_VERSION = 1;

/** Sentinel transaction origin for updates that came from journal replay. */
export const JOURNAL_REPLAY_ORIGIN = "journal-replay";

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
}

interface CanvasJournalDB extends DBSchema {
  journal: {
    key: number;
    value: JournalBlock;
    indexes: { "by-room": string };
  };
  meta: {
    key: string;
    value: { roomName: string; lastSeq: number };
  };
}

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

/**
 * Durable, room-scoped append-only journal backed by IndexedDB.
 *
 * Sequence numbers are persisted in a companion `meta` store so they stay
 * monotonic across removals and browser restarts.
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
    await metaStore.put({ roomName: trimmed, lastSeq: seq });

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
      roomName,
    );
    return blocks.sort((a, b) => a.seq - b.seq);
  }

  async remove(seq: number): Promise<void> {
    const db = await this.getDb();
    await db.delete(JOURNAL_STORE, seq);
  }

  async clearRoom(roomName: string): Promise<void> {
    const db = await this.getDb();
    const blocks = await db.getAllFromIndex(
      JOURNAL_STORE,
      "by-room",
      roomName,
    );
    const tx = db.transaction(JOURNAL_STORE, "readwrite");
    await Promise.all([
      ...blocks.map((block) => tx.store.delete(block.seq)),
      tx.done,
    ]);
  }

  async size(roomName: string): Promise<number> {
    return (await this.listPending(roomName)).length;
  }
}

export class NomadCanvasProvider {
  public doc: Y.Doc;
  public roomName: string;
  public readonly journal: CanvasChangeJournal | null;
  private opCount: number = 0;
  private maxOps: number;
  private checkpointIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private transport?: CanvasTransport;
  private onReconnected?: (result: ReplayResult) => void;
  private connected: boolean;
  private replaying = false;

  constructor(roomName: string, config: CompactionConfig = {}) {
    this.roomName = roomName;
    this.doc = new Y.Doc();
    this.maxOps = config.maxOperations || 500;
    this.checkpointIntervalMs = config.checkpointIntervalMs || 5 * 60 * 1000;
    this.transport = config.transport;
    this.onReconnected = config.onReconnected;
    this.connected = config.transport ? config.transport.isConnected() : true;

    const journalEnabled =
      config.enableJournal ??
      (!!config.transport && typeof indexedDB !== "undefined");
    this.journal = journalEnabled
      ? new CanvasChangeJournal(config.journalDbName)
      : null;

    // Listen to local & remote update transactions
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.opCount++;
      if (this.opCount >= this.maxOps) {
        this.compactAndCheckpoint();
      }

      // Replayed blocks are already integrated; never re-journal them.
      if (origin === JOURNAL_REPLAY_ORIGIN) return;
      this.dispatchUpdate(update);
    });

    // Start periodic 5-minute compaction timer
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
    } else {
      void this.journalUpdate(update);
    }
  }

  private async journalUpdate(update: Uint8Array): Promise<void> {
    if (!this.journal) return;
    try {
      await this.journal.append(this.roomName, update);
    } catch (err) {
      console.error("[CRDT Journal] Failed to persist offline update:", err);
    }
  }

  /** Current connection state as tracked by the provider. */
  public get isConnected(): boolean {
    return this.connected;
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
   * Compacts current Y.Doc transaction history into a single update blob
   * using Y.encodeStateAsUpdate and flushes checkpoint state.
   */
  public compactState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /**
   * Flushes compacted document snapshot to Redis storage.
   */
  public async compactAndCheckpoint(): Promise<Uint8Array> {
    const compactedSnapshot = this.compactState();
    const redisKey = `crdt:room:${this.roomName}:snapshot`;

    try {
      if (redis && typeof (redis as any).set === "function") {
        // Store binary base64 string buffer in Redis
        const snapshotBase64 = Buffer.from(compactedSnapshot).toString("base64");
        await (redis as any).set(redisKey, snapshotBase64);
      }
      this.opCount = 0;
      console.log(`[CRDT Compaction] Checkpointed room snapshot: ${this.roomName}`);
    } catch (err) {
      console.error("[CRDT Compaction] Failed to flush snapshot to Redis:", err);
    }

    return compactedSnapshot;
  }

  /**
   * Loads compacted snapshot for a joining peer and merges state.
   */
  public async loadRoomSnapshot(): Promise<boolean> {
    const redisKey = `crdt:room:${this.roomName}:snapshot`;
    try {
      if (redis && typeof (redis as any).get === "function") {
        const snapshotBase64 = await (redis as any).get(redisKey);
        if (snapshotBase64) {
          const snapshotBuffer = Buffer.from(snapshotBase64, "base64");
          Y.applyUpdate(this.doc, new Uint8Array(snapshotBuffer));
          return true;
        }
      }
    } catch (err) {
      console.error("[CRDT Compaction] Error loading snapshot:", err);
    }
    return false;
  }

  private startPeriodicCheckpoint(): void {
    this.timer = setInterval(() => {
      if (this.opCount > 0) {
        this.compactAndCheckpoint();
      }
    }, this.checkpointIntervalMs);
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.doc.destroy();
 main
  }
}
