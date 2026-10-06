export interface MemEntry {
  timestamps: number[];
  resetTime: number;
}

export interface MemoryBucketEntry {
  tokens: number;
  lastRefill: number;
}

export class MemoryRateLimitStore {
  private slidingWindowStore = new Map<string, MemEntry>();
  private tokenBucketStore = new Map<string, MemoryBucketEntry>();
  public readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
    this.initCleanup();
  }

  private initCleanup() {
    const globalCleanup = globalThis as typeof globalThis & {
      __rateLimitCleanupTimer?: NodeJS.Timeout;
    };

    if (!globalCleanup.__rateLimitCleanupTimer) {
      globalCleanup.__rateLimitCleanupTimer = setInterval(
        () => this.cleanupExpiredEntries(),
        60_000,
      );
      globalCleanup.__rateLimitCleanupTimer.unref?.();
    }
  }

  /** Buckets idle longer than this are full again, so they can be dropped. */
  public static readonly TOKEN_BUCKET_MAX_IDLE_MS = 60 * 60 * 1000;

  cleanupExpiredEntries() {
    const now = Date.now();
    for (const [key, value] of this.slidingWindowStore) {
      if (now > value.resetTime) {
        this.slidingWindowStore.delete(key);
      }
    }
    for (const [key, value] of this.tokenBucketStore) {
      if (now - value.lastRefill > MemoryRateLimitStore.TOKEN_BUCKET_MAX_IDLE_MS) {
        this.tokenBucketStore.delete(key);
      }
    }
  }

  get slidingWindowSize(): number {
    return this.slidingWindowStore.size;
  }

  get tokenBucketSize(): number {
    return this.tokenBucketStore.size;
  }

  get size(): number {
    return this.slidingWindowStore.size + this.tokenBucketStore.size;
  }

  getSlidingWindowEntry(key: string): MemEntry | undefined {
    const entry = this.slidingWindowStore.get(key);
    if (entry) {
      // Re-insert to refresh LRU order
      this.slidingWindowStore.delete(key);
      this.slidingWindowStore.set(key, entry);
    }
    return entry;
  }

  setSlidingWindowEntry(key: string, entry: MemEntry) {
    if (this.slidingWindowStore.has(key)) {
      this.slidingWindowStore.delete(key);
    } else if (this.slidingWindowStore.size >= this.maxEntries) {
      this.cleanupExpiredEntries();
      while (this.slidingWindowStore.size >= this.maxEntries) {
        const oldestKey = this.slidingWindowStore.keys().next().value;
        if (oldestKey !== undefined) {
          this.slidingWindowStore.delete(oldestKey);
        } else {
          break;
        }
      }
    }
    this.slidingWindowStore.set(key, entry);
  }

  deleteSlidingWindowEntry(key: string) {
    this.slidingWindowStore.delete(key);
  }

  clearSlidingWindow() {
    this.slidingWindowStore.clear();
  }

  getTokenBucketEntry(key: string): MemoryBucketEntry | undefined {
    const entry = this.tokenBucketStore.get(key);
    if (entry) {
      // Re-insert to refresh LRU order
      this.tokenBucketStore.delete(key);
      this.tokenBucketStore.set(key, entry);
    }
    return entry;
  }

  setTokenBucketEntry(key: string, entry: MemoryBucketEntry) {
    if (this.tokenBucketStore.has(key)) {
      this.tokenBucketStore.delete(key);
    } else if (this.tokenBucketStore.size >= this.maxEntries) {
      this.cleanupExpiredEntries();
      while (this.tokenBucketStore.size >= this.maxEntries) {
        const oldestKey = this.tokenBucketStore.keys().next().value;
        if (oldestKey !== undefined) {
          this.tokenBucketStore.delete(oldestKey);
        } else {
          break;
        }
      }
    }
    this.tokenBucketStore.set(key, entry);
  }

  deleteTokenBucketEntry(key: string) {
    this.tokenBucketStore.delete(key);
  }

  clearTokenBuckets() {
    this.tokenBucketStore.clear();
  }

  clearAll() {
    this.slidingWindowStore.clear();
    this.tokenBucketStore.clear();
  }
}

export const defaultMemoryStore = new MemoryRateLimitStore();
