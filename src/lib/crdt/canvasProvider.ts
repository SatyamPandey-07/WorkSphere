import * as Y from "yjs";

export const COMPACTION_ENTRY_THRESHOLD = 50;
export const COMPACTION_BYTE_THRESHOLD = 64 * 1024; // 64 KB
export const MAX_WS_FRAME_PAYLOAD_BYTES = 32 * 1024; // 32 KB per binary chunk

const BINARY_FRAME_MAGIC = 0x57; // 'W'
const BINARY_FRAME_VERSION = 0x01;
const FRAME_HEADER_BYTES = 16;

export interface JournalEntry {
  id?: number;
  roomId: string;
  update: Uint8Array;
  byteLength: number;
  createdAt: number;
}

export interface ChunkedBinaryFrame {
  transferId: number;
  chunkIndex: number;
  totalChunks: number;
  payload: Uint8Array;
  wireBuffer: Uint8Array;
}

export interface PartyKitSocketLike {
  readyState: number;
  send: (data: string | ArrayBuffer | Uint8Array) => void;
}

export interface CanvasProviderOptions {
  roomId: string;
  doc: Y.Doc;
  dbName?: string;
  entryThreshold?: number;
  byteThreshold?: number;
  maxChunkBytes?: number;
  mergeUpdatesFn?: (updates: Uint8Array[]) => Uint8Array;
}

/**
 * Encodes a binary payload into MTU-safe framed chunks for PartyKit WebSocket transmission:
 * [0]: Magic (0x57) | [1]: Version (0x01) | [2..3]: Reserved
 * [4..7]: Transfer ID (uint32 BE) | [8..11]: Chunk Index (uint32 BE) | [12..15]: Total Chunks (uint32 BE)
 * [16..N]: Slice payload
 */
export function encodeBinaryFrameChunks(
  mergedUpdate: Uint8Array,
  maxChunkPayloadBytes: number = MAX_WS_FRAME_PAYLOAD_BYTES,
  transferId: number = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>>
    0,
): ChunkedBinaryFrame[] {
  const safeMax = Math.max(256, maxChunkPayloadBytes);
  const totalChunks = Math.max(1, Math.ceil(mergedUpdate.byteLength / safeMax));
  const frames: ChunkedBinaryFrame[] = [];

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * safeMax;
    const end = Math.min(start + safeMax, mergedUpdate.byteLength);
    const payload = mergedUpdate.subarray(start, end);

    const wireBuffer = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
    const view = new DataView(wireBuffer.buffer);

    wireBuffer[0] = BINARY_FRAME_MAGIC;
    wireBuffer[1] = BINARY_FRAME_VERSION;
    wireBuffer[2] = 0;
    wireBuffer[3] = 0;
    view.setUint32(4, transferId, false);
    view.setUint32(8, chunkIndex, false);
    view.setUint32(12, totalChunks, false);
    wireBuffer.set(payload, FRAME_HEADER_BYTES);

    frames.push({
      transferId,
      chunkIndex,
      totalChunks,
      payload,
      wireBuffer,
    });
  }

  return frames;
}

/**
 * Reassembles framed binary chunks received over PartyKit WebSocket into a single Yjs update.
 */
export class BinaryFrameReassembler {
  private readonly transfers = new Map<
    number,
    {
      totalChunks: number;
      received: Map<number, Uint8Array>;
      updatedAt: number;
    }
  >();

  public pushFrame(wireBuffer: Uint8Array): Uint8Array | null {
    if (
      wireBuffer.byteLength < FRAME_HEADER_BYTES ||
      wireBuffer[0] !== BINARY_FRAME_MAGIC ||
      wireBuffer[1] !== BINARY_FRAME_VERSION
    ) {
      return null;
    }

    const view = new DataView(
      wireBuffer.buffer,
      wireBuffer.byteOffset,
      wireBuffer.byteLength,
    );
    const transferId = view.getUint32(4, false);
    const chunkIndex = view.getUint32(8, false);
    const totalChunks = view.getUint32(12, false);

    if (totalChunks === 0 || chunkIndex >= totalChunks) {
      return null;
    }

    const payload = wireBuffer.slice(FRAME_HEADER_BYTES);

    if (totalChunks === 1) {
      return payload;
    }

    let bucket = this.transfers.get(transferId);
    if (!bucket) {
      bucket = {
        totalChunks,
        received: new Map<number, Uint8Array>(),
        updatedAt: Date.now(),
      };
      this.transfers.set(transferId, bucket);
    }

    bucket.received.set(chunkIndex, payload);
    bucket.updatedAt = Date.now();

    if (bucket.received.size < totalChunks) {
      return null;
    }

    let totalBytes = 0;
    for (let i = 0; i < totalChunks; i++) {
      const part = bucket.received.get(i);
      if (!part) return null;
      totalBytes += part.byteLength;
    }

    const assembled = new Uint8Array(totalBytes);
    let offset = 0;
    for (let i = 0; i < totalChunks; i++) {
      const part = bucket.received.get(i)!;
      assembled.set(part, offset);
      offset += part.byteLength;
    }

    this.transfers.delete(transferId);
    return assembled;
  }
}

/**
 * Offline-resilient CRDT IndexedDB change journal with automatic Y.mergeUpdates compaction
 * and chunked binary framing replay over PartyKit.
 */
export class CompactingCrdtJournal {
  private readonly roomId: string;
  private readonly dbName: string;
  private readonly entryThreshold: number;
  private readonly byteThreshold: number;
  private readonly maxChunkBytes: number;
  private readonly mergeUpdatesFn: (updates: Uint8Array[]) => Uint8Array;

  private memoryFallback: JournalEntry[] = [];
  private isCompacting = false;

  constructor(options: CanvasProviderOptions) {
    this.roomId = options.roomId;
    this.dbName = options.dbName ?? "worksphere-crdt-journal";
    this.entryThreshold = options.entryThreshold ?? COMPACTION_ENTRY_THRESHOLD;
    this.byteThreshold = options.byteThreshold ?? COMPACTION_BYTE_THRESHOLD;
    this.maxChunkBytes = options.maxChunkBytes ?? MAX_WS_FRAME_PAYLOAD_BYTES;
    this.mergeUpdatesFn = options.mergeUpdatesFn ?? Y.mergeUpdates;
  }

  private openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(this.dbName, 1);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("journal")) {
            const store = db.createObjectStore("journal", {
              keyPath: "id",
              autoIncrement: true,
            });
            store.createIndex("by_room", "roomId", { unique: false });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Appends an incremental Yjs update frame to the journal and triggers automatic
   * Y.mergeUpdates compaction if entry count > 50 or buffered bytes > 64 KB.
   */
  public async appendUpdate(update: Uint8Array): Promise<{
    compacted: boolean;
    entryCount: number;
    totalBytes: number;
  }> {
    if (update.byteLength === 0) {
      const current = await this.getAllEntries();
      const bytes = current.reduce((acc, item) => acc + item.byteLength, 0);
      return {
        compacted: false,
        entryCount: current.length,
        totalBytes: bytes,
      };
    }

    const entry: JournalEntry = {
      roomId: this.roomId,
      update: new Uint8Array(update),
      byteLength: update.byteLength,
      createdAt: Date.now(),
    };

    const db = await this.openDatabase();
    if (!db) {
      this.memoryFallback.push(entry);
    } else {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("journal", "readwrite");
        tx.objectStore("journal").add(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }

    const entries = await this.getAllEntries();
    const totalBytes = entries.reduce((sum, item) => sum + item.byteLength, 0);

    if (
      entries.length > this.entryThreshold ||
      totalBytes > this.byteThreshold
    ) {
      await this.compact();
      const postEntries = await this.getAllEntries();
      const postBytes = postEntries.reduce(
        (sum, item) => sum + item.byteLength,
        0,
      );
      return {
        compacted: true,
        entryCount: postEntries.length,
        totalBytes: postBytes,
      };
    }

    return {
      compacted: false,
      entryCount: entries.length,
      totalBytes,
    };
  }

  public async getAllEntries(): Promise<JournalEntry[]> {
    const db = await this.openDatabase();
    if (!db) {
      return this.memoryFallback.filter((e) => e.roomId === this.roomId);
    }

    return new Promise<JournalEntry[]>((resolve) => {
      const tx = db.transaction("journal", "readonly");
      const index = tx.objectStore("journal").index("by_room");
      const req = index.getAll(IDBKeyRange.only(this.roomId));

      req.onsuccess = () => {
        db.close();
        resolve((req.result as JournalEntry[]) ?? []);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  }

  /**
   * Compacts all queued incremental frames for `roomId` into a single merged
   * state vector update via `Y.mergeUpdates(queuedFrames)`.
   */
  public async compact(): Promise<Uint8Array | null> {
    if (this.isCompacting) {
      return null;
    }

    this.isCompacting = true;
    try {
      const entries = await this.getAllEntries();
      if (entries.length === 0) {
        return null;
      }

      if (entries.length === 1) {
        return entries[0].update;
      }

      const queuedFrames = entries.map((entry) => entry.update);
      const mergedUpdate = this.mergeUpdatesFn(queuedFrames);

      const compactedEntry: JournalEntry = {
        roomId: this.roomId,
        update: mergedUpdate,
        byteLength: mergedUpdate.byteLength,
        createdAt: Date.now(),
      };

      const db = await this.openDatabase();
      if (!db) {
        this.memoryFallback = [
          ...this.memoryFallback.filter((e) => e.roomId !== this.roomId),
          compactedEntry,
        ];
        return mergedUpdate;
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("journal", "readwrite");
        const store = tx.objectStore("journal");

        for (const existing of entries) {
          if (typeof existing.id === "number") {
            store.delete(existing.id);
          }
        }
        store.add(compactedEntry);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      db.close();
      return mergedUpdate;
    } finally {
      this.isCompacting = false;
    }
  }

  /**
   * Compacts all offline updates into a single merged state update, splits it into
   * <= 32 KB binary framed chunks, streams them over PartyKit, and clears the journal.
   */
  public async flushToPartyKit(socket: PartyKitSocketLike): Promise<{
    sentFrames: number;
    mergedByteLength: number;
  }> {
    if (socket.readyState !== 1) {
      return { sentFrames: 0, mergedByteLength: 0 };
    }

    const mergedUpdate = await this.compact();
    if (!mergedUpdate || mergedUpdate.byteLength === 0) {
      return { sentFrames: 0, mergedByteLength: 0 };
    }

    const frames = encodeBinaryFrameChunks(mergedUpdate, this.maxChunkBytes);
    for (const frame of frames) {
      socket.send(frame.wireBuffer);
    }

    await this.clear();

    return {
      sentFrames: frames.length,
      mergedByteLength: mergedUpdate.byteLength,
    };
  }

  public async clear(): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      this.memoryFallback = this.memoryFallback.filter(
        (e) => e.roomId !== this.roomId,
      );
      return;
    }

    const entries = await this.getAllEntries();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("journal", "readwrite");
      const store = tx.objectStore("journal");
      for (const entry of entries) {
        if (typeof entry.id === "number") {
          store.delete(entry.id);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
}

export class OfflineCanvasProvider {
  public readonly doc: Y.Doc;
  public readonly journal: CompactingCrdtJournal;
  private socket: PartyKitSocketLike | null = null;
  private isOnline = true;

  constructor(options: CanvasProviderOptions) {
    this.doc = options.doc;
    this.journal = new CompactingCrdtJournal(options);
    this.doc.on("update", this.handleDocUpdate);
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote-sync") {
      return;
    }

    if (this.isOnline && this.socket && this.socket.readyState === 1) {
      const frames = encodeBinaryFrameChunks(update);
      for (const frame of frames) {
        this.socket.send(frame.wireBuffer);
      }
      return;
    }

    void this.journal.appendUpdate(update);
  };

  public setOnlineStatus(online: boolean): void {
    this.isOnline = online;
  }

  public async attachSocketAndReplay(socket: PartyKitSocketLike): Promise<{
    sentFrames: number;
    mergedByteLength: number;
  }> {
    this.socket = socket;
    this.isOnline = true;
    return this.journal.flushToPartyKit(socket);
  }

  public destroy(): void {
    this.doc.off("update", this.handleDocUpdate);
    this.socket = null;
  }
}
