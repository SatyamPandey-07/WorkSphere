import type { IRateLimiter, RateLimitResult, RateTier } from "../types";
import { defaultMemoryStore, MemoryRateLimitStore } from "../stores/memoryStore";
import {
  getRedisClient,
  getCachedLimiter,
  setCachedLimiter,
  executeAtomicTokenBucket,
} from "../stores/redisStore";

export interface TokenBucketOptions {
  limit: number;
  windowMs: number;
  interval?: string;
  name?: string;
  store?: MemoryRateLimitStore;
}

export class TokenBucketLimiter implements IRateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly interval: string;
  readonly name: string;
  private memoryStore: MemoryRateLimitStore;

  constructor(options: TokenBucketOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.interval = options.interval || "1 m";
    this.name = options.name || "default";
    this.memoryStore = options.store || defaultMemoryStore;
  }

  async consume(key: string, points = 1): Promise<RateLimitResult> {
    const distributedResult = await this.checkDistributed(key, points);
    if (distributedResult !== null) {
      return distributedResult;
    }
    return this.consumeMemory(key, points);
  }

  private async checkDistributed(
    identifier: string,
    points = 1,
  ): Promise<RateLimitResult | null> {
    const redis = getRedisClient();
    if (redis) {
      const redisKey = `worksphere:ratelimit:${this.name}:${identifier}`;
      const atomicResult = await executeAtomicTokenBucket(
        redis,
        redisKey,
        this.limit,
        this.windowMs,
        points
      );
      if (atomicResult !== null) {
        return atomicResult;
      }
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;

    try {
      let limiter = getCachedLimiter(this.name);
      if (!limiter) {
        let RedisClass: any;
        try {
          const edgeRedis = await import("@upstash/redis/cloudflare");
          RedisClass = edgeRedis.Redis;
        } catch {
          const defaultRedis = await import("@upstash/redis");
          RedisClass = defaultRedis.Redis;
        }
        const ratelimitPkg = await import("@upstash/ratelimit");
        const RatelimitClass = ratelimitPkg.Ratelimit;

        if (typeof RedisClass !== "function" || typeof RatelimitClass !== "function") {
          return null;
        }

        const redis = new RedisClass({ url, token });
        limiter = new RatelimitClass({
          redis,
          limiter: RatelimitClass.tokenBucket(this.limit, this.interval as any, this.limit),
          prefix: `worksphere:ratelimit:${this.name}`,
        });
        setCachedLimiter(this.name, limiter);
      }

      const result = await limiter.limit(identifier, { rate: points });
      const now = Date.now();
      const resetTimeSec = Math.ceil(result.reset / 1000);
      const retryAfter = Math.max(1, Math.ceil((result.reset - now) / 1000));

      return {
        success: Boolean(result.success),
        limit: this.limit,
        remaining: Math.max(0, result.remaining ?? 0),
        reset: resetTimeSec,
        retryAfter,
        identity: identifier,
      };
    } catch {
      return null;
    }
  }

  private consumeMemory(identifier: string, points = 1): RateLimitResult {
    const now = Date.now();
    const safePoints = Math.max(1, Number.isFinite(points) ? points : 1);
    const bucketKey = `${this.name}:${identifier}`;
    let bucket = this.memoryStore.getTokenBucketEntry(bucketKey);

    if (!bucket) {
      bucket = {
        tokens: this.limit,
        lastRefill: now,
        windowMs: this.windowMs,
        maxTokens: this.limit,
      };
      this.memoryStore.setTokenBucketEntry(bucketKey, bucket);
    } else {
      bucket.windowMs = this.windowMs;
      bucket.maxTokens = this.limit;
    }

    // Guard against backward clock jumps / clock skew
    if (now < bucket.lastRefill) {
      bucket.lastRefill = now;
    }

    // Refill tokens proportionally to elapsed time
    const elapsed = Math.max(0, now - bucket.lastRefill);
    if (elapsed > 0) {
      const refillTokens = (elapsed / this.windowMs) * this.limit;
      bucket.tokens = Math.min(this.limit, Math.max(0, bucket.tokens) + refillTokens);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= safePoints) {
      bucket.tokens = Math.max(0, bucket.tokens - safePoints);
      this.memoryStore.setTokenBucketEntry(bucketKey, bucket);
      const remaining = Math.floor(bucket.tokens);
      const resetSec = Math.ceil((now + this.windowMs) / 1000);
      return {
        success: true,
        limit: this.limit,
        remaining,
        reset: resetSec,
        retryAfter: 0,
        identity: identifier,
      };
    }

    // Bucket depleted: persist latest token/refill state to avoid stale resets
    this.memoryStore.setTokenBucketEntry(bucketKey, bucket);
    const needed = Math.max(1, safePoints - bucket.tokens);
    const timeToNextTokenMs = Math.ceil((needed / this.limit) * this.windowMs);
    const retryAfter = Math.max(1, Math.ceil(timeToNextTokenMs / 1000));
    const resetSec = Math.ceil((now + timeToNextTokenMs) / 1000);

    return {
      success: false,
      limit: this.limit,
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      reset: resetSec,
      retryAfter,
      identity: identifier,
    };
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const redis = getRedisClient();
    if (redis) {
      const redisKey = `worksphere:ratelimit:${this.name}:${key}`;
      const atomicResult = await executeAtomicTokenBucket(
        redis,
        redisKey,
        this.limit,
        this.windowMs,
        0,
        now,
      );
      if (atomicResult !== null) {
        return atomicResult;
      }
    }

    const bucketKey = `${this.name}:${key}`;
    const bucket = this.memoryStore.getTokenBucketEntry(bucketKey);

    if (!bucket) {
      return {
        success: true,
        limit: this.limit,
        remaining: this.limit,
        reset: Math.ceil((now + this.windowMs) / 1000),
        retryAfter: 0,
        identity: key,
      };
    }

    const elapsed = Math.max(0, now - bucket.lastRefill);
    const currentTokens = Math.min(
      this.limit,
      Math.max(0, bucket.tokens) + (elapsed > 0 ? (elapsed / this.windowMs) * this.limit : 0),
    );

    const remaining = Math.max(0, Math.floor(currentTokens));
    const timeToNextTokenMs = Math.ceil(((Math.max(1, 1 - currentTokens)) / this.limit) * this.windowMs);
    return {
      success: currentTokens >= 1,
      limit: this.limit,
      remaining,
      reset: Math.ceil((now + (currentTokens >= 1 ? this.windowMs : timeToNextTokenMs)) / 1000),
      retryAfter: currentTokens < 1 ? Math.max(1, Math.ceil(timeToNextTokenMs / 1000)) : 0,
      identity: key,
    };
  }

  reset(key?: string): void {
    if (key) {
      this.memoryStore.deleteTokenBucketEntry(`${this.name}:${key}`);
    } else {
      this.memoryStore.clearTokenBuckets();
    }
  }
}
