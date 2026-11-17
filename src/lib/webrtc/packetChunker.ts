/**
 * WebRTC P2P DataChannel Binary Message Fragmentation & Reassembly Utility.
 *
 * Browsers enforce strict SCTP message limits over RTCDataChannel (typically
 * 16 KB – 64 KB). Transmitting large binary payloads (e.g. Yjs CRDT document
 * snapshots, canvas images, or vector strokes) exceeding this limit causes
 * browser OperationErrors or silent connection drops.
 *
 * This module splits large binary messages into sequenced chunks with 24-byte
 * binary headers, IEEE 802.3 CRC32 integrity checksums, out-of-order reassembly,
 * and automated timeout garbage collection.
 */

// 4-byte Magic Header: 'W' 'C' 'H' version 1 -> 0x57, 0x43, 0x48, 0x01
export const PACKET_MAGIC_HEADER = new Uint8Array([0x57, 0x43, 0x48, 0x01]);

export const HEADER_SIZE = 24;
export const DEFAULT_CHUNK_SIZE = 16 * 1024; // 16 KB safe default for SCTP MTU
export const DEFAULT_CHUNK_TIMEOUT_MS = 15 * 1000; // 15 seconds
export const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024; // 16 MB maximum buffer

/**
 * Precomputed IEEE 802.3 CRC32 table for fast binary checksumming.
 */
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Computes deterministic IEEE 802.3 CRC32 checksum across a byte array.
 */
export function computeCRC32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export class PacketChunkerError extends Error {
  constructor(message: string) {
    super(`[PacketChunker] ${message}`);
    this.name = "PacketChunkerError";
  }
}

export interface ChunkHeader {
  messageId: string;
  chunkIndex: number;
  totalChunks: number;
  totalLength: number;
  checksum: number;
}

export interface ChunkerOptions {
  /** Maximum chunk size in bytes including the 24-byte header. Default 16 KB. */
  chunkSize?: number;
  /** Explicit 64-bit numerical message ID. Default auto-incremented. */
  messageId?: bigint | number;
  /** Maximum allowed message size before erroring. Default 16 MB. */
  maxMessageSize?: number;
}

export interface ReassemblerOptions {
  /** Incomplete message purge timeout in ms. Default 15,000 ms. */
  chunkTimeoutMs?: number;
  /** Maximum allowed message size before rejecting. Default 16 MB. */
  maxMessageSize?: number;
  /** Clock injection for deterministic tests. */
  now?: () => number;
  /** Callback fired when a message fails CRC32 verification or size checks. */
  onCorrupted?: (messageId: string, reason: string) => void;
}

let globalMessageCounter = 1n;

/**
 * Checks whether an incoming binary buffer begins with the packet chunking magic header.
 */
export function isChunkedPacket(data: Uint8Array): boolean {
  if (!data || data.length < HEADER_SIZE) return false;
  for (let i = 0; i < PACKET_MAGIC_HEADER.length; i++) {
    if (data[i] !== PACKET_MAGIC_HEADER[i]) return false;
  }
  return true;
}

/**
 * Parses the 24-byte binary chunk header from a buffer.
 */
export function parseChunkHeader(
  data: Uint8Array,
): { header: ChunkHeader; payload: Uint8Array } | null {
  if (!isChunkedPacket(data)) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const msgIdHigh = view.getUint32(4, false);
  const msgIdLow = view.getUint32(8, false);
  const messageId = (
    (BigInt(msgIdHigh) << 32n) |
    BigInt(msgIdLow)
  ).toString();

  const chunkIndex = view.getUint16(12, false);
  const totalChunks = view.getUint16(14, false);
  const totalLength = view.getUint32(16, false);
  const checksum = view.getUint32(20, false);

  const payload = data.subarray(HEADER_SIZE);

  return {
    header: {
      messageId,
      chunkIndex,
      totalChunks,
      totalLength,
      checksum,
    },
    payload,
  };
}

/**
 * Splits a large binary payload into safe, sequenced WebRTC DataChannel chunks.
 */
export function splitIntoChunks(
  payload: Uint8Array,
  options: ChunkerOptions = {},
): Uint8Array[] {
  const maxMessageSize = options.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;
  if (payload.length > maxMessageSize) {
    throw new PacketChunkerError(
      `Payload size (${payload.length} bytes) exceeds maximum allowed (${maxMessageSize} bytes)`,
    );
  }

  const chunkSize = Math.max(
    HEADER_SIZE + 1,
    options.chunkSize ?? DEFAULT_CHUNK_SIZE,
  );
  const maxPayloadPerChunk = chunkSize - HEADER_SIZE;

  const totalLength = payload.length;
  const checksum = computeCRC32(payload);

  const rawMsgId = options.messageId
    ? BigInt(options.messageId)
    : globalMessageCounter++;
  const msgIdHigh = Number((rawMsgId >> 32n) & 0xffffffffn);
  const msgIdLow = Number(rawMsgId & 0xffffffffn);

  if (totalLength === 0) {
    const chunk = new Uint8Array(HEADER_SIZE);
    chunk.set(PACKET_MAGIC_HEADER, 0);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    view.setUint32(4, msgIdHigh, false);
    view.setUint32(8, msgIdLow, false);
    view.setUint16(12, 0, false);
    view.setUint16(14, 1, false);
    view.setUint32(16, 0, false);
    view.setUint32(20, checksum, false);
    return [chunk];
  }

  const totalChunks = Math.ceil(totalLength / maxPayloadPerChunk);
  if (totalChunks > 65535) {
    throw new PacketChunkerError(
      `Payload requires ${totalChunks} chunks which exceeds 16-bit indexing limit (65535)`,
    );
  }

  const chunks: Uint8Array[] = [];

  for (let index = 0; index < totalChunks; index++) {
    const offset = index * maxPayloadPerChunk;
    const sliceEnd = Math.min(offset + maxPayloadPerChunk, totalLength);
    const sliceLen = sliceEnd - offset;

    const chunk = new Uint8Array(HEADER_SIZE + sliceLen);
    chunk.set(PACKET_MAGIC_HEADER, 0);

    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    view.setUint32(4, msgIdHigh, false);
    view.setUint32(8, msgIdLow, false);
    view.setUint16(12, index, false);
    view.setUint16(14, totalChunks, false);
    view.setUint32(16, totalLength, false);
    view.setUint32(20, checksum, false);

    chunk.set(payload.subarray(offset, sliceEnd), HEADER_SIZE);
    chunks.push(chunk);
  }

  return chunks;
}

interface InFlightMessage {
  totalChunks: number;
  totalLength: number;
  checksum: number;
  receivedCount: number;
  chunks: (Uint8Array | undefined)[];
  firstSeenAt: number;
  lastUpdatedAt: number;
}

/**
 * Manages out-of-order reassembly of fragmented WebRTC binary packets.
 */
export class PacketReassembler {
  private readonly inFlight = new Map<string, InFlightMessage>();
  private readonly chunkTimeoutMs: number;
  private readonly maxMessageSize: number;
  private readonly now: () => number;
  private readonly onCorrupted?: (messageId: string, reason: string) => void;

  constructor(options: ReassemblerOptions = {}) {
    this.chunkTimeoutMs = options.chunkTimeoutMs ?? DEFAULT_CHUNK_TIMEOUT_MS;
    this.maxMessageSize = options.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;
    this.now = options.now ?? Date.now;
    this.onCorrupted = options.onCorrupted;
  }

  /**
   * Ingests a packet received from an RTCDataChannel message event.
   * If the packet is not chunked, returns the buffer unmodified (backward compatibility).
   * If the packet completes an in-flight message, returns the reconstructed byte array.
   * If still incomplete, returns null.
   */
  public push(data: Uint8Array): Uint8Array | null {
    if (!isChunkedPacket(data)) {
      // Pass unchunked raw message directly through
      return data;
    }

    const parsed = parseChunkHeader(data);
    if (!parsed) return null;

    const { header, payload } = parsed;
    const { messageId, chunkIndex, totalChunks, totalLength, checksum } = header;

    if (totalLength > this.maxMessageSize) {
      this.onCorrupted?.(
        messageId,
        `Message size ${totalLength} exceeds limit ${this.maxMessageSize}`,
      );
      this.inFlight.delete(messageId);
      return null;
    }

    if (chunkIndex >= totalChunks || totalChunks === 0) {
      this.onCorrupted?.(
        messageId,
        `Invalid chunkIndex ${chunkIndex} for totalChunks ${totalChunks}`,
      );
      return null;
    }

    const currentTime = this.now();
    let entry = this.inFlight.get(messageId);

    if (!entry) {
      entry = {
        totalChunks,
        totalLength,
        checksum,
        receivedCount: 0,
        chunks: new Array<Uint8Array | undefined>(totalChunks),
        firstSeenAt: currentTime,
        lastUpdatedAt: currentTime,
      };
      this.inFlight.set(messageId, entry);
    } else {
      entry.lastUpdatedAt = currentTime;
      if (
        entry.totalChunks !== totalChunks ||
        entry.totalLength !== totalLength ||
        entry.checksum !== checksum
      ) {
        this.onCorrupted?.(
          messageId,
          "Mismatched header parameters across chunks",
        );
        this.inFlight.delete(messageId);
        return null;
      }
    }

    if (!entry.chunks[chunkIndex]) {
      entry.chunks[chunkIndex] = payload;
      entry.receivedCount += 1;
    }

    if (entry.receivedCount === entry.totalChunks) {
      this.inFlight.delete(messageId);

      // Reconstruct buffer
      const assembled = new Uint8Array(entry.totalLength);
      let offset = 0;
      for (let i = 0; i < entry.totalChunks; i++) {
        const part = entry.chunks[i];
        if (!part) {
          this.onCorrupted?.(messageId, `Missing chunk #${i} upon completion`);
          return null;
        }
        assembled.set(part, offset);
        offset += part.length;
      }

      if (offset !== entry.totalLength) {
        this.onCorrupted?.(
          messageId,
          `Assembled length ${offset} does not match expected ${entry.totalLength}`,
        );
        return null;
      }

      const calculatedCRC = computeCRC32(assembled);
      if (calculatedCRC !== entry.checksum) {
        this.onCorrupted?.(
          messageId,
          `CRC32 checksum mismatch: expected ${entry.checksum}, got ${calculatedCRC}`,
        );
        return null;
      }

      return assembled;
    }

    return null;
  }

  /**
   * Sweeps and purges in-flight messages that have timed out without completing.
   * Returns the count of pruned stale messages.
   */
  public sweepStale(maxAgeMs?: number): number {
    const threshold = maxAgeMs ?? this.chunkTimeoutMs;
    const currentTime = this.now();
    let purged = 0;

    for (const [messageId, entry] of this.inFlight.entries()) {
      if (currentTime - entry.lastUpdatedAt >= threshold) {
        this.inFlight.delete(messageId);
        purged += 1;
      }
    }

    return purged;
  }

  /**
   * Number of partial messages currently awaiting chunks.
   */
  public getPendingMessageCount(): number {
    return this.inFlight.size;
  }

  /**
   * Discards all pending in-flight messages and resets memory.
   */
  public clear(): void {
    this.inFlight.clear();
  }
}
