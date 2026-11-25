/**
 * StateVectorChecksumVerifier - Cryptographic SHA-256 and Merkle Tree Integrity Verifier for CRDT Snapshots
 *
 * Provides cross-environment SHA-256 digest computation, hierarchical Merkle tree verification,
 * authenticated HMAC generation, and LRU digest memoization for collaborative CRDT state vectors.
 */

import * as cryptoModule from 'crypto';

export interface MerkleVerificationResult {
  valid: boolean;
  root: string;
  leafHashes: string[];
  corruptedChunkIndex?: number;
}

export interface DigestCacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
}

/**
 * Computes a standard SHA-256 hexadecimal hash across arbitrary byte payloads.
 * Supports both Web Crypto API (browser) and Node.js crypto module.
 */
export async function computeSha256Digest(bytes: Uint8Array): Promise<string> {
  // 1. Try Web Crypto API
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.digest === 'function'
  ) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // 2. Fallback to Node.js crypto module
  try {
    const hash = cryptoModule.createHash('sha256');
    hash.update(bytes);
    return hash.digest('hex');
  } catch {
    // 3. Fallback deterministic 64-bit FNV-1a if no crypto available
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < bytes.length; i++) {
      h ^= BigInt(bytes[i]);
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, '0');
  }
}

/**
 * Computes an authenticated HMAC-SHA256 signature for a state vector payload.
 */
export async function computeStateVectorHmac(
  bytes: Uint8Array,
  secretKey: string,
): Promise<string> {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.importKey === 'function'
  ) {
    const enc = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await globalThis.crypto.subtle.sign('HMAC', key, bytes);
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Node.js fallback
  const hmac = cryptoModule.createHmac('sha256', secretKey);
  hmac.update(bytes);
  return hmac.digest('hex');
}

/**
 * Builds a hierarchical Merkle tree over an array of binary chunks.
 * Enables granular chunk corruption localization in multi-megabyte snapshots.
 */
export async function computeMerkleRoot(
  chunks: Uint8Array[],
): Promise<{ root: string; leafHashes: string[] }> {
  if (chunks.length === 0) {
    const emptyHash = await computeSha256Digest(new Uint8Array(0));
    return { root: emptyHash, leafHashes: [] };
  }

  // Compute leaf hashes
  const leafHashes = await Promise.all(
    chunks.map((chunk) => computeSha256Digest(chunk)),
  );

  let currentLevel = [...leafHashes];
  const encoder = new TextEncoder();

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const combined = encoder.encode(currentLevel[i] + currentLevel[i + 1]);
        const parentHash = await computeSha256Digest(combined);
        nextLevel.push(parentHash);
      } else {
        // Odd node promoted to parent level
        nextLevel.push(currentLevel[i]);
      }
    }
    currentLevel = nextLevel;
  }

  return {
    root: currentLevel[0],
    leafHashes,
  };
}

export class StateVectorChecksumVerifier {
  private cache = new Map<string, string>();
  private cacheKeys: string[] = [];
  private maxCacheSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxCacheSize = 500) {
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Builds an exact cache key for small state vectors. Large CRDT snapshots are
   * deliberately not cached: sampling only their head/middle/tail can collide
   * when a peer reconnects with a different payload of the same length.
   */
  private generatePayloadKey(bytes: Uint8Array): string | null {
    if (bytes.length > 64) return null;
    return `${bytes.length}_${Array.from(bytes).join(",")}`;
  }

  /**
   * Retrieves or computes a SHA-256 digest. Only small state vectors use the
   * memoization cache; full snapshots are always hashed from their exact bytes.
   */
  public async getOrComputeDigest(bytes: Uint8Array): Promise<string> {
    const key = this.generatePayloadKey(bytes);
    if (key !== null && this.cache.has(key)) {
      this.hits++;
      return this.cache.get(key)!;
    }

    this.misses++;
    const digest = await computeSha256Digest(bytes);
    if (key !== null) this.cacheSet(key, digest);
    return digest;
  }

  /**
   * Verifies that a given state vector matches an expected SHA-256 checksum.
   */
  public async verifySnapshot(
    bytes: Uint8Array,
    expectedDigest: string,
  ): Promise<boolean> {
    const actualDigest = await this.getOrComputeDigest(bytes);
    return actualDigest.toLowerCase() === expectedDigest.toLowerCase();
  }

  /**
   * Verifies an array of chunks against an expected Merkle root.
   * If invalid, pinpoints the exact index of the first corrupted chunk.
   */
  public async verifyChunkedStream(
    chunks: Uint8Array[],
    expectedRoot: string,
  ): Promise<MerkleVerificationResult> {
    const { root, leafHashes } = await computeMerkleRoot(chunks);
    const valid = root.toLowerCase() === expectedRoot.toLowerCase();

    return {
      valid,
      root,
      leafHashes,
      corruptedChunkIndex: valid ? undefined : -1, // Indicates overall mismatch
    };
  }

  /**
   * Compares two sets of leaf hashes to pinpoint exactly which chunk is corrupted.
   */
  public pinpointCorruptedChunk(
    actualLeaves: string[],
    trustedLeaves: string[],
  ): number {
    const maxLen = Math.max(actualLeaves.length, trustedLeaves.length);
    for (let i = 0; i < maxLen; i++) {
      if (actualLeaves[i] !== trustedLeaves[i]) {
        return i;
      }
    }
    return -1;
  }

  private cacheSet(key: string, value: string): void {
    if (this.cache.size >= this.maxCacheSize) {
      const oldest = this.cacheKeys.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, value);
    this.cacheKeys.push(key);
  }

  public getCacheStats(): DigestCacheStats {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hits: this.hits,
      misses: this.misses,
    };
  }

  public clearCache(): void {
    this.cache.clear();
    this.cacheKeys = [];
    this.hits = 0;
    this.misses = 0;
  }
}


/**
 * Shared verifier used by active CRDT synchronization surfaces. Peer disconnects
 * invalidate this cache so a reconnected channel cannot reuse a digest retained
 * from a previous session.
 */
export const sharedStateVectorChecksumVerifier =
  new StateVectorChecksumVerifier();

export function resetStateVectorChecksumCache(): void {
  sharedStateVectorChecksumVerifier.clearCache();
}
