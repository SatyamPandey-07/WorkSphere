/**
 * AudioFEC.ts
 * Adaptive Forward Error Correction (FEC) for audio frames over lossy WebRTC mesh networks (#7948).
 *
 * Implements:
 * 1. XOR parity generation across blocks of N audio frames.
 * 2. Recovery of up to 1 missing audio frame per FEC block.
 * 3. Bounded receiver buffers and expiration of incomplete/stale blocks.
 * 4. Per-peer WebRTC stats monitoring and cumulative packet loss estimation.
 * 5. Adaptive activation (>5% loss) and deactivation (0% loss) policy.
 */

export const FEC_PROTOCOL_VERSION = 1;
export const DEFAULT_FEC_BLOCK_SIZE = 4; // N frames per FEC block (e.g. 4 frames = 80ms at 20ms/frame)
export const MAX_FEC_BLOCK_SIZE = 16;
export const MAX_FEC_PAYLOAD_BYTES = 64 * 1024;
export const FEC_EXPIRATION_TIMEOUT_MS = 2000; // Discard unrecoverable incomplete blocks after 2s
export const MAX_BUFFERED_BLOCKS_PER_STREAM = 32;

/** Wire packet type discrimination in payload:
 * 0 = Normal audio frame (or legacy non-FEC packet)
 * 1 = Audio frame with FEC header
 * 2 = FEC parity frame
 */
export enum AudioPacketType {
  Normal = 0,
  AudioWithFEC = 1,
  FECParity = 2,
}

export class AudioFECError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioFECError";
  }
}

/** Represents an audio frame to be transmitted or received */
export interface AudioFrame {
  streamId: string;
  frameSeq: number;
  timestamp: number;
  payload: Uint8Array;
}

export interface FECBlockHeader {
  version: number;
  type: AudioPacketType;
  streamId: string; // UTF-8 encoded, max 64 bytes
  blockId: number; // 32-bit uint
  blockSize: number; // 8-bit uint (e.g. 4)
  frameIndex: number; // 8-bit uint (0 .. blockSize - 1 for audio, or blockSize for parity)
  frameSeq: number; // 32-bit uint
  timestamp: number; // 32-bit uint (or 48/64-bit ms)
}

export interface FECParityMetadata {
  version: number;
  streamId: string;
  blockId: number;
  blockSize: number;
  baseSeq: number; // base frameSeq
  frameLengths: number[]; // Length of each frame in the block
  timestamp: number;
}

export interface FECParityPacket {
  metadata: FECParityMetadata;
  parityPayload: Uint8Array;
}

/* ------------------------------------------------------------------ */
/* Binary Serialization for FEC Audio and Parity Packets              */
/* ------------------------------------------------------------------ */

/**
 * Magic prefix byte: 0xFE ('~' or 254) to quickly distinguish FEC-encapsulated
 * audio packets from raw legacy Opus/PCM audio buffers.
 *
 * Wire format for FEC-encapsulated Audio frame (Type 1):
 * [0]: 0xFE (MAGIC)
 * [1]: FEC_PROTOCOL_VERSION (1)
 * [2]: AudioPacketType.AudioWithFEC (1)
 * [3]: streamIdLen (u8)
 * [4 .. 4+streamIdLen-1]: streamId (UTF-8)
 * [offset .. +4]: blockId (u32 BE)
 * [+4]: blockSize (u8)
 * [+5]: frameIndex (u8)
 * [+6 .. +10]: frameSeq (u32 BE)
 * [+10 .. +18]: timestamp (u64 BE / 8 bytes)
 * [+18 .. +22]: payloadLen (u32 BE)
 * [+22 .. +22+payloadLen]: payload
 *
 * Wire format for FEC Parity frame (Type 2):
 * [0]: 0xFE (MAGIC)
 * [1]: FEC_PROTOCOL_VERSION (1)
 * [2]: AudioPacketType.FECParity (2)
 * [3]: streamIdLen (u8)
 * [4 .. 4+streamIdLen-1]: streamId (UTF-8)
 * [offset .. +4]: blockId (u32 BE)
 * [+4]: blockSize (u8)
 * [+5 .. +9]: baseSeq (u32 BE)
 * [+9 .. +17]: timestamp (u64 BE)
 * [+17 .. +17 + 2*blockSize]: frameLengths (blockSize * u16 BE)
 * [+offset .. +4]: parityPayloadLen (u32 BE)
 * [+4 .. ]: parityPayload
 */

export const FEC_MAGIC_BYTE = 0xfe;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export function isFECPacket(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === FEC_MAGIC_BYTE &&
    data[1] === FEC_PROTOCOL_VERSION
  );
}

export function encodeAudioFrameWithFEC(
  frame: AudioFrame,
  blockId: number,
  blockSize: number,
  frameIndex: number,
): Uint8Array {
  if (
    frameIndex < 0 ||
    frameIndex >= blockSize ||
    blockSize > MAX_FEC_BLOCK_SIZE
  ) {
    throw new AudioFECError("Invalid frameIndex or blockSize");
  }
  if (frame.payload.length > MAX_FEC_PAYLOAD_BYTES) {
    throw new AudioFECError(
      `Payload exceeds maximum allowed size of ${MAX_FEC_PAYLOAD_BYTES}`,
    );
  }

  const streamIdBytes = textEncoder.encode(frame.streamId);
  if (streamIdBytes.length === 0 || streamIdBytes.length > 255) {
    throw new AudioFECError("streamId must be 1-255 bytes");
  }

  // Header: 1 (magic) + 1 (version) + 1 (type) + 1 (streamIdLen) + streamIdLen
  // + 4 (blockId) + 1 (blockSize) + 1 (frameIndex) + 4 (frameSeq) + 8 (timestamp) + 4 (payloadLen)
  const headerLen = 4 + streamIdBytes.length + 4 + 1 + 1 + 4 + 8 + 4;
  const out = new Uint8Array(headerLen + frame.payload.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  let o = 0;
  out[o++] = FEC_MAGIC_BYTE;
  out[o++] = FEC_PROTOCOL_VERSION;
  out[o++] = AudioPacketType.AudioWithFEC;
  out[o++] = streamIdBytes.length;
  out.set(streamIdBytes, o);
  o += streamIdBytes.length;

  view.setUint32(o, blockId >>> 0);
  o += 4;
  out[o++] = blockSize;
  out[o++] = frameIndex;
  view.setUint32(o, frame.frameSeq >>> 0);
  o += 4;
  view.setUint32(o, Math.floor(frame.timestamp / 2 ** 32));
  view.setUint32(o + 4, frame.timestamp >>> 0);
  o += 8;
  view.setUint32(o, frame.payload.length);
  o += 4;

  out.set(frame.payload, o);
  return out;
}

export function encodeFECParityPacket(
  metadata: FECParityMetadata,
  parityPayload: Uint8Array,
): Uint8Array {
  if (metadata.blockSize < 1 || metadata.blockSize > MAX_FEC_BLOCK_SIZE) {
    throw new AudioFECError("Invalid blockSize");
  }
  if (metadata.frameLengths.length !== metadata.blockSize) {
    throw new AudioFECError("frameLengths length must match blockSize");
  }
  if (parityPayload.length > MAX_FEC_PAYLOAD_BYTES) {
    throw new AudioFECError("Parity payload too large");
  }

  const streamIdBytes = textEncoder.encode(metadata.streamId);
  if (streamIdBytes.length === 0 || streamIdBytes.length > 255) {
    throw new AudioFECError("streamId must be 1-255 bytes");
  }

  // Header: 4 + streamIdLen + 4 (blockId) + 1 (blockSize) + 4 (baseSeq) + 8 (timestamp)
  // + 2 * blockSize (frameLengths) + 4 (parityPayloadLen)
  const headerLen =
    4 + streamIdBytes.length + 4 + 1 + 4 + 8 + 2 * metadata.blockSize + 4;
  const out = new Uint8Array(headerLen + parityPayload.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  let o = 0;
  out[o++] = FEC_MAGIC_BYTE;
  out[o++] = FEC_PROTOCOL_VERSION;
  out[o++] = AudioPacketType.FECParity;
  out[o++] = streamIdBytes.length;
  out.set(streamIdBytes, o);
  o += streamIdBytes.length;

  view.setUint32(o, metadata.blockId >>> 0);
  o += 4;
  out[o++] = metadata.blockSize;
  view.setUint32(o, metadata.baseSeq >>> 0);
  o += 4;
  view.setUint32(o, Math.floor(metadata.timestamp / 2 ** 32));
  view.setUint32(o + 4, metadata.timestamp >>> 0);
  o += 8;

  for (let i = 0; i < metadata.blockSize; i++) {
    const len = metadata.frameLengths[i];
    if (len < 0 || len > MAX_FEC_PAYLOAD_BYTES) {
      throw new AudioFECError("Invalid frame length in metadata");
    }
    view.setUint16(o, len);
    o += 2;
  }

  view.setUint32(o, parityPayload.length);
  o += 4;
  out.set(parityPayload, o);
  return out;
}

export type DecodedFECPacket =
  | {
      type: AudioPacketType.AudioWithFEC;
      blockId: number;
      blockSize: number;
      frameIndex: number;
      frame: AudioFrame;
    }
  | {
      type: AudioPacketType.FECParity;
      parityPacket: FECParityPacket;
    };

export function decodeFECPacket(data: Uint8Array): DecodedFECPacket {
  if (data.length < 4) throw new AudioFECError("Packet too short");
  if (data[0] !== FEC_MAGIC_BYTE)
    throw new AudioFECError("Not an FEC packet (magic mismatch)");
  if (data[1] !== FEC_PROTOCOL_VERSION)
    throw new AudioFECError(`Unsupported FEC version: ${data[1]}`);

  const type = data[2] as AudioPacketType;
  const streamIdLen = data[3];
  let o = 4;
  if (o + streamIdLen > data.length)
    throw new AudioFECError("Truncated streamId");
  const streamId = textDecoder.decode(data.subarray(o, o + streamIdLen));
  o += streamIdLen;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (type === AudioPacketType.AudioWithFEC) {
    if (o + 4 + 1 + 1 + 4 + 8 + 4 > data.length)
      throw new AudioFECError("Truncated audio FEC header");
    const blockId = view.getUint32(o);
    o += 4;
    const blockSize = data[o++];
    const frameIndex = data[o++];
    const frameSeq = view.getUint32(o);
    o += 4;
    const hiTs = view.getUint32(o);
    const loTs = view.getUint32(o + 4);
    const timestamp = hiTs * 2 ** 32 + loTs;
    o += 8;
    const payloadLen = view.getUint32(o);
    o += 4;

    if (
      blockSize < 1 ||
      blockSize > MAX_FEC_BLOCK_SIZE ||
      frameIndex >= blockSize
    ) {
      throw new AudioFECError("Invalid blockSize or frameIndex");
    }
    if (payloadLen > MAX_FEC_PAYLOAD_BYTES || o + payloadLen !== data.length) {
      throw new AudioFECError("Audio FEC payload length mismatch");
    }

    const payload = data.slice(o, o + payloadLen);
    return {
      type: AudioPacketType.AudioWithFEC,
      blockId,
      blockSize,
      frameIndex,
      frame: { streamId, frameSeq, timestamp, payload },
    };
  } else if (type === AudioPacketType.FECParity) {
    if (o + 4 + 1 + 4 + 8 > data.length)
      throw new AudioFECError("Truncated parity header");
    const blockId = view.getUint32(o);
    o += 4;
    const blockSize = data[o++];
    if (blockSize < 1 || blockSize > MAX_FEC_BLOCK_SIZE) {
      throw new AudioFECError("Invalid blockSize");
    }
    const baseSeq = view.getUint32(o);
    o += 4;
    const hiTs = view.getUint32(o);
    const loTs = view.getUint32(o + 4);
    const timestamp = hiTs * 2 ** 32 + loTs;
    o += 8;

    if (o + 2 * blockSize + 4 > data.length)
      throw new AudioFECError("Truncated frameLengths");
    const frameLengths: number[] = [];
    for (let i = 0; i < blockSize; i++) {
      frameLengths.push(view.getUint16(o));
      o += 2;
    }

    const parityPayloadLen = view.getUint32(o);
    o += 4;
    if (
      parityPayloadLen > MAX_FEC_PAYLOAD_BYTES ||
      o + parityPayloadLen !== data.length
    ) {
      throw new AudioFECError("Parity payload length mismatch");
    }

    const maxExpectedLen = Math.max(...frameLengths, 0);
    if (parityPayloadLen !== maxExpectedLen) {
      throw new AudioFECError(
        "Parity payload length does not match maximum frame length",
      );
    }

    const parityPayload = data.slice(o, o + parityPayloadLen);
    return {
      type: AudioPacketType.FECParity,
      parityPacket: {
        metadata: {
          version: FEC_PROTOCOL_VERSION,
          streamId,
          blockId,
          blockSize,
          baseSeq,
          frameLengths,
          timestamp,
        },
        parityPayload,
      },
    };
  }

  throw new AudioFECError(`Unknown FEC packet type: ${type}`);
}

/* ------------------------------------------------------------------ */
/* XOR Parity Generation and Reconstruction                          */
/* ------------------------------------------------------------------ */

/**
 * Computes bitwise XOR across multiple byte arrays.
 * Shorter arrays are implicitly zero-padded to the length of the longest array.
 */
export function computeXORParity(buffers: Uint8Array[]): Uint8Array {
  if (buffers.length === 0) return new Uint8Array(0);
  const maxLen = Math.max(...buffers.map((b) => b.length));
  const parity = new Uint8Array(maxLen);

  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i++) {
      parity[i] ^= buf[i];
    }
  }
  return parity;
}

/**
 * Reconstructs a single missing frame in a block using XOR parity:
 * missingFrame = parity XOR (all other received frames)
 *
 * @param receivedFrames Map of frameIndex (0..blockSize-1) to received frame payload
 * @param frameLengths Expected original lengths of each frame in the block
 * @param parityPayload The block's parity payload
 * @param missingIndex The index of the single missing frame to reconstruct
 */
export function reconstructMissingFrame(
  receivedFrames: Map<number, Uint8Array>,
  frameLengths: number[],
  parityPayload: Uint8Array,
  missingIndex: number,
): Uint8Array {
  const blockSize = frameLengths.length;
  if (missingIndex < 0 || missingIndex >= blockSize) {
    throw new AudioFECError("Invalid missingIndex");
  }
  if (receivedFrames.size !== blockSize - 1) {
    throw new AudioFECError(
      `Cannot reconstruct: expected ${blockSize - 1} frames, got ${receivedFrames.size}`,
    );
  }

  const expectedLength = frameLengths[missingIndex];
  if (expectedLength < 0 || expectedLength > MAX_FEC_PAYLOAD_BYTES) {
    throw new AudioFECError("Invalid target frame length");
  }

  // XOR parity with all other received frames
  const reconstructed = new Uint8Array(parityPayload);
  for (const [idx, frameData] of receivedFrames.entries()) {
    if (idx === missingIndex) continue;
    // Check against expected length metadata
    if (frameData.length !== frameLengths[idx]) {
      throw new AudioFECError(`Received frame length mismatch at index ${idx}`);
    }
    for (let i = 0; i < frameData.length; i++) {
      reconstructed[i] ^= frameData[i];
    }
  }

  // Ensure trailing padding bytes are zero
  for (let i = expectedLength; i < reconstructed.length; i++) {
    if (reconstructed[i] !== 0) {
      throw new AudioFECError(
        "Reconstructed payload validation failed (non-zero padding)",
      );
    }
  }

  return reconstructed.slice(0, expectedLength);
}

/* ------------------------------------------------------------------ */
/* FEC Encoder (Sender Side)                                          */
/* ------------------------------------------------------------------ */

export class FECEncoder {
  private currentBlockId = 0;
  private currentFrames: AudioFrame[] = [];
  private blockSize: number;

  constructor(blockSize = DEFAULT_FEC_BLOCK_SIZE) {
    if (blockSize < 2 || blockSize > MAX_FEC_BLOCK_SIZE) {
      throw new RangeError(
        `blockSize must be between 2 and ${MAX_FEC_BLOCK_SIZE}`,
      );
    }
    this.blockSize = blockSize;
  }

  public setBlockSize(size: number): void {
    if (size >= 2 && size <= MAX_FEC_BLOCK_SIZE) {
      this.blockSize = size;
    }
  }

  public getBlockSize(): number {
    return this.blockSize;
  }

  /**
   * Adds an audio frame to the current FEC block.
   * Returns:
   * - encodedFrame: The frame encoded with FEC header
   * - parityPacket: Generated FEC parity packet if this frame completes the block, or null otherwise.
   */
  public addFrame(frame: AudioFrame): {
    encodedAudioPacket: Uint8Array;
    parityPacket: Uint8Array | null;
  } {
    const frameIndex = this.currentFrames.length;
    const blockId = this.currentBlockId;
    const encodedAudioPacket = encodeAudioFrameWithFEC(
      frame,
      blockId,
      this.blockSize,
      frameIndex,
    );

    this.currentFrames.push(frame);

    let parityPacket: Uint8Array | null = null;
    if (this.currentFrames.length === this.blockSize) {
      // Generate parity
      const parityPayload = computeXORParity(
        this.currentFrames.map((f) => f.payload),
      );
      const metadata: FECParityMetadata = {
        version: FEC_PROTOCOL_VERSION,
        streamId: frame.streamId,
        blockId,
        blockSize: this.blockSize,
        baseSeq: this.currentFrames[0].frameSeq,
        frameLengths: this.currentFrames.map((f) => f.payload.length),
        timestamp: frame.timestamp,
      };

      parityPacket = encodeFECParityPacket(metadata, parityPayload);

      // Advance to next block
      this.currentBlockId = (this.currentBlockId + 1) >>> 0;
      this.currentFrames = [];
    }

    return { encodedAudioPacket, parityPacket };
  }

  public reset(): void {
    this.currentFrames = [];
    this.currentBlockId = 0;
  }
}

/* ------------------------------------------------------------------ */
/* FEC Receiver (De-jitter & Recovery Buffer)                         */
/* ------------------------------------------------------------------ */

interface ReceiverBlockState {
  blockId: number;
  blockSize: number;
  createdAt: number;
  frames: Map<number, AudioFrame>; // frameIndex -> AudioFrame
  parity: FECParityPacket | null;
  recoveredIndices: Set<number>;
  deliveredIndices: Set<number>;
}

export class FECReceiver {
  private blocks = new Map<string, Map<number, ReceiverBlockState>>(); // streamId -> (blockId -> State)
  private readonly expirationMs: number;
  private readonly maxBufferedBlocks: number;

  constructor(
    expirationMs = FEC_EXPIRATION_TIMEOUT_MS,
    maxBufferedBlocks = MAX_BUFFERED_BLOCKS_PER_STREAM,
  ) {
    this.expirationMs = expirationMs;
    this.maxBufferedBlocks = maxBufferedBlocks;
  }

  /**
   * Ingests a decoded FEC audio packet or parity packet.
   * Returns any newly available audio frames (in order) ready for playout.
   */
  public processPacket(
    packet: DecodedFECPacket,
    onRecovered?: (frame: AudioFrame) => void,
  ): AudioFrame[] {
    this.cleanupExpired();

    if (packet.type === AudioPacketType.AudioWithFEC) {
      return this.handleAudioPacket(packet, onRecovered);
    } else {
      return this.handleParityPacket(packet.parityPacket, onRecovered);
    }
  }

  private getStreamBlocks(streamId: string): Map<number, ReceiverBlockState> {
    let streamMap = this.blocks.get(streamId);
    if (!streamMap) {
      streamMap = new Map();
      this.blocks.set(streamId, streamMap);
    }
    return streamMap;
  }

  private handleAudioPacket(
    packet: Extract<DecodedFECPacket, { type: AudioPacketType.AudioWithFEC }>,
    onRecovered?: (frame: AudioFrame) => void,
  ): AudioFrame[] {
    const streamMap = this.getStreamBlocks(packet.frame.streamId);
    let state = streamMap.get(packet.blockId);

    if (!state) {
      if (streamMap.size >= this.maxBufferedBlocks) {
        // Discard oldest block
        const oldestKey = streamMap.keys().next().value;
        if (oldestKey !== undefined) streamMap.delete(oldestKey);
      }
      state = {
        blockId: packet.blockId,
        blockSize: packet.blockSize,
        createdAt: Date.now(),
        frames: new Map(),
        parity: null,
        recoveredIndices: new Set(),
        deliveredIndices: new Set(),
      };
      streamMap.set(packet.blockId, state);
    }

    // Check duplicate delivery
    if (state.deliveredIndices.has(packet.frameIndex)) {
      return []; // Duplicate
    }

    state.frames.set(packet.frameIndex, packet.frame);
    state.deliveredIndices.add(packet.frameIndex);

    const delivered: AudioFrame[] = [packet.frame];

    // Try recovery if parity is present
    if (state.parity) {
      const recovered = this.tryRecover(state, onRecovered);
      if (recovered) delivered.push(recovered);
    }

    return delivered;
  }

  private handleParityPacket(
    parityPacket: FECParityPacket,
    onRecovered?: (frame: AudioFrame) => void,
  ): AudioFrame[] {
    const streamMap = this.getStreamBlocks(parityPacket.metadata.streamId);
    let state = streamMap.get(parityPacket.metadata.blockId);

    if (!state) {
      if (streamMap.size >= this.maxBufferedBlocks) {
        const oldestKey = streamMap.keys().next().value;
        if (oldestKey !== undefined) streamMap.delete(oldestKey);
      }
      state = {
        blockId: parityPacket.metadata.blockId,
        blockSize: parityPacket.metadata.blockSize,
        createdAt: Date.now(),
        frames: new Map(),
        parity: parityPacket,
        recoveredIndices: new Set(),
        deliveredIndices: new Set(),
      };
      streamMap.set(parityPacket.metadata.blockId, state);
    } else {
      if (state.parity) {
        // Parity already received, ignore duplicate
        return [];
      }
      state.parity = parityPacket;
    }

    const recovered = this.tryRecover(state, onRecovered);
    return recovered ? [recovered] : [];
  }

  private tryRecover(
    state: ReceiverBlockState,
    onRecovered?: (frame: AudioFrame) => void,
  ): AudioFrame | null {
    if (!state.parity) return null;
    const { blockSize, frameLengths, baseSeq, timestamp, streamId } =
      state.parity.metadata;

    // Check if exactly one frame is missing
    const missingIndices: number[] = [];
    for (let i = 0; i < blockSize; i++) {
      if (!state.frames.has(i)) {
        missingIndices.push(i);
      }
    }

    if (missingIndices.length !== 1) {
      // 0 missing (complete block) or >= 2 missing (unrecoverable)
      return null;
    }

    const missingIdx = missingIndices[0];
    if (
      state.recoveredIndices.has(missingIdx) ||
      state.deliveredIndices.has(missingIdx)
    ) {
      return null;
    }

    try {
      const framePayloadMap = new Map<number, Uint8Array>();
      for (const [idx, frame] of state.frames.entries()) {
        framePayloadMap.set(idx, frame.payload);
      }

      const recoveredPayload = reconstructMissingFrame(
        framePayloadMap,
        frameLengths,
        state.parity.parityPayload,
        missingIdx,
      );

      const recoveredFrame: AudioFrame = {
        streamId,
        frameSeq: (baseSeq + missingIdx) >>> 0,
        timestamp, // Interpolate or reuse block timestamp
        payload: recoveredPayload,
      };

      state.frames.set(missingIdx, recoveredFrame);
      state.recoveredIndices.add(missingIdx);
      state.deliveredIndices.add(missingIdx);

      onRecovered?.(recoveredFrame);
      return recoveredFrame;
    } catch {
      // Invalid parity or reconstruction error; safe drop
      return null;
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [streamId, streamMap] of this.blocks.entries()) {
      for (const [blockId, state] of streamMap.entries()) {
        if (now - state.createdAt > this.expirationMs) {
          streamMap.delete(blockId);
        }
      }
      if (streamMap.size === 0) {
        this.blocks.delete(streamId);
      }
    }
  }

  public clear(): void {
    this.blocks.clear();
  }
}

/* ------------------------------------------------------------------ */
/* WebRTC Packet-Loss Monitoring & Adaptive Controller                */
/* ------------------------------------------------------------------ */

export interface PeerStatsSample {
  timestamp: number;
  packetsLost: number;
  packetsSent: number;
  packetsReceived: number;
}

export interface PeerLossMonitorOptions {
  /** Sampling interval in ms (e.g. 1000ms). */
  sampleIntervalMs?: number;
  /** Number of consecutive samples above threshold to activate FEC (anti-flapping). Default 1 */
  activateSamplesThreshold?: number;
  /** Number of consecutive samples at 0% loss to deactivate FEC. Default 2 */
  deactivateSamplesThreshold?: number;
}

export class PeerLossMonitor {
  private lastSample: PeerStatsSample | null = null;
  private lossRatio = 0; // [0.0, 1.0]
  private fecEnabled = false;
  private highLossCount = 0;
  private zeroLossCount = 0;

  private readonly activateSamples: number;
  private readonly deactivateSamples: number;

  constructor(options: PeerLossMonitorOptions = {}) {
    this.activateSamples = options.activateSamplesThreshold ?? 1;
    this.deactivateSamples = options.deactivateSamplesThreshold ?? 2;
  }

  /**
   * Updates stats from RTCPeerConnection.getStats() or mocked snapshot.
   * Handles:
   * - Cumulative counter deltas
   * - Counter resets (e.g. peer reconnection)
   * - Zero denominator / missing fields
   */
  public updateStats(
    rawLost: number,
    rawSentOrReceived: number,
    now = Date.now(),
  ): void {
    if (
      !Number.isFinite(rawLost) ||
      !Number.isFinite(rawSentOrReceived) ||
      rawLost < 0 ||
      rawSentOrReceived < 0
    ) {
      return;
    }

    if (!this.lastSample) {
      this.lastSample = {
        timestamp: now,
        packetsLost: rawLost,
        packetsSent: rawSentOrReceived,
        packetsReceived: rawSentOrReceived,
      };
      return;
    }

    // Delta calculation
    const deltaLost = rawLost - this.lastSample.packetsLost;
    const deltaTotal = rawSentOrReceived - this.lastSample.packetsSent;

    this.lastSample = {
      timestamp: now,
      packetsLost: rawLost,
      packetsSent: rawSentOrReceived,
      packetsReceived: rawSentOrReceived,
    };

    // If counters reset, wait for next sample
    if (deltaLost < 0 || deltaTotal < 0) {
      return;
    }

    if (deltaTotal + deltaLost <= 0) {
      // No packets transmitted or received during this interval; keep existing ratio
      return;
    }

    // Loss ratio over sampling interval
    const totalPackets = deltaTotal + deltaLost;
    const currentLossRatio = Math.max(0, Math.min(1, deltaLost / totalPackets));
    this.lossRatio = currentLossRatio;

    // Issue threshold:
    // Enable FEC when loss > 5% (0.05)
    // Disable FEC when loss returns to 0% (0.0)
    if (this.lossRatio > 0.05) {
      this.highLossCount++;
      this.zeroLossCount = 0;
      if (this.highLossCount >= this.activateSamples) {
        this.fecEnabled = true;
      }
    } else if (this.lossRatio === 0) {
      this.zeroLossCount++;
      this.highLossCount = 0;
      if (this.zeroLossCount >= this.deactivateSamples) {
        this.fecEnabled = false;
      }
    } else {
      // Between 0% and 5%: preserve state or reset transition counters
      this.highLossCount = 0;
      this.zeroLossCount = 0;
    }
  }

  public getLossRatio(): number {
    return this.lossRatio;
  }

  public getLossPercentage(): number {
    return Number((this.lossRatio * 100).toFixed(2));
  }

  public isFECEnabled(): boolean {
    return this.fecEnabled;
  }

  public reset(): void {
    this.lastSample = null;
    this.lossRatio = 0;
    this.fecEnabled = false;
    this.highLossCount = 0;
    this.zeroLossCount = 0;
  }
}

export * from "./AudioFecManager";
