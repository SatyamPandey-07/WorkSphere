/**
 * ChunkIntegrityVerifier.ts
 * Cryptographic SHA-256 chunk hashing and integrity verification for P2P WebRTC file share (#6483).
 *
 * Verifies each 64KB binary slice against its expected digest using Web Crypto (crypto.subtle.digest).
 * Immediately catches, discards, and requests retry for corrupted/tampered packets
 * without corrupting the reconstructed target file blob.
 */

export const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB

export interface ChunkRetryEvent {
  transferId: string;
  chunkIndex: number;
  expectedDigest: string;
  actualDigest: string;
  retryCount: number;
  maxRetriesExceeded: boolean;
}

export interface ChunkVerificationResult {
  index: number;
  verified: boolean;
  expectedDigest: string;
  actualDigest: string;
  data?: Uint8Array;
}

export interface ChunkIntegrityVerifierOptions {
  transferId: string;
  expectedDigests?: string[] | Record<number, string> | Map<number, string>;
  totalChunks?: number;
  chunkSize?: number;
  maxRetries?: number;
  onRetry?: (event: ChunkRetryEvent) => void;
  onProgress?: (verifiedChunks: number, totalChunks: number) => void;
  onComplete?: (blob: Blob) => void;
}

/**
 * Computes SHA-256 hex digest for an ArrayBuffer or Uint8Array.
 * Uses Web Crypto (crypto.subtle.digest) with fallback to Node.js crypto if subtle is unavailable.
 */
export async function computeChunkHash(
  data: ArrayBuffer | Uint8Array,
): Promise<string> {
  const buffer =
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;

  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.digest === "function"
  ) {
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Node.js crypto fallback for non-browser/test environments
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("crypto");
    const hash = nodeCrypto.createHash("sha256");
    hash.update(Buffer.from(buffer));
    return hash.digest("hex");
  } catch {
    throw new Error("No cryptographic SHA-256 implementation available");
  }
}

export class ChunkIntegrityVerifier {
  readonly transferId: string;
  readonly chunkSize: number;
  readonly maxRetries: number;

  private expectedDigests: Map<number, string> = new Map();
  private verifiedChunks: Map<number, Uint8Array> = new Map();
  private retryCounts: Map<number, number> = new Map();
  private totalChunks: number = 0;

  private retryListeners: Set<(event: ChunkRetryEvent) => void> = new Set();
  private completeListeners: Set<(blob: Blob) => void> = new Set();
  private progressListeners: Set<(verified: number, total: number) => void> =
    new Set();

  constructor(options: ChunkIntegrityVerifierOptions) {
    this.transferId = options.transferId;
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.maxRetries = options.maxRetries ?? 3;

    if (options.totalChunks) {
      this.totalChunks = options.totalChunks;
    }

    if (options.expectedDigests) {
      this.setExpectedDigests(options.expectedDigests);
    }

    if (options.onRetry) {
      this.on("retry", options.onRetry);
    }
    if (options.onProgress) {
      this.on("progress", options.onProgress);
    }
    if (options.onComplete) {
      this.on("complete", options.onComplete);
    }
  }

  /**
   * Sets the expected SHA-256 digests for all chunks in the file transfer.
   */
  setExpectedDigests(
    digests: string[] | Record<number, string> | Map<number, string>,
  ): void {
    this.expectedDigests.clear();

    if (Array.isArray(digests)) {
      digests.forEach((d, idx) => {
        this.expectedDigests.set(idx, d.toLowerCase());
      });
      this.totalChunks = digests.length;
    } else if (digests instanceof Map) {
      for (const [idx, d] of digests.entries()) {
        this.expectedDigests.set(Number(idx), d.toLowerCase());
      }
      this.totalChunks = Math.max(this.totalChunks, this.expectedDigests.size);
    } else if (typeof digests === "object") {
      for (const [idx, d] of Object.entries(digests)) {
        this.expectedDigests.set(Number(idx), (d as string).toLowerCase());
      }
      this.totalChunks = Math.max(this.totalChunks, this.expectedDigests.size);
    }
  }

  /**
   * Sets the total expected chunk count for the file.
   */
  setTotalChunks(count: number): void {
    this.totalChunks = count;
  }

  /**
   * Verifies an incoming chunk against its expected SHA-256 digest.
   * If valid: commits chunk into the verified chunk buffer.
   * If invalid/corrupted: discards chunk and emits retry event.
   */
  async verifyAndCommitChunk(
    chunkIndex: number,
    data: ArrayBuffer | Uint8Array,
  ): Promise<ChunkVerificationResult> {
    const rawBytes =
      data instanceof Uint8Array ? data : new Uint8Array(data);
    const actualDigest = await computeChunkHash(rawBytes);
    const expectedDigest = this.expectedDigests.get(chunkIndex) || "";

    const verified =
      Boolean(expectedDigest) &&
      actualDigest.toLowerCase() === expectedDigest.toLowerCase();

    if (verified) {
      // Commit verified chunk into reconstruction buffer
      this.verifiedChunks.set(chunkIndex, rawBytes);
      this.retryCounts.delete(chunkIndex);

      this.emitProgress();

      if (this.isComplete()) {
        const blob = this.getReconstructedBlob();
        if (blob) {
          this.emitComplete(blob);
        }
      }

      return {
        index: chunkIndex,
        verified: true,
        expectedDigest,
        actualDigest,
        data: rawBytes,
      };
    }

    // Integrity failure: Discard packet and trigger chunk retry
    const currentRetries = (this.retryCounts.get(chunkIndex) || 0) + 1;
    this.retryCounts.set(chunkIndex, currentRetries);

    const retryEvent: ChunkRetryEvent = {
      transferId: this.transferId,
      chunkIndex,
      expectedDigest,
      actualDigest,
      retryCount: currentRetries,
      maxRetriesExceeded: currentRetries >= this.maxRetries,
    };

    this.emitRetry(retryEvent);

    return {
      index: chunkIndex,
      verified: false,
      expectedDigest,
      actualDigest,
    };
  }

  /**
   * Checks whether all chunks have been received and verified.
   */
  isComplete(): boolean {
    if (this.totalChunks <= 0) return false;
    if (this.verifiedChunks.size !== this.totalChunks) return false;

    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.verifiedChunks.has(i)) return false;
    }
    return true;
  }

  /**
   * Returns list of missing or unverified chunk indices.
   */
  getMissingChunkIndices(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.verifiedChunks.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  /**
   * Reconstructs the full file Blob from sequentially verified chunks.
   * Returns null if any chunk is missing.
   */
  getReconstructedBlob(mimeType: string = "application/octet-stream"): Blob | null {
    if (!this.isComplete()) {
      return null;
    }

    const parts: Uint8Array[] = [];
    for (let i = 0; i < this.totalChunks; i++) {
      const chunk = this.verifiedChunks.get(i);
      if (!chunk) return null;
      parts.push(chunk);
    }

    return new Blob(parts, { type: mimeType });
  }

  getVerifiedChunkCount(): number {
    return this.verifiedChunks.size;
  }

  getRetryCount(chunkIndex: number): number {
    return this.retryCounts.get(chunkIndex) || 0;
  }

  on(event: "retry", listener: (event: ChunkRetryEvent) => void): this;
  on(event: "complete", listener: (blob: Blob) => void): this;
  on(
    event: "progress",
    listener: (verified: number, total: number) => void,
  ): this;
  on(event: string, listener: (...args: any[]) => void): this {
    if (event === "retry") this.retryListeners.add(listener);
    if (event === "complete") this.completeListeners.add(listener);
    if (event === "progress") this.progressListeners.add(listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    if (event === "retry") this.retryListeners.delete(listener);
    if (event === "complete") this.completeListeners.delete(listener);
    if (event === "progress") this.progressListeners.delete(listener);
    return this;
  }

  private emitRetry(event: ChunkRetryEvent): void {
    for (const listener of this.retryListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[ChunkIntegrityVerifier] Retry listener error:", err);
      }
    }
  }

  private emitProgress(): void {
    const verified = this.verifiedChunks.size;
    const total = this.totalChunks;
    for (const listener of this.progressListeners) {
      try {
        listener(verified, total);
      } catch (err) {
        console.error("[ChunkIntegrityVerifier] Progress listener error:", err);
      }
    }
  }

  private emitComplete(blob: Blob): void {
    for (const listener of this.completeListeners) {
      try {
        listener(blob);
      } catch (err) {
        console.error("[ChunkIntegrityVerifier] Complete listener error:", err);
      }
    }
  }

  reset(): void {
    this.verifiedChunks.clear();
    this.retryCounts.clear();
  }
}

export default ChunkIntegrityVerifier;
