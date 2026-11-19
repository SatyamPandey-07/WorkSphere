/**
 * snapshotManager.ts
 * Periodic Yjs snapshot compaction for long-running collaborative whiteboards
 * and Monaco editor sessions (#7574).
 *
 * Without compaction a room's Yjs document retains every historical update in
 * its transaction history. Long sessions therefore grow unbounded in memory and
 * newly joining peers must replay thousands of updates before converging.
 *
 * This manager consolidates the live document into a single binary snapshot
 * (`Y.encodeStateAsUpdate`) every N operations or every checkpoint interval,
 * persists the snapshot, and safely purges the intermediate delta log that the
 * snapshot supersedes. Snapshots carry a deterministic checksum plus the encoded
 * state vector so a peer whose local clock has fallen behind the compacted
 * baseline can be detected and recovered.
 */

import * as Y from "yjs";
import {
  COMPRESSION_MAGIC_HEADER,
  compressYjsUpdate,
  decompressYjsUpdate,
} from "./yjsCompression";

/** Compact after this many local/remote transactions by default. */
export const DEFAULT_SNAPSHOT_OP_THRESHOLD = 500;
/** Compact at least this often while edits are happening (10 minutes). */
export const DEFAULT_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

/** A consolidated document snapshot persisted for a room. */
export interface StoredSnapshot {
  roomId: string;
  /** `Y.encodeStateAsUpdate(doc)` bytes (compressed when compression is enabled). */
  update: Uint8Array;
  /** `Y.encodeStateVector(doc)` bytes captured alongside the snapshot. */
  stateVector: Uint8Array;
  /** Deterministic checksum of uncompressed `update` for integrity verification. */
  checksum: string;
  /** Number of operations folded into this snapshot. */
  opsAtSnapshot: number;
  createdAt: number;
  /** Whether the update/stateVector payloads are compressed with LZ77. */
  isCompressed?: boolean;
  /** Uncompressed size in bytes if compressed. */
  uncompressedSize?: number;
}

/** A single un-compacted Yjs update awaiting consolidation. */
export interface StoredDelta {
  roomId: string;
  /** Monotonic per-room sequence number. */
  seq: number;
  update: Uint8Array;
  checksum: string;
  createdAt: number;
}

/** Durable storage contract for snapshots + intermediate deltas. */
export interface SnapshotStorage {
  saveSnapshot(snapshot: StoredSnapshot): Promise<void>;
  loadSnapshot(roomId: string): Promise<StoredSnapshot | null>;
  deleteSnapshot(roomId: string): Promise<void>;
  appendDelta(delta: StoredDelta): Promise<void>;
  listDeltas(roomId: string): Promise<StoredDelta[]>;
  /** Remove deltas with `seq <= throughSeq` once a snapshot covers them. */
  deleteDeltasThrough(roomId: string, throughSeq: number): Promise<void>;
  clearRoom(roomId: string): Promise<void>;
}

export interface SnapshotRecoveryResult {
  /** True when applying the baseline changed the local document. */
  recovered: boolean;
  /** True when the local state clock lagged the compacted baseline. */
  behindCompactedBaseline: boolean;
  /** Checksum of the stored baseline snapshot. */
  baselineChecksum: string;
  /** Checksum of the local document after recovery. */
  checksum: string;
  /** Number of post-baseline deltas replayed. */
  appliedDeltas: number;
  /** True when the local state now covers the compacted baseline. */
  converged: boolean;
}

/** Thrown when a stored snapshot fails checksum verification. */
export class SnapshotIntegrityError extends Error {
  constructor(message = "Stored snapshot failed checksum verification") {
    super(message);
    this.name = "SnapshotIntegrityError";
  }
}

/**
 * FNV-1a 64-bit hash rendered as a zero-padded hex string. Deterministic and
 * dependency-free so browser and server peers compute identical checksums for
 * byte-identical `Y.encodeStateAsUpdate` output.
 */
export function computeSnapshotChecksum(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** True when `local` is missing changes that `remote` state vector contains. */
export function isStateVectorBehind(
  local: Uint8Array,
  remote: Uint8Array,
): boolean {
  const localClock = Y.decodeStateVector(local);
  const remoteClock = Y.decodeStateVector(remote);
  for (const [clientId, clock] of remoteClock) {
    if ((localClock.get(clientId) ?? 0) < clock) return true;
  }
  return false;
}

/** Base64 encoding that works in both Node.js and the browser. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Base64 decoding that works in both Node.js and the browser. */
export function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface SerializedSnapshot {
  roomId: string;
  update: string;
  stateVector: string;
  checksum: string;
  opsAtSnapshot: number;
  createdAt: number;
  isCompressed?: boolean;
  uncompressedSize?: number;
}

export interface SerializedDelta {
  roomId: string;
  seq: number;
  update: string;
  checksum: string;
  createdAt: number;
}

export function serializeSnapshot(
  snapshot: StoredSnapshot,
): SerializedSnapshot {
  return {
    ...snapshot,
    update: bytesToBase64(snapshot.update),
    stateVector: bytesToBase64(snapshot.stateVector),
    isCompressed: snapshot.isCompressed,
    uncompressedSize: snapshot.uncompressedSize,
  };
}

export function deserializeSnapshot(
  snapshot: SerializedSnapshot,
): StoredSnapshot {
  return {
    ...snapshot,
    update: base64ToBytes(snapshot.update),
    stateVector: base64ToBytes(snapshot.stateVector),
    isCompressed: snapshot.isCompressed,
    uncompressedSize: snapshot.uncompressedSize,
  };
}

/**
 * Detects whether a binary payload has the Yjs compression magic header.
 */
export function isCompressedPayload(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < COMPRESSION_MAGIC_HEADER.length) return false;
  for (let i = 0; i < COMPRESSION_MAGIC_HEADER.length; i++) {
    if (bytes[i] !== COMPRESSION_MAGIC_HEADER[i]) return false;
  }
  return true;
}

/**
 * Ensures a stored snapshot has uncompressed update and stateVector bytes.
 * If already uncompressed, returns the snapshot unmodified.
 */
export function decompressSnapshot(snapshot: StoredSnapshot): StoredSnapshot {
  const decompressedUpdate = isCompressedPayload(snapshot.update)
    ? decompressYjsUpdate(snapshot.update)
    : snapshot.update;
  const decompressedStateVector = isCompressedPayload(snapshot.stateVector)
    ? decompressYjsUpdate(snapshot.stateVector)
    : snapshot.stateVector;

  return {
    ...snapshot,
    update: decompressedUpdate,
    stateVector: decompressedStateVector,
    isCompressed: false,
    uncompressedSize: decompressedUpdate.length,
  };
}

export function serializeDelta(delta: StoredDelta): SerializedDelta {
  return { ...delta, update: bytesToBase64(delta.update) };
}

export function deserializeDelta(delta: SerializedDelta): StoredDelta {
  return { ...delta, update: base64ToBytes(delta.update) };
}

/**
 * Process-local storage used by tests and as a fallback when Redis/PostgreSQL
 * is not configured. Snapshots survive only for the lifetime of the process.
 */
export class InMemorySnapshotStorage implements SnapshotStorage {
  private snapshots = new Map<string, StoredSnapshot>();
  private deltas = new Map<string, StoredDelta[]>();

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    this.snapshots.set(snapshot.roomId, snapshot);
  }

  async loadSnapshot(roomId: string): Promise<StoredSnapshot | null> {
    return this.snapshots.get(roomId) ?? null;
  }

  async deleteSnapshot(roomId: string): Promise<void> {
    this.snapshots.delete(roomId);
  }

  async appendDelta(delta: StoredDelta): Promise<void> {
    const existing = this.deltas.get(delta.roomId) ?? [];
    existing.push(delta);
    this.deltas.set(delta.roomId, existing);
  }

  async listDeltas(roomId: string): Promise<StoredDelta[]> {
    return [...(this.deltas.get(roomId) ?? [])].sort((a, b) => a.seq - b.seq);
  }

  async deleteDeltasThrough(roomId: string, throughSeq: number): Promise<void> {
    const existing = this.deltas.get(roomId) ?? [];
    const remaining = existing.filter((delta) => delta.seq > throughSeq);
    if (remaining.length > 0) {
      this.deltas.set(roomId, remaining);
    } else {
      this.deltas.delete(roomId);
    }
  }

  async clearRoom(roomId: string): Promise<void> {
    this.snapshots.delete(roomId);
    this.deltas.delete(roomId);
  }
}

interface RedisLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

interface RedisRoomRecord {
  snapshot: SerializedSnapshot | null;
  deltas: SerializedDelta[];
}

const REDIS_ROOM_KEY_PREFIX = "crdt:whiteboard:";

function redisRoomKey(roomId: string): string {
  return `${REDIS_ROOM_KEY_PREFIX}${roomId}`;
}

/**
 * Redis-backed storage. Each room is persisted as one JSON record containing
 * the current baseline snapshot and its pending deltas, so a compaction
 * atomically replaces the baseline and drops the superseded delta log.
 */
export class RedisSnapshotStorage implements SnapshotStorage {
  constructor(private readonly client: RedisLike) {}

  private async read(roomId: string): Promise<RedisRoomRecord> {
    const raw = await this.client.get(redisRoomKey(roomId));
    if (!raw) return { snapshot: null, deltas: [] };
    if (typeof raw === "string") {
      return JSON.parse(raw) as RedisRoomRecord;
    }
    return raw as RedisRoomRecord;
  }

  private async write(roomId: string, record: RedisRoomRecord): Promise<void> {
    await this.client.set(redisRoomKey(roomId), JSON.stringify(record));
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    const record = await this.read(snapshot.roomId);
    record.snapshot = serializeSnapshot(snapshot);
    await this.write(snapshot.roomId, record);
  }

  async loadSnapshot(roomId: string): Promise<StoredSnapshot | null> {
    const record = await this.read(roomId);
    return record.snapshot ? deserializeSnapshot(record.snapshot) : null;
  }

  async deleteSnapshot(roomId: string): Promise<void> {
    const record = await this.read(roomId);
    record.snapshot = null;
    await this.write(roomId, record);
  }

  async appendDelta(delta: StoredDelta): Promise<void> {
    const record = await this.read(delta.roomId);
    record.deltas.push(serializeDelta(delta));
    await this.write(delta.roomId, record);
  }

  async listDeltas(roomId: string): Promise<StoredDelta[]> {
    const record = await this.read(roomId);
    return record.deltas
      .map(deserializeDelta)
      .sort((a, b) => a.seq - b.seq);
  }

  async deleteDeltasThrough(roomId: string, throughSeq: number): Promise<void> {
    const record = await this.read(roomId);
    record.deltas = record.deltas.filter((delta) => delta.seq > throughSeq);
    await this.write(roomId, record);
  }

  async clearRoom(roomId: string): Promise<void> {
    await this.client.del(redisRoomKey(roomId));
  }
}

/** Create a Redis-backed snapshot store from an Upstash/ioredis-like client. */
export function createRedisSnapshotStorage(client: RedisLike): SnapshotStorage {
  return new RedisSnapshotStorage(client);
}

export interface HttpSnapshotStorageOptions {
  /** API base URL. Defaults to the same-origin `/api/whiteboard` route. */
  baseUrl?: string;
  /** Injectable fetch for tests / non-browser runtimes. */
  fetchImpl?: typeof fetch;
}

/**
 * Snapshot storage that talks to `/api/whiteboard` so browser clients persist
 * compacted snapshots without bundling a database driver.
 */
export function createHttpSnapshotStorage(
  options: HttpSnapshotStorageOptions = {},
): SnapshotStorage {
  const baseUrl = options.baseUrl ?? "/api/whiteboard";
  const fetchImpl = options.fetchImpl ?? fetch;

  const post = async (body: Record<string, unknown>): Promise<any> => {
    const response = await fetchImpl(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Snapshot request failed with status ${response.status}`);
    }
    return response.json();
  };

  return {
    async saveSnapshot(snapshot) {
      await post({ action: "snapshot", snapshot: serializeSnapshot(snapshot) });
    },
    async loadSnapshot(roomId) {
      const response = await fetchImpl(
        `${baseUrl}?roomId=${encodeURIComponent(roomId)}&action=snapshot`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      return data.snapshot ? deserializeSnapshot(data.snapshot) : null;
    },
    async deleteSnapshot(roomId) {
      await post({ action: "deleteSnapshot", roomId });
    },
    async appendDelta(delta) {
      await post({ action: "delta", delta: serializeDelta(delta) });
    },
    async listDeltas(roomId) {
      const response = await fetchImpl(
        `${baseUrl}?roomId=${encodeURIComponent(roomId)}&action=deltas`,
      );
      if (!response.ok) return [];
      const data = await response.json();
      return (data.deltas ?? []).map(deserializeDelta);
    },
    async deleteDeltasThrough(roomId, throughSeq) {
      await post({ action: "purgeDeltas", roomId, throughSeq });
    },
    async clearRoom(roomId) {
      await fetchImpl(`${baseUrl}?roomId=${encodeURIComponent(roomId)}`, {
        method: "DELETE",
      });
    },
  };
}

export interface SnapshotManagerOptions {
  doc: Y.Doc;
  roomId: string;
  storage?: SnapshotStorage;
  /** Compact after this many transactions. Default 500. */
  opThreshold?: number;
  /** Background checkpoint interval while edits are pending. Default 10 min. */
  intervalMs?: number;
  /** Whether to compress snapshots with LZ77 wire codec. Default true. */
  compressSnapshots?: boolean;
  /** Minimum byte threshold before applying compression. Default 256 bytes. */
  compressionThresholdBytes?: number;
  /** Clock injection for deterministic tests. */
  now?: () => number;
  /** Called after each successful compaction. */
  onCompacted?: (snapshot: StoredSnapshot) => void;
  /** Called when background persistence fails. */
  onError?: (error: unknown) => void;
}

/**
 * Watches a Y.Doc, buffers intermediate deltas, and periodically consolidates
 * the live document into a compact snapshot. `doc.gc = true` is enforced so
 * deleted canvas nodes / text buffers are reclaimed between checkpoints.
 */
export class SnapshotManager {
  public readonly doc: Y.Doc;
  public readonly roomId: string;
  private readonly storage: SnapshotStorage;
  private readonly opThreshold: number;
  private readonly intervalMs: number;
  private readonly compressSnapshots: boolean;
  private readonly compressionThresholdBytes: number;
  private readonly now: () => number;
  private readonly onCompacted?: (snapshot: StoredSnapshot) => void;
  private readonly onError?: (error: unknown) => void;

  private opsSinceSnapshot = 0;
  private nextDeltaSeq = 1;
  private pendingDeltas: StoredDelta[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private compactionInFlight: Promise<StoredSnapshot> | null = null;
  private applyingBaseline = false;
  private destroyed = false;

  private readonly handleUpdate = (update: Uint8Array) => {
    if (this.destroyed || this.applyingBaseline) return;

    this.opsSinceSnapshot += 1;
    this.pendingDeltas.push({
      roomId: this.roomId,
      seq: this.nextDeltaSeq++,
      update: update.slice(),
      checksum: computeSnapshotChecksum(update),
      createdAt: this.now(),
    });

    if (this.opsSinceSnapshot >= this.opThreshold) {
      void this.compact().catch((error) => this.reportError(error));
    }
  };

  constructor(options: SnapshotManagerOptions) {
    this.doc = options.doc;
    this.roomId = options.roomId;
    this.storage = options.storage ?? new InMemorySnapshotStorage();
    this.opThreshold = Math.max(
      1,
      Math.floor(options.opThreshold ?? DEFAULT_SNAPSHOT_OP_THRESHOLD),
    );
    this.intervalMs = Math.max(
      0,
      Math.floor(options.intervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS),
    );
    this.compressSnapshots = options.compressSnapshots ?? true;
    this.compressionThresholdBytes = Math.max(
      0,
      Math.floor(options.compressionThresholdBytes ?? 256),
    );
    this.now = options.now ?? Date.now;
    this.onCompacted = options.onCompacted;
    this.onError = options.onError;

    // Reclaim tombstones/deleted text between checkpoints. Without this the
    // document keeps deleted canvas nodes alive for the entire session.
    this.doc.gc = true;
    this.doc.on("update", this.handleUpdate);
  }

  /** Number of transactions recorded since the last snapshot. */
  public get pendingOperationCount(): number {
    return this.opsSinceSnapshot;
  }

  /** Current checksum of the live document state. */
  public getDocumentChecksum(): string {
    return computeSnapshotChecksum(Y.encodeStateAsUpdate(this.doc));
  }

  /** Begin periodic background checkpointing. */
  public start(): void {
    if (this.destroyed || this.timer !== null || this.intervalMs <= 0) return;
    const timer: ReturnType<typeof setInterval> & { unref?: () => void } =
      setInterval(() => {
        if (this.opsSinceSnapshot > 0) {
          void this.compact().catch((error) => this.reportError(error));
        }
      }, this.intervalMs);
    timer.unref?.();
    this.timer = timer;
  }

  /** Stop periodic checkpointing (does not destroy the document). */
  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Flush buffered deltas to storage without creating a snapshot. */
  public async flushDeltas(): Promise<number> {
    if (this.pendingDeltas.length === 0) return 0;
    const buffered = this.pendingDeltas;
    this.pendingDeltas = [];
    for (const delta of buffered) {
      await this.storage.appendDelta(delta);
    }
    return buffered.length;
  }

  /**
   * Consolidates the document into one snapshot, persists it, then safely
   * purges every delta that the snapshot now supersedes.
   */
  public async compact(): Promise<StoredSnapshot> {
    if (this.compactionInFlight) return this.compactionInFlight;

    const task = (async (): Promise<StoredSnapshot> => {
      // Persist pending deltas first so a crash between snapshot write and
      // delta purge can still reconstruct the post-snapshot state. Capture
      // the boundary before flushing: updates that land during the awaits
      // below stay buffered and are *not* covered by this snapshot's purge.
      const flushedThroughSeq = this.nextDeltaSeq - 1;
      const flushedCount = await this.flushDeltas();

      const uncompressedUpdate = Y.encodeStateAsUpdate(this.doc);
      const uncompressedStateVector = Y.encodeStateVector(this.doc);
      const checksum = computeSnapshotChecksum(uncompressedUpdate);

      let update = uncompressedUpdate;
      let stateVector = uncompressedStateVector;
      let isCompressed = false;

      if (
        this.compressSnapshots &&
        uncompressedUpdate.length >= this.compressionThresholdBytes
      ) {
        const compressed = compressYjsUpdate(uncompressedUpdate);
        if (isCompressedPayload(compressed)) {
          update = compressed;
          isCompressed = true;
        }
      }

      if (
        this.compressSnapshots &&
        uncompressedStateVector.length >= this.compressionThresholdBytes
      ) {
        const compressed = compressYjsUpdate(uncompressedStateVector);
        if (isCompressedPayload(compressed)) {
          stateVector = compressed;
        }
      }

      const snapshot: StoredSnapshot = {
        roomId: this.roomId,
        update,
        stateVector,
        checksum,
        opsAtSnapshot: this.opsSinceSnapshot,
        createdAt: this.now(),
        isCompressed: isCompressed || isCompressedPayload(stateVector),
        uncompressedSize: uncompressedUpdate.length,
      };

      await this.storage.saveSnapshot(snapshot);

      if (flushedThroughSeq > 0) {
        await this.storage.deleteDeltasThrough(
          this.roomId,
          flushedThroughSeq,
        );
      }

      // Only retire the operations folded into this snapshot; keep counting
      // transactions that arrived while the async writes were in flight.
      this.opsSinceSnapshot = Math.max(
        0,
        this.opsSinceSnapshot - flushedCount,
      );
      this.onCompacted?.(snapshot);
      return snapshot;
    })();

    this.compactionInFlight = task;
    try {
      return await task;
    } finally {
      this.compactionInFlight = null;
    }
  }

  /**
   * Loads the stored baseline snapshot for this room, transparently decompressed.
   */
  public async loadSnapshot(): Promise<StoredSnapshot | null> {
    const raw = await this.storage.loadSnapshot(this.roomId);
    return raw ? decompressSnapshot(raw) : null;
  }

  /**
   * Loads the compacted baseline plus any newer deltas for a joining or
   * lagging peer, verifies integrity, and merges them into the local document.
   */
  public async recover(): Promise<SnapshotRecoveryResult> {
    const rawBaseline = await this.storage.loadSnapshot(this.roomId);
    const localBefore = this.getDocumentChecksum();

    if (!rawBaseline) {
      return {
        recovered: false,
        behindCompactedBaseline: false,
        baselineChecksum: "",
        checksum: localBefore,
        appliedDeltas: 0,
        converged: true,
      };
    }

    const baseline = decompressSnapshot(rawBaseline);

    const uncompressedChecksum = computeSnapshotChecksum(baseline.update);
    const rawChecksum = computeSnapshotChecksum(rawBaseline.update);

    if (
      baseline.checksum !== uncompressedChecksum &&
      baseline.checksum !== rawChecksum
    ) {
      throw new SnapshotIntegrityError(
        `Snapshot for room ${this.roomId} failed checksum verification`,
      );
    }

    const behindCompactedBaseline = isStateVectorBehind(
      Y.encodeStateVector(this.doc),
      baseline.stateVector,
    );

    this.applyingBaseline = true;
    try {
      Y.applyUpdate(this.doc, baseline.update, "snapshot-recovery");

      const deltas = await this.storage.listDeltas(this.roomId);
      let appliedDeltas = 0;
      for (const delta of deltas.sort((a, b) => a.seq - b.seq)) {
        const deltaUpdate = isCompressedPayload(delta.update)
          ? decompressYjsUpdate(delta.update)
          : delta.update;

        const deltaUncompressedChecksum = computeSnapshotChecksum(deltaUpdate);
        const deltaRawChecksum = computeSnapshotChecksum(delta.update);

        if (
          delta.checksum !== deltaUncompressedChecksum &&
          delta.checksum !== deltaRawChecksum
        ) {
          console.warn(
            `[SnapshotManager] Dropping corrupt delta #${delta.seq} for room ${this.roomId}`,
          );
          continue;
        }
        Y.applyUpdate(this.doc, deltaUpdate, "snapshot-recovery");
        appliedDeltas += 1;
      }

      const checksum = this.getDocumentChecksum();
      const converged = !isStateVectorBehind(
        Y.encodeStateVector(this.doc),
        baseline.stateVector,
      );

      return {
        recovered: checksum !== localBefore,
        behindCompactedBaseline,
        baselineChecksum: baseline.checksum,
        checksum,
        appliedDeltas,
        converged,
      };
    } finally {
      this.applyingBaseline = false;
    }
  }

  /** Detach listeners, stop timers and flush any buffered deltas. */
  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.doc.off("update", this.handleUpdate);
    try {
      await this.flushDeltas();
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    if (this.onError) {
      this.onError(error);
      return;
    }
    console.error("[SnapshotManager] Background compaction failed:", error);
  }
}
