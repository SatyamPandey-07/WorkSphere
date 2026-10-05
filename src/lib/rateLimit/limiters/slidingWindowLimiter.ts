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
    const redis = getRedisClient();
    if (redis) {
      const redisKey = `worksphere:ratelimit:${this.namespace}:${key}`;
      const atomicResult = await executeAtomicSlidingWindow(
        redis,
        redisKey,
        this.limit,
        this.windowMs
      );
      if (atomicResult !== null) {
        return atomicResult;
      }
    }

    return this.consumeMemory(key, points);
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
      const reset = entry.timestamps[0] + this.windowMs;
      const retryAfter = Math.max(1, Math.ceil((reset - now) / 1000));
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
    const reset = entry.timestamps[0] + this.windowMs;

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
    const windowStart = now - this.windowMs;
    const storeKey = `${this.namespace}:${key}`;

    const entry = this.memoryStore.getSlidingWindowEntry(storeKey);
    if (!entry) {
      return {
        success: true,
        limit: this.limit,
        remaining: this.limit,
        reset: now + this.windowMs,
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
    const reset = validCount > 0 ? entry.timestamps[firstValid] + this.windowMs : now + this.windowMs;

    return {
      success: validCount < this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - validCount),
      reset,
      retryAfter: validCount >= this.limit ? Math.max(1, Math.ceil((reset - now) / 1000)) : 0,
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
