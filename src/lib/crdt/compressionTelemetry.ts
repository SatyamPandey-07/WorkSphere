/**
 * Telemetry for CRDT differential snapshot compression.
 * Tracks raw/compressed byte sizes, durations and the compression ratio
 * (ratio = 1 - compressed / raw) for compress and decompress operations.
 */

export interface CompressionTelemetrySnapshot {
  compressionOps: number;
  decompressionOps: number;
  rawBytesCompressed: number;
  compressedBytes: number;
  compressionMs: number;
  decompressionMs: number;
  /** Aggregate ratio over all recorded compressions (0 when nothing recorded). */
  compressionRatio: number;
  /** Ratio of the most recent compression (0 when nothing recorded). */
  lastCompressionRatio: number;
}

export function computeCompressionRatio(
  rawBytes: number,
  compressedBytes: number,
): number {
  if (!(rawBytes > 0)) return 0;
  return 1 - compressedBytes / rawBytes;
}

/** High-resolution timestamp in milliseconds. */
export function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

const state = {
  compressionOps: 0,
  decompressionOps: 0,
  rawBytesCompressed: 0,
  compressedBytes: 0,
  compressionMs: 0,
  decompressionMs: 0,
  lastCompressionRatio: 0,
};

export function recordCompression(
  rawBytes: number,
  compressedBytes: number,
  durationMs: number,
): void {
  state.compressionOps++;
  state.rawBytesCompressed += rawBytes;
  state.compressedBytes += compressedBytes;
  state.compressionMs += durationMs;
  state.lastCompressionRatio = computeCompressionRatio(
    rawBytes,
    compressedBytes,
  );
  if (process.env.NODE_ENV !== "test") {
    console.debug(
      `[SnapshotCompression] raw=${rawBytes}B compressed=${compressedBytes}B ` +
        `ratio=${state.lastCompressionRatio.toFixed(3)} duration=${durationMs.toFixed(2)}ms`,
    );
  }
}

export function recordDecompression(
  compressedBytes: number,
  rawBytes: number,
  durationMs: number,
): void {
  void compressedBytes;
  void rawBytes;
  state.decompressionOps++;
  state.decompressionMs += durationMs;
}

export function getCompressionTelemetry(): CompressionTelemetrySnapshot {
  return {
    ...state,
    compressionRatio: computeCompressionRatio(
      state.rawBytesCompressed,
      state.compressedBytes,
    ),
  };
}

export function resetCompressionTelemetry(): void {
  state.compressionOps = 0;
  state.decompressionOps = 0;
  state.rawBytesCompressed = 0;
  state.compressedBytes = 0;
  state.compressionMs = 0;
  state.decompressionMs = 0;
  state.lastCompressionRatio = 0;
}
