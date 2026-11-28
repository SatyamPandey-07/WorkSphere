/**
 * Yjs Document Update Compression & Decompression Utility.
 *
 * - v1 (sync LZ77): compressYjsUpdate / decompressYjsUpdate — used by the
 *   WebRTC mesh whiteboard and fallback environments without Web Streams.
 * - v2 wire codec (#1728 / #9440): compressYjsUpdateAsync / decompressYjsUpdateAsync
 *   and encodeYjsWirePayload / decodeYjsWirePayload use native browser
 *   CompressionStream('br' | 'deflate-raw') when available for payloads > 512 bytes,
 *   with a lightweight LZ77/raw fallback when streams are unsupported.
 */

import * as Y from "yjs";

// 4-byte Magic Header: 'Y' 'Z' 'C' version 1 -> 0x59, 0x5a, 0x43, 0x01
export const COMPRESSION_MAGIC_HEADER = new Uint8Array([
  0x59, 0x5a, 0x43, 0x01,
]);

/** Payloads <= 512 bytes bypass stream compression where framing overhead outweighs gains. */
export const MIN_COMPRESSIBLE_BYTES = 512;

/**
 * Synchronously compresses a Yjs document update Uint8Array payload using LZ77.
 * Encodes repeated byte sequences and window matches, prepending the v1 magic header.
 */
export function compressYjsUpdate(rawInput: Uint8Array): Uint8Array {
  if (!rawInput) {
    return new Uint8Array(0);
  }
  const input =
    rawInput instanceof Uint8Array
      ? rawInput
      : new Uint8Array(rawInput as ArrayLike<number>);

  if (input.byteLength === 0) {
    return new Uint8Array(0);
  }

  // Small payloads (< 16 bytes) don't benefit from LZ77 compression
  if (input.byteLength < 16) {
    return input;
  }

  const headerLen = COMPRESSION_MAGIC_HEADER.length;
  const output = new Uint8Array(headerLen + 4 + input.byteLength * 2);
  output.set(COMPRESSION_MAGIC_HEADER, 0);
  
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
      output[outIdx++] = 0x80;
      output[outIdx++] = matchLength;
      output[outIdx++] = (matchOffset >> 8) & 0xff;
      output[outIdx++] = matchOffset & 0xff;
      inIdx += matchLength;
    } else {
      const byteVal = input[inIdx++];
      if (byteVal === 0x80) {
        output[outIdx++] = 0x80;
        output[outIdx++] = 0x00;
      } else {
        output[outIdx++] = byteVal;
      }
    }
  }

  const compressedData = output.subarray(0, outIdx);
  if (compressedData.length < input.length) {
    return compressedData;
  }
  return input;
}

/**
 * Synchronously decompresses a v1 LZ77 binary Yjs update packet.
 * If header does not match, transparently returns original uncompressed payload.
 */
export function decompressYjsUpdate(input: Uint8Array): Uint8Array {
  if (!input || input.length < 8) {
    return input ?? new Uint8Array(0);
  }

  for (let i = 0; i < COMPRESSION_MAGIC_HEADER.length; i++) {
    if (input[i] !== COMPRESSION_MAGIC_HEADER[i]) {
      return input;
    }
  }

  const headerLen = COMPRESSION_MAGIC_HEADER.length;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const uncompressedSize = view.getUint32(headerLen, false);

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

// ─── v2 streaming wire codec (#1728 / #9440) ────────────────────────────────

/** 'Y' 'Z' 'C' version 2, followed by a one-byte codec id. */
export const WIRE_MAGIC_V2 = new Uint8Array([0x59, 0x5a, 0x43, 0x02]);

export const WireCodec = {
  RAW: 0x00,
  DEFLATE_RAW: 0x01,
  BROTLI: 0x02,
  LZ77: 0x03,
} as const;

export const MAX_DECODED_BYTES = 10 * 1024 * 1024;

export class YjsWireError extends Error {}

export function isNativeCompressionAvailable(): boolean {
  return (
    typeof CompressionStream === "function" &&
    typeof DecompressionStream === "function"
  );
}

function getPreferredStreamFormat(): "br" | "deflate-raw" | null {
  if (!isNativeCompressionAvailable()) return null;
  try {
    // Prefer streaming Brotli when runtime supports 'br', otherwise 'deflate-raw'
    new CompressionStream("br" as CompressionFormat);
    new DecompressionStream("br" as CompressionFormat);
    return "br";
  } catch {
    try {
      new CompressionStream("deflate-raw");
      new DecompressionStream("deflate-raw");
      return "deflate-raw";
    } catch {
      return null;
    }
  }
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

async function pipeThrough(
  bytes: Uint8Array,
  transform: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<BufferSource>;
  },
  limit: number,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  const writing = writer
    .write(bytes as BufferSource)
    .then(() => writer.close());
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
 * Asynchronously compresses a Yjs update using native streaming Brotli or
 * CompressionStream('deflate-raw') for payloads larger than 512 bytes,
 * with an LZ77 fallback when Web Streams are unsupported.
 */
export async function compressYjsUpdateAsync(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  if (!bytes || bytes.length === 0) {
    return new Uint8Array(0);
  }

  // Only compress payloads larger than 512 bytes where compression yields net benefit
  if (bytes.length <= MIN_COMPRESSIBLE_BYTES) {
    return bytes;
  }

  const format = getPreferredStreamFormat();
  if (format !== null) {
    try {
      const compressed = await pipeThrough(
        bytes,
        new CompressionStream(format as CompressionFormat),
        Number.MAX_SAFE_INTEGER,
      );
      const codec =
        format === "br" ? WireCodec.BROTLI : WireCodec.DEFLATE_RAW;
      const framed = frame(codec, compressed);
      if (framed.length < bytes.length) {
        return framed;
      }
    } catch {
      // Fall through to lightweight fallback
    }
  }

  // Fallback for environments without CompressionStream support
  const lz77 = compressYjsUpdate(bytes);
  if (lz77.length < bytes.length) {
    return frame(WireCodec.LZ77, lz77);
  }

  return bytes;
}

/**
 * Asynchronously decompresses a Yjs update produced by compressYjsUpdateAsync,
 * encodeYjsWirePayload, or legacy v1/raw payloads.
 */
export async function decompressYjsUpdateAsync(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  if (!bytes || bytes.length === 0) {
    return new Uint8Array(0);
  }
  return decodeYjsWirePayload(bytes);
}

/**
 * Encodes a Yjs update for the wire with a v2 header frame.
 * Compresses payloads > 512 bytes via streaming Brotli or deflate-raw (or LZ77 fallback).
 */
export async function encodeYjsWirePayload(
  update: Uint8Array,
): Promise<Uint8Array> {
  if (update.length > MIN_COMPRESSIBLE_BYTES) {
    const format = getPreferredStreamFormat();
    if (format !== null) {
      try {
        const compressed = await pipeThrough(
          update,
          new CompressionStream(format as CompressionFormat),
          Number.MAX_SAFE_INTEGER,
        );
        const codec =
          format === "br" ? WireCodec.BROTLI : WireCodec.DEFLATE_RAW;
        if (compressed.length < update.length) {
          return frame(codec, compressed);
        }
      } catch {
        // Fall through to LZ77 / RAW
      }
    } else {
      const lz77 = compressYjsUpdate(update);
      if (lz77.length < update.length) {
        return frame(WireCodec.LZ77, lz77);
      }
    }
  }
  return frame(WireCodec.RAW, update);
}

/**
 * Decodes a payload produced by encodeYjsWirePayload or compressYjsUpdateAsync.
 * Also accepts legacy v1 LZ77 packets and bare Yjs updates.
 */
export async function decodeYjsWirePayload(
  payload: Uint8Array,
): Promise<Uint8Array> {
  if (hasPrefix(payload, WIRE_MAGIC_V2)) {
    if (payload.length < WIRE_MAGIC_V2.length + 1) {
      throw new YjsWireError("Truncated wire frame");
    }
    const codec = payload[WIRE_MAGIC_V2.length];
    const body = payload.subarray(WIRE_MAGIC_V2.length + 1);

    if (codec === WireCodec.RAW) return body;
    if (codec === WireCodec.LZ77) {
      return decompressYjsUpdate(body);
    }
    if (codec === WireCodec.BROTLI || codec === WireCodec.DEFLATE_RAW) {
      const format = codec === WireCodec.BROTLI ? "br" : "deflate-raw";
      if (!isNativeCompressionAvailable()) {
        throw new YjsWireError(`${format} is not supported on this platform`);
      }
      try {
        return await pipeThrough(
          body,
          new DecompressionStream(format as CompressionFormat),
          MAX_DECODED_BYTES,
        );
      } catch (err) {
        if (err instanceof YjsWireError) throw err;
        throw new YjsWireError(`Corrupt ${format} payload`);
      }
    }
    throw new YjsWireError(`Unknown wire codec 0x${codec.toString(16)}`);
  }

  if (hasPrefix(payload, COMPRESSION_MAGIC_HEADER)) {
    return decompressYjsUpdate(payload);
  }
  return payload;
}

// ─── Keystroke batching (#1728) ─────────────────────────────────────────────

export interface YjsUpdateBatcherOptions {
  onFlush: (mergedUpdate: Uint8Array) => void;
  windowMs?: number;
  maxPendingBytes?: number;
}

export interface YjsUpdateBatcher {
  push(update: Uint8Array): void;
  flush(): void;
  dispose(): void;
  readonly pendingCount: number;
}

export function createYjsUpdateBatcher(
  options: YjsUpdateBatcherOptions,
): YjsUpdateBatcher {
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
        flush();
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