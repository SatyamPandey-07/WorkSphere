/**
 * Binary WebRTC DataChannel Framing & Chunking Protocol
 * Implements docs/crdt/CRDT_DATACHANNEL_FRAMING.md:
 * - 16-byte big-endian header (Magic 0x5753, Version 1, Flags, MessageId, ChunkIndex, TotalChunks, PayloadLength, CRC-16/CCITT)
 * - Max frame size: 65,536 bytes (64 KiB) -> Max payload per chunk: 65,520 bytes
 */

export const CRDT_FRAME_MAGIC = 0x5753; // "WS"
export const CRDT_FRAME_VERSION = 1;
export const CRDT_FRAME_HEADER_SIZE = 16;
export const CRDT_MAX_SCTP_MESSAGE_SIZE = 65_536; // 64 KiB
export const CRDT_MAX_CHUNK_PAYLOAD_SIZE =
  CRDT_MAX_SCTP_MESSAGE_SIZE - CRDT_FRAME_HEADER_SIZE; // 65,520 bytes
export const CRDT_MAX_CHUNKS_SOFT_CAP = 256; // 16 MiB

export const enum CrdtFrameMessageType {
  STATE_VECTOR = 0x01,
  DELTA_UPDATE = 0x02,
  FULL_SYNC_FALLBACK = 0x03,
  ACK = 0x04,
}

export const enum CrdtFrameFlags {
  NONE = 0x00,
  TYPE_MASK = 0x0f,
  COMPRESSED = 0x10,
  END_OF_MESSAGE = 0x20,
}

export interface DecodedCrdtFrame {
  magic: number;
  version: number;
  flags: number;
  messageType: CrdtFrameMessageType;
  messageId: number;
  chunkIndex: number;
  totalChunks: number;
  payloadLength: number;
  crc16: number;
  payload: Uint8Array;
}

export interface ReassembledCrdtMessage {
  messageId: number;
  messageType: CrdtFrameMessageType;
  flags: number;
  payload: Uint8Array;
}

/**
 * Computes CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over a byte buffer.
 */
export function computeCrc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}

/**
 * Fragments an arbitrary binary payload into <= 65,536-byte framed packets
 * (16-byte header + up to 65,520-byte payload).
 */
export function encodeCrdtFrames(
  payload: Uint8Array,
  options: {
    messageId: number;
    messageType: CrdtFrameMessageType;
    compressed?: boolean;
    maxChunkPayloadSize?: number;
  },
): Uint8Array[] {
  const chunkLimit = Math.min(
    CRDT_MAX_CHUNK_PAYLOAD_SIZE,
    Math.max(1, options.maxChunkPayloadSize ?? CRDT_MAX_CHUNK_PAYLOAD_SIZE),
  );

  const totalChunks = Math.max(1, Math.ceil(payload.byteLength / chunkLimit));
  if (totalChunks > 0xffff) {
    throw new RangeError(
      `CRDT payload exceeds maximum uint16 chunk count (${totalChunks} > 65535)`,
    );
  }

  const frames: Uint8Array[] = [];
  const baseFlags =
    (options.messageType & CrdtFrameFlags.TYPE_MASK) |
    (options.compressed ? CrdtFrameFlags.COMPRESSED : 0);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * chunkLimit;
    const end = Math.min(payload.byteLength, start + chunkLimit);
    const slice = payload.subarray(start, end);
    const isLast = chunkIndex === totalChunks - 1;
    const flags = isLast
      ? baseFlags | CrdtFrameFlags.END_OF_MESSAGE
      : baseFlags;
    const crc16 = computeCrc16Ccitt(slice);

    const frame = new Uint8Array(CRDT_FRAME_HEADER_SIZE + slice.byteLength);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

    view.setUint16(0, CRDT_FRAME_MAGIC, false);
    view.setUint8(2, CRDT_FRAME_VERSION);
    view.setUint8(3, flags);
    view.setUint32(4, options.messageId >>> 0, false);
    view.setUint16(8, chunkIndex, false);
    view.setUint16(10, totalChunks, false);
    view.setUint16(12, slice.byteLength, false);
    view.setUint16(14, crc16, false);

    frame.set(slice, CRDT_FRAME_HEADER_SIZE);
    frames.push(frame);
  }

  return frames;
}

/**
 * Decodes and validates a single 16-byte-header CRDT DataChannel frame.
 */
export function decodeCrdtFrame(
  raw: Uint8Array | ArrayBuffer,
): DecodedCrdtFrame {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (bytes.byteLength < CRDT_FRAME_HEADER_SIZE) {
    throw new Error(
      `Invalid CRDT frame: expected at least ${CRDT_FRAME_HEADER_SIZE} bytes, got ${bytes.byteLength}`,
    );
  }
  if (bytes.byteLength > CRDT_MAX_SCTP_MESSAGE_SIZE) {
    throw new Error(
      `CRDT frame exceeds 64 KiB SCTP MTU ceiling (${bytes.byteLength} > ${CRDT_MAX_SCTP_MESSAGE_SIZE})`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint16(0, false);
  if (magic !== CRDT_FRAME_MAGIC) {
    throw new Error(
      `Invalid CRDT frame magic: expected 0x${CRDT_FRAME_MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
    );
  }

  const version = view.getUint8(2);
  if (version !== CRDT_FRAME_VERSION) {
    throw new Error(`Unsupported CRDT frame version: ${version}`);
  }

  const flags = view.getUint8(3);
  const messageType = (flags &
    CrdtFrameFlags.TYPE_MASK) as CrdtFrameMessageType;
  const messageId = view.getUint32(4, false);
  const chunkIndex = view.getUint16(8, false);
  const totalChunks = view.getUint16(10, false);
  const payloadLength = view.getUint16(12, false);
  const crc16 = view.getUint16(14, false);

  if (totalChunks === 0 || chunkIndex >= totalChunks) {
    throw new Error(
      `Invalid CRDT chunk bounds: index ${chunkIndex} of ${totalChunks}`,
    );
  }

  const expectedTotalLength = CRDT_FRAME_HEADER_SIZE + payloadLength;
  if (bytes.byteLength !== expectedTotalLength) {
    throw new Error(
      `CRDT frame length mismatch: header declares ${payloadLength} payload bytes, buffer has ${bytes.byteLength - CRDT_FRAME_HEADER_SIZE}`,
    );
  }

  const payload = bytes.subarray(CRDT_FRAME_HEADER_SIZE);
  const actualCrc = computeCrc16Ccitt(payload);
  if (actualCrc !== crc16) {
    throw new Error(
      `CRDT frame CRC-16 mismatch: expected 0x${crc16.toString(16)}, got 0x${actualCrc.toString(16)}`,
    );
  }

  return {
    magic,
    version,
    flags,
    messageType,
    messageId,
    chunkIndex,
    totalChunks,
    payloadLength,
    crc16,
    payload,
  };
}

interface PendingAssembly {
  messageType: CrdtFrameMessageType;
  flags: number;
  totalChunks: number;
  receivedCount: number;
  totalBytes: number;
  chunks: Array<Uint8Array | undefined>;
  createdAt: number;
}

/**
 * Stateful per-peer frame reassembler that buffers fragmented chunks until
 * all `totalChunks` arrive and reconstructs the contiguous binary payload.
 */
export class CrdtFrameReassembler {
  private readonly pending = new Map<number, PendingAssembly>();
  private readonly completedMessageIds = new Set<number>();
  private readonly maxPendingMessages: number;

  constructor(maxPendingMessages = 64) {
    this.maxPendingMessages = maxPendingMessages;
  }

  get inFlightCount(): number {
    return this.pending.size;
  }

  /**
   * Consumes one binary frame. Returns the reassembled message once all chunks
   * for `messageId` have arrived, or `null` while awaiting remaining chunks.
   */
  pushFrame(raw: Uint8Array | ArrayBuffer): ReassembledCrdtMessage | null {
    const frame = decodeCrdtFrame(raw);

    // Drop duplicate/replayed message IDs after completion
    if (this.completedMessageIds.has(frame.messageId)) {
      return null;
    }

    // Fast path for single-chunk messages
    if (frame.totalChunks === 1 && frame.chunkIndex === 0) {
      this.recordCompleted(frame.messageId);
      return {
        messageId: frame.messageId,
        messageType: frame.messageType,
        flags: frame.flags,
        payload: new Uint8Array(frame.payload),
      };
    }

    let entry = this.pending.get(frame.messageId);
    if (!entry) {
      if (this.pending.size >= this.maxPendingMessages) {
        const oldestKey = this.pending.keys().next().value;
        if (oldestKey !== undefined) {
          this.pending.delete(oldestKey);
        }
      }
      entry = {
        messageType: frame.messageType,
        flags: frame.flags,
        totalChunks: frame.totalChunks,
        receivedCount: 0,
        totalBytes: 0,
        chunks: new Array<Uint8Array | undefined>(frame.totalChunks),
        createdAt: Date.now(),
      };
      this.pending.set(frame.messageId, entry);
    }

    if (entry.totalChunks !== frame.totalChunks) {
      this.pending.delete(frame.messageId);
      throw new Error(
        `Inconsistent totalChunks for messageId ${frame.messageId}`,
      );
    }

    // Ignore duplicate chunk retransmission within the same assembly
    if (!entry.chunks[frame.chunkIndex]) {
      entry.chunks[frame.chunkIndex] = new Uint8Array(frame.payload);
      entry.receivedCount += 1;
      entry.totalBytes += frame.payload.byteLength;
    }

    if (entry.receivedCount < entry.totalChunks) {
      return null;
    }

    this.pending.delete(frame.messageId);
    this.recordCompleted(frame.messageId);

    const assembled = new Uint8Array(entry.totalBytes);
    let offset = 0;
    for (let i = 0; i < entry.totalChunks; i++) {
      const part = entry.chunks[i]!;
      assembled.set(part, offset);
      offset += part.byteLength;
    }

    return {
      messageId: frame.messageId,
      messageType: entry.messageType,
      flags: entry.flags,
      payload: assembled,
    };
  }

  private recordCompleted(messageId: number): void {
    this.completedMessageIds.add(messageId);
    if (this.completedMessageIds.size > 512) {
      const oldest = this.completedMessageIds.values().next().value;
      if (oldest !== undefined) {
        this.completedMessageIds.delete(oldest);
      }
    }
  }

  clear(): void {
    this.pending.clear();
    this.completedMessageIds.clear();
  }
}
