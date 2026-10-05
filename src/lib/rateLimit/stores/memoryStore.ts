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
  private readonly maxEntries: number;

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
  private static readonly TOKEN_BUCKET_MAX_IDLE_MS = 60 * 60 * 1000;

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

  getSlidingWindowEntry(key: string): MemEntry | undefined {
    return this.slidingWindowStore.get(key);
  }

  setSlidingWindowEntry(key: string, entry: MemEntry) {
    if (!this.slidingWindowStore.has(key) && this.slidingWindowStore.size >= this.maxEntries) {
      this.cleanupExpiredEntries();
      if (this.slidingWindowStore.size >= this.maxEntries) {
        const oldestKey = this.slidingWindowStore.keys().next().value;
        if (oldestKey) this.slidingWindowStore.delete(oldestKey);
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
    return this.tokenBucketStore.get(key);
  }

  setTokenBucketEntry(key: string, entry: MemoryBucketEntry) {
    if (!this.tokenBucketStore.has(key) && this.tokenBucketStore.size >= this.maxEntries) {
      this.cleanupExpiredEntries();
      if (this.tokenBucketStore.size >= this.maxEntries) {
        const oldestKey = this.tokenBucketStore.keys().next().value;
        if (oldestKey) this.tokenBucketStore.delete(oldestKey);
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
