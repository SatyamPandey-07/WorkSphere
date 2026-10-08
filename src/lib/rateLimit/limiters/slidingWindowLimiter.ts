import type { IRateLimiter, RateLimitResult, TierConfig } from "../types";
import { defaultMemoryStore, MemoryRateLimitStore } from "../stores/memoryStore";
import {
  getRedisClient,
  getCachedLimiter,
  setCachedLimiter,
  microTimestampMember,
  executeAtomicSlidingWindow,
} from "../stores/redisStore";

export interface SlidingWindowOptions {
  limit: number;
  windowMs: number;
  namespace?: string;
  store?: MemoryRateLimitStore;
}

export class SlidingWindowLimiter implements IRateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly namespace: string;
  private memoryStore: MemoryRateLimitStore;

  constructor(options: SlidingWindowOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.namespace = options.namespace || "default";
    this.memoryStore = options.store || defaultMemoryStore;
  }

  async consume(key: string, points = 1): Promise<RateLimitResult> {
    const now = Date.now();
    const redis = getRedisClient();
    if (redis) {
      const redisKey = `worksphere:ratelimit:${this.namespace}:${key}`;
      const storeKey = `${this.namespace}:${key}`;

      // Enforce strict sub-bucket pruning & eviction of disconnected fallback entries on Redis reconnect (#5037)
      await this.pruneAndSyncMemoryOnReconnect(redis, redisKey, storeKey, now);

      const atomicResult = await executeAtomicSlidingWindow(
        redis,
        redisKey,
        this.limit,
        this.windowMs,
        now
      );
      if (atomicResult !== null) {
        return atomicResult;
      }
    }

    return this.consumeMemory(key, points);
  }

  private async pruneAndSyncMemoryOnReconnect(
    redis: any,
    redisKey: string,
    storeKey: string,
    now: number
  ): Promise<void> {
    const windowStart = now - this.windowMs;
    const memoryEntry = this.memoryStore.getSlidingWindowEntry(storeKey);
    if (!memoryEntry || !memoryEntry.timestamps || memoryEntry.timestamps.length === 0) {
      return;
    }

    // Purge expired sub-bucket timestamps older than windowStart (now - windowMs)
    const validTimestamps = memoryEntry.timestamps.filter((ts) => ts > windowStart);

    if (validTimestamps.length > 0) {
      for (const ts of validTimestamps) {
        const member = microTimestampMember(
          Math.floor(ts / 1000),
          (ts % 1000) * 1000,
          Math.random().toString(36).slice(2, 10)
        );
        try {
          if (typeof redis.zadd === "function") {
            await redis.zadd(redisKey, { score: ts, member });
          }
        } catch {
          // Non-blocking sync retry
        }
      }
    }

    // Purge local in-memory sub-bucket entry after syncing valid timestamps to Redis
    this.memoryStore.deleteSlidingWindowEntry(storeKey);
  }

  private consumeMemory(key: string, _points = 1): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const storeKey = `${this.namespace}:${key}`;

    let entry = this.memoryStore.getSlidingWindowEntry(storeKey);
    if (!entry) {
      entry = { timestamps: [], resetTime: now + this.windowMs };
      this.memoryStore.setSlidingWindowEntry(storeKey, entry);
    }

    let firstValid = 0;
    while (
      firstValid < entry.timestamps.length &&
      entry.timestamps[firstValid] <= windowStart
    ) {
      firstValid++;
    }
    if (firstValid > 0) {
      entry.timestamps = entry.timestamps.slice(firstValid);
    }

    if (entry.timestamps.length >= this.limit) {
      const resetTimeMs = entry.timestamps[0] + this.windowMs;
      const reset = Math.ceil(resetTimeMs / 1000);
      const retryAfter = Math.max(1, Math.ceil((resetTimeMs - now) / 1000));
      return {
        success: false,
        limit: this.limit,
        remaining: 0,
        reset,
        retryAfter,
        identity: key,
      };
    }

    entry.timestamps.push(now);
    entry.resetTime = now + this.windowMs;
    const remaining = Math.max(0, this.limit - entry.timestamps.length);
    const reset = Math.ceil((entry.timestamps[0] + this.windowMs) / 1000);

    return {
      success: true,
      limit: this.limit,
      remaining,
      reset,
      retryAfter: 0,
      identity: key,
    };
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const redis = getRedisClient();
    if (redis) {
      const redisKey = `worksphere:ratelimit:${this.namespace}:${key}`;
      const storeKey = `${this.namespace}:${key}`;
      await this.pruneAndSyncMemoryOnReconnect(redis, redisKey, storeKey, now);
    }

    const windowStart = now - this.windowMs;
    const storeKey = `${this.namespace}:${key}`;

    const entry = this.memoryStore.getSlidingWindowEntry(storeKey);
    if (!entry) {
      return {
        success: true,
        limit: this.limit,
        remaining: this.limit,
        reset: Math.ceil((now + this.windowMs) / 1000),
        retryAfter: 0,
        identity: key,
      };
    }

    let firstValid = 0;
    while (
      firstValid < entry.timestamps.length &&
      entry.timestamps[firstValid] <= windowStart
    ) {
      firstValid++;
    }
    const validCount = entry.timestamps.length - firstValid;
    const resetTimeMs =
      validCount > 0
        ? entry.timestamps[firstValid] + this.windowMs
        : now + this.windowMs;
    const reset = Math.ceil(resetTimeMs / 1000);

    return {
      success: validCount < this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - validCount),
      reset,
      retryAfter:
        validCount >= this.limit
          ? Math.max(1, Math.ceil((resetTimeMs - now) / 1000))
          : 0,
      identity: key,
    };
  }

  reset(key?: string): void {
    if (key) {
      this.memoryStore.deleteSlidingWindowEntry(`${this.namespace}:${key}`);
    } else {
      this.memoryStore.clearSlidingWindow();
    }
  }
}
