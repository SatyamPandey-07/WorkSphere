/**
 * Distributed Counting Bloom Filter Rate Limiter for Edge Runtime
 * 
 * Provides fallback rate limiting during Redis outages/partitioning using a 64KB (524,288 4-bit counters)
 * Counting Bloom Filter with asynchronous KV state gossip synchronization.
 */

export interface EdgeKVStore {
  get(key: string, type?: "arrayBuffer"): Promise<ArrayBuffer | null>;
  put(key: string, value: ArrayBuffer, options?: { expirationTtl?: number }): Promise<void>;
}

export interface BloomLimiterOptions {
  sizeBytes?: number; // Default 64KB (65,536 bytes)
  hashFunctionsCount?: number; // k = 4 hash functions for <1% FPR at 100k items
  thresholdCount?: number; // Max request count before blocking
  gossipKey?: string;
  kvStore?: EdgeKVStore;
}

export class DistributedBloomLimiter {
  private sizeBytes: number;
  private totalCounters: number;
  private counters: Uint8Array; // 4-bit counters packed into 8-bit array (2 counters per byte)
  private hashCount: number;
  private threshold: number;
  private gossipKey: string;
  private kvStore?: EdgeKVStore;

  constructor(options: BloomLimiterOptions = {}) {
    this.sizeBytes = options.sizeBytes || 65536; // 64KB
    this.totalCounters = this.sizeBytes * 2; // 131,072 4-bit counters
    this.counters = new Uint8Array(this.sizeBytes);
    this.hashCount = options.hashFunctionsCount || 4;
    this.threshold = options.thresholdCount || 10;
    this.gossipKey = options.gossipKey || "dtn_bloom_limiter_state";
    this.kvStore = options.kvStore;
  }

  /**
   * Fast MurmurHash3 / FNV1a-derived hashing for Edge runtime
   */
  private hash(key: string, seed: number): number {
    let h = seed ^ key.length;
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995);
      h ^= h >>> 13;
    }
    return Math.abs(h % this.totalCounters);
  }

  private getCounter(index: number): number {
    const byteIndex = Math.floor(index / 2);
    const isHigh = index % 2 === 1;
    const byte = this.counters[byteIndex];
    return isHigh ? (byte >> 4) & 0x0f : byte & 0x0f;
  }

  private incrementCounter(index: number): number {
    const byteIndex = Math.floor(index / 2);
    const isHigh = index % 2 === 1;
    let current = this.getCounter(index);
    if (current < 15) { // Saturation cap at 15 for 4-bit counter
      current++;
      if (isHigh) {
        this.counters[byteIndex] = (this.counters[byteIndex] & 0x0f) | (current << 4);
      } else {
        this.counters[byteIndex] = (this.counters[byteIndex] & 0xf0) | current;
      }
    }
    return current;
  }

  /**
   * Checks whether an IP request should be rate-limited and increments counts.
   */
  public checkAndIncrement(ip: string): { limited: boolean; maxCount: number } {
    let maxCount = 0;
    const indices: number[] = [];

    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(ip, i * 0x9e3779b9);
      indices.push(idx);
      const val = this.getCounter(idx);
      if (val > maxCount) maxCount = val;
    }

    if (maxCount >= this.threshold) {
      return { limited: true, maxCount };
    }

    // Increment all counters for this IP
    let newMax = 0;
    for (const idx of indices) {
      const val = this.incrementCounter(idx);
      if (val > newMax) newMax = val;
    }

    return { limited: newMax >= this.threshold, maxCount: newMax };
  }

  /**
   * Synchronizes Bloom filter state asynchronously with the Edge KV store (5s gossip cycle)
   */
  public async syncGossipState(): Promise<void> {
    if (!this.kvStore) return;

    try {
      const remoteBuffer = await this.kvStore.get(this.gossipKey, "arrayBuffer");
      if (remoteBuffer) {
        const remoteCounters = new Uint8Array(remoteBuffer);
        // Element-wise maximum merge to retain maximum observed count across edge instances
        for (let i = 0; i < this.sizeBytes; i++) {
          this.counters[i] = Math.max(this.counters[i], remoteCounters[i]);
        }
      }

      // Publish merged state back to Edge KV with 10s TTL
     // Create a clean ArrayBuffer copy from the typed array
const bufferToStore = this.counters.buffer.slice(
  this.counters.byteOffset,
  this.counters.byteOffset + this.counters.byteLength
) as ArrayBuffer;

await this.kvStore.put(this.gossipKey, bufferToStore, { expirationTtl: 10 });
    } catch (err) {
      console.error("[BloomLimiter] Gossip state synchronization failed:", err);
    }
  }

  public exportState(): Uint8Array {
    return new Uint8Array(this.counters);
  }

  public importState(data: Uint8Array): void {
    if (data.length === this.sizeBytes) {
      this.counters.set(data);
    }
  }
}