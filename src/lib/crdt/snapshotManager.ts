import {
  nowMs,
  recordCompression,
  recordDecompression,
} from "./compressionTelemetry";
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
 *
 * Concurrency safety (#9166): snapshot compaction (compact) and peer recovery
 * (recover) can interleave at async yield points. If compact evicts delta
 * buffers while recover is mid-replay the Yjs decoder can see a premature end
 * of update error. An AsyncRWLock serialises the GC phase of compact against
 * all in-flight recover operations: recover holds a shared read lock while
 * applying updates; compact acquires an exclusive write lock before it deletes
 * any deltas, ensuring no GC occurs while a reader still holds references to
 * those buffers.
 */

/**
 * Minimal async read/write lock — no external dependencies required.
 *
 * Multiple concurrent readers are allowed; a writer waits until all readers
 * have released before proceeding, and no new readers are admitted while a
 * writer is queued.  Lock acquisition is exception-safe: the returned release
 * function must be called in a finally block.
 *
 * JavaScript is single-threaded but async functions yield at every `await`.
 * This is therefore an *async* mutual-exclusion primitive built on Promises,
 * not OS threads or shared memory.
 *
 * @internal
 */
class AsyncRWLock {
  private readers = 0;
  private writerActive = false;
  private readonly writeQueue: Array<() => void> = [];
  private readonly readQueue: Array<() => void> = [];

  /**
   * Acquires a shared read lock.  Returns a release function; call it in a
   * finally block to prevent lock starvation if the reader throws.
   */
  acquireRead(): Promise<() => void> {
    // Readers are blocked while a writer is active or queued.
    if (!this.writerActive && this.writeQueue.length === 0) {
      this.readers += 1;
      return Promise.resolve(this.releaseRead.bind(this));
    }
    return new Promise<() => void>((resolve) => {
      this.readQueue.push(() => {
        this.readers += 1;
        resolve(this.releaseRead.bind(this));
      });
    });
  }

  private releaseRead(): void {
    this.readers -= 1;
    this.drainQueues();
  }

  /**
   * Acquires an exclusive write lock.  Returns a release function; call it in
   * a finally block.
   */
  acquireWrite(): Promise<() => void> {
    if (!this.writerActive && this.readers === 0) {
      this.writerActive = true;
      return Promise.resolve(this.releaseWrite.bind(this));
    }
    return new Promise<() => void>((resolve) => {
      this.writeQueue.push(() => {
        this.writerActive = true;
        resolve(this.releaseWrite.bind(this));
      });
    });
  }

  private releaseWrite(): void {
    this.writerActive = false;
    this.drainQueues();
  }

  private drainQueues(): void {
    // A pending writer takes priority so long-running read floods cannot
    // starve it indefinitely.
    if (this.writeQueue.length > 0 && this.readers === 0 && !this.writerActive) {
      const next = this.writeQueue.shift()!;
      next();
      return;
    }
    // No pending or active writer — flush all waiting readers.
    if (!this.writerActive && this.writeQueue.length === 0) {
      while (this.readQueue.length > 0) {
        const next = this.readQueue.shift()!;
        next();
      }
    }
  }
}

import * as Y from "yjs";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  COMPRESSION_MAGIC_HEADER,
  compressYjsUpdate,
  decompressYjsUpdate,
} from "./yjsCompression";

/** Magic header for gzip-compressed snapshot payloads: 'Y' 'Z' 'G' 0x01 */
export const GZIP_MAGIC_HEADER = new Uint8Array([0x59, 0x5a, 0x47, 0x01]);

/**
 * Compresses an input Uint8Array payload using gzip with fallback to Node.js zlib when available.
 * Prepends GZIP_MAGIC_HEADER and 4-byte BigEndian uncompressed size.
 */
export async function compressYjsGzip(input: Uint8Array): Promise<Uint8Array> {
  if (!input || input.length === 0) {
    return new Uint8Array(0);
  }
  if (isGzipCompressedPayload(input)) {
    return input; // Prevent double-compression
  }

  let compressedBody: Uint8Array;
  if (typeof CompressionStream === "function") {
    try {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const writing = writer.write(input as BufferSource).then(() => writer.close());
      writing.catch(() => {});

      const reader = cs.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      await writing;

      compressedBody = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        compressedBody.set(chunk, offset);
        offset += chunk.length;
      }
    } catch {
      // Fallback below
      compressedBody = compressGzipFallback(input);
    }
  } else {
    compressedBody = compressGzipFallback(input);
  }

  if (compressedBody.length === 0 && input.length > 0) {
    return input;
  }

  const headerLen = GZIP_MAGIC_HEADER.length;
  const output = new Uint8Array(headerLen + 4 + compressedBody.length);
  output.set(GZIP_MAGIC_HEADER, 0);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  view.setUint32(headerLen, input.length, false);
  output.set(compressedBody, headerLen + 4);
  return output;
}

function compressGzipFallback(input: Uint8Array): Uint8Array {
  try {
    if (typeof require !== "undefined") {
      const zlib = require("zlib");
      if (typeof zlib.gzipSync === "function") {
        return new Uint8Array(zlib.gzipSync(Buffer.from(input)));
      }
    }
  } catch {
    // Environment without zlib fallback
  }
  return new Uint8Array(0);
}

/**
 * Decompresses a gzip-compressed Yjs payload, transparently returning original bytes
 * if uncompressed or header does not match.
 */
export async function decompressYjsGzip(input: Uint8Array): Promise<Uint8Array> {
  if (!input || input.length < GZIP_MAGIC_HEADER.length + 4) {
    return input ?? new Uint8Array(0);
  }
  if (!isGzipCompressedPayload(input)) {
    return input;
  }

  const headerLen = GZIP_MAGIC_HEADER.length;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const uncompressedSize = view.getUint32(headerLen, false);
  const compressedBody = input.subarray(headerLen + 4);

  if (typeof DecompressionStream === "function") {
    try {
      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      const writing = writer.write(compressedBody as BufferSource).then(() => writer.close());
      writing.catch(() => {});

      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      await writing;

      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    } catch {
      return decompressGzipFallback(compressedBody, uncompressedSize);
    }
  } else {
    return decompressGzipFallback(compressedBody, uncompressedSize);
  }
}

function decompressGzipFallback(compressedBody: Uint8Array, uncompressedSize: number): Uint8Array {
  try {
    if (typeof require !== "undefined") {
      const zlib = require("zlib");
      if (typeof zlib.gunzipSync === "function") {
        return new Uint8Array(zlib.gunzipSync(Buffer.from(compressedBody)));
      }
    }
  } catch {
    // Environment without zlib fallback
  }
  return compressedBody;
}

/**
 * Synchronous decompression fallback for environments/callsites needing synchronous decompression.
 */
export function decompressYjsGzipSync(input: Uint8Array): Uint8Array {
  if (!input || input.length < GZIP_MAGIC_HEADER.length + 4) {
    return input ?? new Uint8Array(0);
  }
  if (!isGzipCompressedPayload(input)) {
    return input;
  }
  const headerLen = GZIP_MAGIC_HEADER.length;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const uncompressedSize = view.getUint32(headerLen, false);
  const compressedBody = input.subarray(headerLen + 4);
  return decompressGzipFallback(compressedBody, uncompressedSize);
}

/** Check if two state vectors represent equivalent clock states. */
export function stateVectorsEqual(left: Uint8Array, right: Uint8Array): boolean {
  const leftClock = Y.decodeStateVector(left);
  const rightClock = Y.decodeStateVector(right);
  if (leftClock.size !== rightClock.size) return false;
  for (const [clientId, clock] of leftClock) {
    if ((rightClock.get(clientId) ?? 0) !== clock) return false;
  }
  return true;
}

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
  if (!bytes) return false;
  if (isGzipCompressedPayload(bytes)) return true;
  if (bytes.length < COMPRESSION_MAGIC_HEADER.length) return false;
  for (let i = 0; i < COMPRESSION_MAGIC_HEADER.length; i++) {
    if (bytes[i] !== COMPRESSION_MAGIC_HEADER[i]) return false;
  }
  return true;
}

/**
 * Detects whether a binary payload has the gzip magic header.
 */
export function isGzipCompressedPayload(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < GZIP_MAGIC_HEADER.length + 4) return false;
  for (let i = 0; i < GZIP_MAGIC_HEADER.length; i++) {
    if (bytes[i] !== GZIP_MAGIC_HEADER[i]) return false;
  }
  return true;
}

/**
 * Ensures a stored snapshot has uncompressed update and stateVector bytes.
 * If already uncompressed, returns the snapshot unmodified.
 */
export function decompressSnapshot(snapshot: StoredSnapshot): StoredSnapshot {
  const decompressStartedAt = nowMs();
  const updateWasCompressed = isCompressedPayload(snapshot.update);
  let decompressedUpdate = snapshot.update;
  if (isGzipCompressedPayload(snapshot.update)) {
    decompressedUpdate = decompressYjsGzipSync(snapshot.update);
  } else if (isCompressedPayload(snapshot.update)) {
    decompressedUpdate = decompressYjsUpdate(snapshot.update);
  }

  let decompressedStateVector = snapshot.stateVector;
  if (isGzipCompressedPayload(snapshot.stateVector)) {
    decompressedStateVector = decompressYjsGzipSync(snapshot.stateVector);
  } else if (isCompressedPayload(snapshot.stateVector)) {
    decompressedStateVector = decompressYjsUpdate(snapshot.stateVector);
  }

  if (updateWasCompressed) {
    recordDecompression(
      snapshot.update.length,
      decompressedUpdate.length,
      nowMs() - decompressStartedAt,
    );
  }

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
    return record.deltas.map(deserializeDelta).sort((a, b) => a.seq - b.seq);
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

interface SnapshotDB extends DBSchema {
  snapshots: {
    key: string;
    value: StoredSnapshot;
  };
  deltas: {
    key: number;
    value: StoredDelta;
    indexes: { by_room_seq: [string, number] };
  };
}

const DEFAULT_IDB_NAME = "worksphere-whiteboard-crdt-snapshots";
const IDB_VERSION = 1;

/**
 * IndexedDB-backed durable storage contract for snapshots + intermediate deltas.
 */
export class IndexedDBSnapshotStorage implements SnapshotStorage {
  private dbPromise: Promise<IDBPDatabase<SnapshotDB>> | null = null;

  constructor(private readonly dbName: string = DEFAULT_IDB_NAME) {}

  private getDb(): Promise<IDBPDatabase<SnapshotDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<SnapshotDB>(this.dbName, IDB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("snapshots")) {
            db.createObjectStore("snapshots", { keyPath: "roomId" });
          }
          if (!db.objectStoreNames.contains("deltas")) {
            const deltaStore = db.createObjectStore("deltas", {
              keyPath: "id",
              autoIncrement: true,
            });
            deltaStore.createIndex("by_room_seq", ["roomId", "seq"]);
          }
        },
      });
    }
    return this.dbPromise;
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    const db = await this.getDb();
    await db.put("snapshots", snapshot);
  }

  async loadSnapshot(roomId: string): Promise<StoredSnapshot | null> {
    const db = await this.getDb();
    const result = await db.get("snapshots", roomId);
    return result ?? null;
  }

  async deleteSnapshot(roomId: string): Promise<void> {
    const db = await this.getDb();
    await db.delete("snapshots", roomId);
  }

  async appendDelta(delta: StoredDelta): Promise<void> {
    const db = await this.getDb();
    await db.add("deltas", delta as StoredDelta & { id?: number });
  }

  async listDeltas(roomId: string): Promise<StoredDelta[]> {
    const db = await this.getDb();
    const range = IDBKeyRange.bound([roomId, -Infinity], [roomId, Infinity]);
    const deltas = await db.getAllFromIndex("deltas", "by_room_seq", range);
    return deltas.sort((a, b) => a.seq - b.seq);
  }

  async deleteDeltasThrough(roomId: string, throughSeq: number): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction("deltas", "readwrite");
    const index = tx.store.index("by_room_seq");
    const range = IDBKeyRange.bound([roomId, -Infinity], [roomId, throughSeq]);
    let cursor = await index.openCursor(range);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async clearRoom(roomId: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(["snapshots", "deltas"], "readwrite");
    await tx.objectStore("snapshots").delete(roomId);
    const index = tx.objectStore("deltas").index("by_room_seq");
    const range = IDBKeyRange.bound([roomId, -Infinity], [roomId, Infinity]);
    let cursor = await index.openCursor(range);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
    }
  }
}

/** Create an IndexedDB-backed snapshot store. */
export function createIndexedDBSnapshotStorage(
  dbName: string = DEFAULT_IDB_NAME,
): SnapshotStorage {
  return new IndexedDBSnapshotStorage(dbName);
}

export interface SnapshotManagerOptions {
  doc: Y.Doc;
  roomId: string;
  storage?: SnapshotStorage;
  /** Compact after this many transactions. Default 500. */
  opThreshold?: number;
  /** Background checkpoint interval while edits are pending. Default 10 min. */
  intervalMs?: number;
  /** Whether to compress snapshots. Default true. */
  compressSnapshots?: boolean;
  /** Compression format to use: 'gzip' (CompressionStream) or 'lz77'. Default 'lz77'. */
  compressionAlgorithm?: "gzip" | "lz77";
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
  private readonly compressionAlgorithm: "gzip" | "lz77";
  private readonly compressionThresholdBytes: number;
  private readonly now: () => number;
  private readonly onCompacted?: (snapshot: StoredSnapshot) => void;
  private readonly onError?: (error: unknown) => void;

  private lastStateVector: Uint8Array | null = null;
  private opsSinceSnapshot = 0;
  private nextDeltaSeq = 1;
  private pendingDeltas: StoredDelta[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private compactionInFlight: Promise<StoredSnapshot> | null = null;
  private applyingBaseline = false;
  private destroyed = false;

  /**
   * Guards snapshot GC (delta buffer eviction) against concurrent in-flight
   * recover() calls (#9166).  recover() holds a shared read lock while it
   * replays deltas so compact() must wait for all readers to drain before it
   * evicts the delta log.
   */
  private readonly gcLock = new AsyncRWLock();

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
    this.compressionAlgorithm = options.compressionAlgorithm ?? "lz77";
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

      // Check previous checkpoint's state vector if available
      const currentStateVector = Y.encodeStateVector(this.doc);
      if (this.lastStateVector && stateVectorsEqual(this.lastStateVector, currentStateVector)) {
        // No missing changes relative to the checkpoint; load existing snapshot if present
        const existing = await this.storage.loadSnapshot(this.roomId);
        if (existing) {
          if (flushedThroughSeq > 0) {
            const releaseWrite = await this.gcLock.acquireWrite();
            try {
              await this.storage.deleteDeltasThrough(this.roomId, flushedThroughSeq);
            } finally {
              releaseWrite();
            }
          }
          this.opsSinceSnapshot = Math.max(0, this.opsSinceSnapshot - flushedCount);
          return existing;
        }
      }

      // Generate differential update relative to previous checkpoint if available
      let uncompressedUpdate: Uint8Array;
      if (this.lastStateVector) {
        // Differential update containing only missing changes relative to checkpoint
        const diffUpdate = Y.encodeStateAsUpdate(this.doc, this.lastStateVector);
        const existing = await this.storage.loadSnapshot(this.roomId);
        if (existing) {
          const prevDecompressed = decompressSnapshot(existing);
          uncompressedUpdate = Y.mergeUpdates([prevDecompressed.update, diffUpdate]);
        } else {
          uncompressedUpdate = Y.encodeStateAsUpdate(this.doc);
        }
      } else {
        uncompressedUpdate = Y.encodeStateAsUpdate(this.doc);
      }
      const uncompressedStateVector = currentStateVector;
      const checksum = computeSnapshotChecksum(uncompressedUpdate);

      let update = uncompressedUpdate;
      let stateVector = uncompressedStateVector;
      let isCompressed = false;

      if (
        this.compressSnapshots &&
        uncompressedUpdate.length >= this.compressionThresholdBytes
      ) {
        const compressStartedAt = nowMs();
        let compressed: Uint8Array;
        if (this.compressionAlgorithm === "gzip") {
          compressed = await compressYjsGzip(uncompressedUpdate);
        } else {
          compressed = compressYjsUpdate(uncompressedUpdate);
        }
        const compressDurationMs = nowMs() - compressStartedAt;
        if (isCompressedPayload(compressed) && compressed.length < uncompressedUpdate.length) {
          recordCompression(
            uncompressedUpdate.length,
            compressed.length,
            compressDurationMs,
          );
          update = compressed;
          isCompressed = true;
        }
      }

      if (
        this.compressSnapshots &&
        uncompressedStateVector.length >= this.compressionThresholdBytes
      ) {
        let compressed: Uint8Array;
        if (this.compressionAlgorithm === "gzip") {
          compressed = await compressYjsGzip(uncompressedStateVector);
        } else {
          compressed = compressYjsUpdate(uncompressedStateVector);
        }
        if (isCompressedPayload(compressed) && compressed.length < uncompressedStateVector.length) {
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
      this.lastStateVector = currentStateVector;

      if (flushedThroughSeq > 0) {
        // Acquire an exclusive write lock before evicting delta buffers.
        // Any concurrent recover() calls hold a read lock over their replay
        // window; this ensures GC cannot remove deltas that are still being
        // decoded by an in-flight peer recovery (#9166).
        const releaseWrite = await this.gcLock.acquireWrite();
        try {
          await this.storage.deleteDeltasThrough(this.roomId, flushedThroughSeq);
        } finally {
          releaseWrite();
        }
      }

      // Only retire the operations folded into this snapshot; keep counting
      // transactions that arrived while the async writes were in flight.
      this.opsSinceSnapshot = Math.max(0, this.opsSinceSnapshot - flushedCount);
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

      // Hold a shared read lock while listing and replaying deltas.  This
      // prevents compact()'s GC phase from evicting delta buffers that this
      // recovery operation is still decoding (#9166).
      const releaseRead = await this.gcLock.acquireRead();
      let appliedDeltas = 0;
      try {
        const deltas = await this.storage.listDeltas(this.roomId);
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
      } finally {
        releaseRead();
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
