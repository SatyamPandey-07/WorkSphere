/**
 * Yjs Document Update Compression & Decompression Utility.
 *
 * - v1 (sync LZ77): compressYjsUpdate / decompressYjsUpdate — used by the
 *   WebRTC mesh whiteboard.
 * - v2 wire codec (#1728): encodeYjsWirePayload / decodeYjsWirePayload use the
 *   browser's native, asynchronous CompressionStream("deflate-raw"), so large
 *   sync payloads are (de)compressed without blocking the render thread.
 * - createYjsUpdateBatcher (#1728): coalesces high-frequency keystroke updates
 *   with Y.mergeUpdates. Per-message envelope overhead (AES-GCM tag + IV,
 *   base64, JSON) dwarfs a ~20-byte keystroke update, so batching is what cuts
 *   bandwidth for active typing sessions; compression wins on large syncs.
 */

import * as Y from "yjs";

// 4-byte Magic Header: 'Y' 'Z' 'C' version 1 -> 0x59, 0x5a, 0x43, 0x01
export const COMPRESSION_MAGIC_HEADER = new Uint8Array([
  0x59, 0x5a, 0x43, 0x01,
]);

/**
 * Compresses a Yjs document update Uint8Array payload.
 * Encodes repeated byte sequences and window matches, prepending the magic header.
 */
export function compressYjsUpdate(input: Uint8Array): Uint8Array {
  if (!input || input.length === 0) {
    return new Uint8Array(0);
  }

  // Small payloads (< 16 bytes) don't benefit from compression
  if (input.length < 16) {
    return input;
  }

  const headerLen = COMPRESSION_MAGIC_HEADER.length;
  // Allocate buffer for header + 4-byte uncompressed size + encoded data
  const output = new Uint8Array(headerLen + 4 + input.length * 2);
  output.set(COMPRESSION_MAGIC_HEADER, 0);

  // Store uncompressed size in BigEndian format
  const view = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  view.setUint32(headerLen, input.length, false);

  let inIdx = 0;
  let outIdx = headerLen + 4;
  const WINDOW_SIZE = 2048;

  while (inIdx < input.length) {
    let matchOffset = 0;
    let matchLength = 0;

    // Search window for LZ77 byte sequence match
    const windowStart = Math.max(0, inIdx - WINDOW_SIZE);
    for (let j = inIdx - 1; j >= windowStart; j--) {
      let len = 0;
      while (
        inIdx + len < input.length &&
        input[j + len] === input[inIdx + len] &&
        len < 255
      ) {
        len++;
      }
      if (len > matchLength) {
        matchLength = len;
        matchOffset = inIdx - j;
        if (matchLength >= 255) break;
      }
    }

    if (matchLength >= 3) {
      // Token 0x80: Match tag -> [0x80, matchLength, offsetHigh, offsetLow]
      output[outIdx++] = 0x80;
      output[outIdx++] = matchLength;
      output[outIdx++] = (matchOffset >> 8) & 0xff;
      output[outIdx++] = matchOffset & 0xff;
      inIdx += matchLength;
    } else {
      const byteVal = input[inIdx++];
      if (byteVal === 0x80) {
        // Escape literal 0x80 as [0x80, 0x00]
        output[outIdx++] = 0x80;
        output[outIdx++] = 0x00;
      } else {
        output[outIdx++] = byteVal;
      }
    }
  }

  const compressedData = output.subarray(0, outIdx);
  // Return compressed payload if smaller than original
  if (compressedData.length < input.length) {
    return compressedData;
  }
  return input;
}

/**
 * Decompresses a binary Yjs update packet.
 * If header does not match, transparently returns original uncompressed payload.
 */
export function decompressYjsUpdate(input: Uint8Array): Uint8Array {
  if (!input || input.length < 8) {
    return input ?? new Uint8Array(0);
  }

  // Check 4-byte magic header
  for (let i = 0; i < COMPRESSION_MAGIC_HEADER.length; i++) {
    if (input[i] !== COMPRESSION_MAGIC_HEADER[i]) {
      return input; // Uncompressed legacy packet
    }
  }

  const headerLen = COMPRESSION_MAGIC_HEADER.length;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const uncompressedSize = view.getUint32(headerLen, false);

  // Guard against maliciously large or corrupt size fields that would cause
  // an out-of-memory crash when allocating the output buffer.
  // 10 MB is well above any real Yjs document update; PartyKit caps messages at ~1 MB.
  const MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB
  if (uncompressedSize === 0 || uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
    console.warn(
      `[yjsCompression] Refusing to decompress: claimed size ${uncompressedSize} bytes exceeds safe limit`,
    );
    return input;
  }

  const output = new Uint8Array(uncompressedSize);
  let inIdx = headerLen + 4;
  let outIdx = 0;

  while (inIdx < input.length && outIdx < uncompressedSize) {
    const token = input[inIdx++];
    if (token === 0x80) {
      const len = input[inIdx++];
      if (len === 0x00) {
        // Literal 0x80 byte
        output[outIdx++] = 0x80;
      } else {
        const offsetHigh = input[inIdx++];
        const offsetLow = input[inIdx++];
        const offset = (offsetHigh << 8) | offsetLow;
        for (let k = 0; k < len; k++) {
          output[outIdx] = output[outIdx - offset];
          outIdx++;
        }
      }
    } else {
      output[outIdx++] = token;
    }
  }

  return output;
}

/**
 * Calculates compression percentage size reduction: ((original - compressed) / original) * 100
 */
export function getCompressionRatio(
  originalLen: number,
  compressedLen: number,
): number {
  if (originalLen <= 0) return 0;
  return Math.max(0, ((originalLen - compressedLen) / originalLen) * 100);
}

// ─── v2 wire codec (#1728) ──────────────────────────────────────────────────

/** 'Y' 'Z' 'C' version 2, followed by a one-byte codec id. */
export const WIRE_MAGIC_V2 = new Uint8Array([0x59, 0x5a, 0x43, 0x02]);

export const WireCodec = {
  RAW: 0x00,
  DEFLATE_RAW: 0x01,
} as const;

/** Below this, deflate's own overhead means it can't win. */
export const MIN_COMPRESSIBLE_BYTES = 64;

/** Same ceiling as the v1 decoder: far above any real Yjs update. */
export const MAX_DECODED_BYTES = 10 * 1024 * 1024;

export class YjsWireError extends Error {}

/** True when the platform provides native CompressionStream / DecompressionStream. */
export function isNativeCompressionAvailable(): boolean {
  return (
    typeof CompressionStream === "function" &&
    typeof DecompressionStream === "function"
  );
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function frame(codec: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(WIRE_MAGIC_V2.length + 1 + body.length);
  out.set(WIRE_MAGIC_V2, 0);
  out[WIRE_MAGIC_V2.length] = codec;
  out.set(body, WIRE_MAGIC_V2.length + 1);
  return out;
}

/**
 * Pipe bytes through a native (de)compression stream. The work happens in
 * the browser's stream machinery; this function only awaits chunks, so the
 * main thread stays free to render. Aborts once output exceeds `limit`.
 */
async function pipeThrough(
  bytes: Uint8Array,
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
  limit: number,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Write and close without awaiting: the reader below drives the stream,
  // and awaiting first would deadlock once the internal queue fills up.
  const writing = writer.write(bytes as BufferSource).then(() => writer.close());
  writing.catch(() => {});

  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new YjsWireError(`Decoded payload exceeds ${limit} bytes`);
    }
    chunks.push(value);
  }
  await writing;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Encode a Yjs update (or state-as-update diff) for the wire. Always framed
 * with the v2 header so receivers never have to guess; deflated only when
 * that is actually smaller. Compress BEFORE encrypting — ciphertext is
 * incompressible.
 */
export async function encodeYjsWirePayload(update: Uint8Array): Promise<Uint8Array> {
  if (update.length >= MIN_COMPRESSIBLE_BYTES && isNativeCompressionAvailable()) {
    try {
      const deflated = await pipeThrough(
        update,
        new CompressionStream("deflate-raw"),
        Number.MAX_SAFE_INTEGER,
      );
      if (deflated.length < update.length) {
        return frame(WireCodec.DEFLATE_RAW, deflated);
      }
    } catch {
      // fall through to an uncompressed frame
    }
  }
  return frame(WireCodec.RAW, update);
}

/**
 * Decode a payload produced by encodeYjsWirePayload. Also accepts legacy v1
 * LZ77 packets and bare Yjs updates from clients that predate the codec.
 * Throws YjsWireError on corrupt, oversized or unsupported payloads.
 */
export async function decodeYjsWirePayload(payload: Uint8Array): Promise<Uint8Array> {
  if (hasPrefix(payload, WIRE_MAGIC_V2)) {
    if (payload.length < WIRE_MAGIC_V2.length + 1) {
      throw new YjsWireError("Truncated wire frame");
    }
    const codec = payload[WIRE_MAGIC_V2.length];
    const body = payload.subarray(WIRE_MAGIC_V2.length + 1);

    if (codec === WireCodec.RAW) return body;
    if (codec === WireCodec.DEFLATE_RAW) {
      if (!isNativeCompressionAvailable()) {
        throw new YjsWireError("deflate-raw is not supported on this platform");
      }
      try {
        return await pipeThrough(body, new DecompressionStream("deflate-raw"), MAX_DECODED_BYTES);
      } catch (err) {
        if (err instanceof YjsWireError) throw err;
        throw new YjsWireError("Corrupt deflate-raw payload");
      }
    }
    throw new YjsWireError(`Unknown wire codec 0x${codec.toString(16)}`);
  }

  if (hasPrefix(payload, COMPRESSION_MAGIC_HEADER)) {
    return decompressYjsUpdate(payload); // legacy v1 sender
  }
  return payload; // bare update from a pre-codec client
}

// ─── Keystroke batching (#1728) ─────────────────────────────────────────────

export interface YjsUpdateBatcherOptions {
  /** Called with one merged update per batch. */
  onFlush: (mergedUpdate: Uint8Array) => void;
  /**
   * Minimum gap between flushes. The first update after an idle period is
   * sent immediately (leading edge); bursts within the window are merged.
   * This is also the maximum added latency. Default 400 ms: the smallest
   * window that cuts wire bytes by 60%+ at 10 chars/s (65%; 82% at 20 chars/s).
   */
  windowMs?: number;
  /** Flush early once this many bytes are pending (e.g. a paste). Default 64 KB. */
  maxPendingBytes?: number;
}

export interface YjsUpdateBatcher {
  push(update: Uint8Array): void;
  /** Send anything pending right now (e.g. before unload). */
  flush(): void;
  /** Flush pending updates and stop. */
  dispose(): void;
  readonly pendingCount: number;
}

export function createYjsUpdateBatcher(options: YjsUpdateBatcherOptions): YjsUpdateBatcher {
  const windowMs = options.windowMs ?? 400;
  const maxPendingBytes = options.maxPendingBytes ?? 64 * 1024;

  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let lastFlushAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    pendingBytes = 0;
    lastFlushAt = Date.now();
    options.onFlush(batch.length === 1 ? batch[0] : Y.mergeUpdates(batch));
  };

  return {
    push(update) {
      if (disposed || update.length === 0) return;
      pending.push(update);
      pendingBytes += update.length;

      if (pendingBytes >= maxPendingBytes) {
        flush();
        return;
      }
      if (timer !== null) return;

      const wait = lastFlushAt + windowMs - Date.now();
      if (wait <= 0) {
        flush(); // idle: send immediately, no added latency
      } else {
        timer = setTimeout(flush, wait);
      }
    },
    flush,
    dispose() {
      flush();
      disposed = true;
    },
    get pendingCount() {
      return pending.length;
    },
  };
}
