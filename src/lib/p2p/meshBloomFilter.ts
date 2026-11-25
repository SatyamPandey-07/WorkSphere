/**
 * Adaptive Client-Side Scalable Bloom Filter for P2P WebRTC Mesh Deduplication
 *
 * Implements Issue #9616:
 * - O(1) duplicate suppression for high-density P2P rooms (20+ peers)
 * - False positive rate < 0.1% under 5,000 messages
 * - Bounded memory footprint strictly under 128 KB
 * - Generational dual-bitset rotation every 60 seconds
 * - Fast wire message ID extraction before JSON / Yjs deserialization
 */

export const CRDT_FRAME_MAGIC = 0x5753; // "WS" header magic
export const DEFAULT_BLOOM_CAPACITY = 5000;
export const DEFAULT_BLOOM_FPR = 0.001; // < 0.1%
export const DEFAULT_ROTATION_INTERVAL_MS = 60_000; // 60 seconds
export const MAX_MEMORY_FOOTPRINT_BYTES = 128 * 1024; // 128 KB ceiling

export interface MeshBloomFilterConfig {
  /** Maximum expected items per 60s rotation cycle (default 5000) */
  capacity?: number;
  /** Target false positive probability (default 0.001 = 0.1%) */
  targetFpr?: number;
  /** Interval in ms between generational rotations (default 60,000 ms) */
  rotationIntervalMs?: number;
  /** Whether to automatically start rotation timer on initialization (default true) */
  autoRotate?: boolean;
}

export interface BloomFilterMetrics {
  capacity: number;
  targetFpr: number;
  bitCount: number;
  hashCount: number;
  currentCount: number;
  memorySizeBytes: number;
  estimatedFpr: number;
  rotationsCount: number;
  isAutoRotating: boolean;
}

export class MeshBloomFilter {
  public readonly capacity: number;
  public readonly targetFpr: number;
  public readonly bitCount: number;
  public readonly byteSize: number;
  public readonly hashCount: number;
  public readonly rotationIntervalMs: number;

  private current: Uint8Array;
  private previous: Uint8Array;
  private currentCount = 0;
  private rotationsCount = 0;
  private rotationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: MeshBloomFilterConfig = {}) {
    this.capacity = Math.max(1, config.capacity ?? DEFAULT_BLOOM_CAPACITY);
    this.targetFpr = Math.min(
      0.5,
      Math.max(1e-9, config.targetFpr ?? DEFAULT_BLOOM_FPR),
    );
    this.rotationIntervalMs =
      config.rotationIntervalMs ?? DEFAULT_ROTATION_INTERVAL_MS;

    // Optimal bit size formula: m = ceil(-n * ln(p) / (ln(2)^2))
    // We add a safety factor of 1.25x to reliably ensure empirical FPR is well below targetFpr (<0.1%)
    // while keeping memory footprint (~20 KB) far below the 128 KB ceiling.
    const rawBits = Math.ceil(
      (-this.capacity * Math.log(this.targetFpr) * 1.25) /
        (Math.LN2 * Math.LN2),
    );
    this.bitCount = Math.max(64, rawBits);
    this.byteSize = Math.ceil(this.bitCount / 8);

    // Optimal hash function count: k = round((m / n) * ln(2))
    this.hashCount = Math.max(
      1,
      Math.round((this.bitCount / this.capacity) * Math.LN2),
    );

    // Verify memory constraint (current + previous <= 128KB)
    const totalMemory = this.byteSize * 2;
    if (totalMemory > MAX_MEMORY_FOOTPRINT_BYTES) {
      throw new RangeError(
        `Bloom filter footprint (${totalMemory} bytes) exceeds memory budget of ${MAX_MEMORY_FOOTPRINT_BYTES} bytes (128 KB)`,
      );
    }

    this.current = new Uint8Array(this.byteSize);
    this.previous = new Uint8Array(this.byteSize);

    if (config.autoRotate ?? true) {
      this.startAutoRotation();
    }
  }

  /**
   * Computes two independent 32-bit hashes (FNV-1a variants) for Kirsch-Mitzenmacher
   * double hashing: g_i(x) = (h1 + i * h2) mod m
   */
  private getHashPair(key: string | Uint8Array | number): [number, number] {
    let h1 = 0x811c9dc5;
    let h2 = 0x84222325;

    if (typeof key === "number") {
      let v = key >>> 0;
      v = Math.imul(v ^ (v >>> 16), 0x85ebca6b);
      v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35);
      h1 = (v ^ (v >>> 16)) >>> 0;

      let w = (key ^ 0x9e3779b9) >>> 0;
      w = Math.imul(w ^ (w >>> 16), 0x7feb352d);
      w = Math.imul(w ^ (w >>> 15), 0x846ca68b);
      h2 = ((w ^ (w >>> 16)) | 1) >>> 0;
      return [h1, h2];
    }

    if (typeof key === "string") {
      for (let i = 0; i < key.length; i++) {
        const code = key.charCodeAt(i);
        h1 = Math.imul(h1 ^ (code & 0xff), 0x01000193);
        h1 = Math.imul(h1 ^ (code >>> 8), 0x5bd1e995);

        h2 = Math.imul(h2 ^ (code >>> 8), 0x01000193);
        h2 = Math.imul(h2 ^ (code & 0xff), 0x5bd1e995);
      }
    } else {
      const bytes = key;
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        h1 = Math.imul(h1 ^ byte, 0x01000193);
        h2 = Math.imul(h2 ^ byte, 0x5bd1e995);
      }
    }

    // Murmur3 32-bit avalanche finalizer
    h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b);
    h1 = Math.imul(h1 ^ (h1 >>> 13), 0xc2b2ae35);
    h1 = (h1 ^ (h1 >>> 16)) >>> 0;

    h2 = Math.imul(h2 ^ (h2 >>> 16), 0x7feb352d);
    h2 = Math.imul(h2 ^ (h2 >>> 15), 0x846ca68b);
    h2 = ((h2 ^ (h2 >>> 16)) | 1) >>> 0;

    return [h1, h2];
  }

  /**
   * Generates k bit indices in O(k) = O(1) time using double hashing
   */
  private getIndices(key: string | Uint8Array | number): number[] {
    const [h1, h2] = this.getHashPair(key);
    const indices: number[] = new Array(this.hashCount);
    for (let i = 0; i < this.hashCount; i++) {
      indices[i] = ((h1 + Math.imul(i, h2)) >>> 0) % this.bitCount;
    }
    return indices;
  }

  /**
   * Checks if an identifier is in the current or previous generation bitsets
   */
  public has(key: string | Uint8Array | number): boolean {
    const indices = this.getIndices(key);

    let inCurrent = true;
    for (let i = 0; i < indices.length; i++) {
      const bitIndex = indices[i];
      if ((this.current[bitIndex >> 3] & (1 << (bitIndex & 7))) === 0) {
        inCurrent = false;
        break;
      }
    }
    if (inCurrent) return true;

    let inPrevious = true;
    for (let i = 0; i < indices.length; i++) {
      const bitIndex = indices[i];
      if ((this.previous[bitIndex >> 3] & (1 << (bitIndex & 7))) === 0) {
        inPrevious = false;
        break;
      }
    }
    return inPrevious;
  }

  /**
   * Adds an identifier to the current generation bitset
   */
  public add(key: string | Uint8Array | number): void {
    if (this.currentCount >= this.capacity) {
      this.rotate();
    }
    const indices = this.getIndices(key);
    for (let i = 0; i < indices.length; i++) {
      const bitIndex = indices[i];
      this.current[bitIndex >> 3] |= 1 << (bitIndex & 7);
    }
    this.currentCount++;
  }

  /**
   * Atomically tests if the key is present in either generation, and if not,
   * adds it to the current generation. Returns true if duplicate, false if newly added.
   * Runs in strictly O(1) time.
   */
  public testAndAdd(key: string | Uint8Array | number): boolean {
    const indices = this.getIndices(key);

    let inCurrent = true;
    for (let i = 0; i < indices.length; i++) {
      const bitIndex = indices[i];
      if ((this.current[bitIndex >> 3] & (1 << (bitIndex & 7))) === 0) {
        inCurrent = false;
        break;
      }
    }

    if (inCurrent) {
      return true; // Already present in current generation
    }

    let inPrevious = true;
    for (let i = 0; i < indices.length; i++) {
      const bitIndex = indices[i];
      if ((this.previous[bitIndex >> 3] & (1 << (bitIndex & 7))) === 0) {
        inPrevious = false;
        break;
      }
    }

    if (this.currentCount >= this.capacity) {
      this.rotate();
    }

    // Set bits in current generation
    for (let i = 0; i < indices.length; i++) {
      const bitIndex = indices[i];
      this.current[bitIndex >> 3] |= 1 << (bitIndex & 7);
    }
    this.currentCount++;

    return inPrevious;
  }

  /**
   * Rotates generation bitsets: current moves to previous, fresh current is initialized.
   * Evicts items older than 2 rotation cycles (60s - 120s sliding window).
   */
  public rotate(): void {
    this.previous = this.current;
    this.current = new Uint8Array(this.byteSize);
    this.currentCount = 0;
    this.rotationsCount++;
  }

  /**
   * Starts automatic background rotation every 60 seconds
   */
  public startAutoRotation(intervalMs?: number): void {
    this.stopAutoRotation();
    const interval = intervalMs ?? this.rotationIntervalMs;
    this.rotationTimer = setInterval(() => {
      this.rotate();
    }, interval);

    // Ensure timer does not prevent node/browser test processes from exiting cleanly
    if (
      this.rotationTimer !== null &&
      typeof (this.rotationTimer as any).unref === "function"
    ) {
      (this.rotationTimer as any).unref();
    }
  }

  /**
   * Stops the background rotation timer
   */
  public stopAutoRotation(): void {
    if (this.rotationTimer !== null) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  /**
   * Releases resources and clears bitsets
   */
  public destroy(): void {
    this.stopAutoRotation();
    this.current.fill(0);
    this.previous.fill(0);
    this.currentCount = 0;
  }

  /**
   * Extracts or computes a fast message identifier from an incoming WebRTC payload
   * before costly decompression or JSON/Yjs parsing.
   *
   * 1. If CRDT binary frame (starts with 0x5753), returns uint32 messageId at offset 4.
   * 2. Otherwise computes a fast 64-bit FNV-1a fingerprint of the byte buffer.
   */
  public extractMessageId(data: ArrayBuffer | Uint8Array): string | number {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    // Fast check for CRDT binary frame header: Magic 0x5753 (bytes 0-1)
    if (bytes.byteLength >= 16) {
      const magic = (bytes[0] << 8) | bytes[1];
      if (magic === CRDT_FRAME_MAGIC) {
        // messageId is big-endian uint32 at offset 4
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        return `crdt:${view.getUint32(4, false)}`;
      }
    }

    // Fast check for GossipSub PUBLISH packet: Version 1, Publish type 1
    // Layout: ver(1) | type(1) | hops(1) | topicLen(1) | topic | from(32) | seqno(8) | payloadLen(4) | payload | sig(64)
    // The Ed25519 signature is the final 64 bytes and remains invariant across relays (even as hops increments).
    if (bytes.byteLength >= 113 && bytes[0] === 1 && bytes[1] === 1) {
      const sigOffset = bytes.byteLength - 64;
      let s1 = 0x811c9dc5;
      let s2 = 0x84222325;
      for (let i = sigOffset; i < bytes.byteLength; i++) {
        const b = bytes[i];
        s1 = Math.imul(s1 ^ b, 0x01000193);
        s2 = Math.imul(s2 ^ b, 0x5bd1e995);
      }
      return `gossipsub:${(s1 >>> 0).toString(16)}_${(s2 >>> 0).toString(16)}`;
    }

    // Fast 64-bit FNV-1a hash of payload bytes
    let h1 = 0x811c9dc5;
    let h2 = 0x84222325;
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
      const b = bytes[i];
      h1 = Math.imul(h1 ^ b, 0x01000193);
      h2 = Math.imul(h2 ^ b, 0x5bd1e995);
    }

    return `raw:${(h1 >>> 0).toString(16)}_${(h2 >>> 0).toString(16)}_${len}`;
  }

  /**
   * Returns current filter telemetry and metrics
   */
  public getMetrics(): BloomFilterMetrics {
    const n = this.currentCount;
    const m = this.bitCount;
    const k = this.hashCount;
    // Current estimated FPR: (1 - e^(-k * n / m))^k
    const estimatedFpr = Math.pow(1 - Math.exp((-k * n) / m), k);

    return {
      capacity: this.capacity,
      targetFpr: this.targetFpr,
      bitCount: this.bitCount,
      hashCount: this.hashCount,
      currentCount: this.currentCount,
      memorySizeBytes: this.byteSize * 2,
      estimatedFpr,
      rotationsCount: this.rotationsCount,
      isAutoRotating: this.rotationTimer !== null,
    };
  }
}

export { MeshBloomFilter as ScalableBloomFilter };
export default MeshBloomFilter;
