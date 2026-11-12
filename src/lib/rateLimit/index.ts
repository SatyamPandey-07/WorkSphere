/**
 * WorkSphere Unified Rate Limiting Framework
 * Provides algorithm strategies (TokenBucketLimiter, SlidingWindowLimiter)
 * with support for Memory, Redis, or Edge stores and centralized tier configs.
 */

import { NextResponse } from "next/server";
import type {
  RateLimitTier,
  RateTier,
  TierConfig,
  RateLimitResult,
  TieredRateLimitResult,
  CheckTieredRateLimitOptions,
} from "./types";
import { TIER_CONFIGS, getClientIp } from "./config";
import { defaultMemoryStore } from "./stores/memoryStore";
import {
  getRedisClient,
  getCachedLimiter,
  setCachedLimiter,
  clearCachedLimiters,
} from "./stores/redisStore";
import { SlidingWindowLimiter } from "./limiters/slidingWindowLimiter";
import { TokenBucketLimiter } from "./limiters/tokenBucketLimiter";

export * from "./types";
export * from "./config";
export * from "./stores/memoryStore";
export * from "./stores/redisStore";
export * from "./limiters/slidingWindowLimiter";
export * from "./limiters/tokenBucketLimiter";
export * from "./slidingWindowRateLimiter";
export * from "./lua/slidingWindowScript";

const DEFAULT_WINDOW_MS = 60_000;

// ─── Legacy & Utility Functions ──────────────────────────────────────────────

/**
 * Returns true if the request should be allowed, false if rate-limited.
 * Prefers Upstash Redis; falls back to in-memory when env vars are absent.
 */
export async function rateLimit(
  identifier: string,
  limit = 10,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<boolean> {
  const limiter = new SlidingWindowLimiter({
    limit,
    windowMs,
    namespace: "default",
  });
  const result = await limiter.consume(identifier);
  return result.success;
}

export async function getRateLimitInfo(
  identifier: string,
  limit = 10,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<{
  count: number;
  remaining: number;
  resetTime: number;
  isLimited: boolean;
} | null> {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  const limiter = new SlidingWindowLimiter({
    limit,
    windowMs,
    namespace: "default",
  });
  const result = await limiter.check(identifier);
  return {
    count: limit - result.remaining,
    remaining: result.remaining,
    resetTime: result.reset,
    isLimited: !result.success,
  };
}

export function resetRateLimit(identifier?: string): void {
  if (identifier) {
    defaultMemoryStore.deleteSlidingWindowEntry(`default:${identifier}`);
    defaultMemoryStore.deleteSlidingWindowEntry(identifier);
  } else {
    defaultMemoryStore.clearAll();
    clearCachedLimiters();
  }
}

// ─── Token Bucket Convenience APIs ───────────────────────────────────────────

/**
 * Token-bucket rate limit check for a route tier; consumes one token when allowed.
 *
 * The bucket holds `tier.limit` tokens and refills at `tier.limit` per
 * `tier.windowMs`, so short bursts up to the limit are allowed. Storage, in order:
 * 1. Upstash Redis atomic Lua script (key `worksphere:ratelimit:<tier.name>:<identifier>`)
 * 2. `@upstash/ratelimit` token bucket
 * 3. the per-instance memory store ({@link checkInMemoryTokenBucket})
 *
 * Redis is only used when both `UPSTASH_REDIS_REST_*` env vars are set. A Redis
 * **timeout** fails open (request allowed with full `remaining`); other Redis
 * errors fall through to the next option.
 *
 * @param tier - Tier from `RATE_TIERS`, usually via `matchRateTier(pathname)`.
 * @param identifier - Who is being limited, e.g. client IP or user ID.
 * @returns The result; `reset` is in epoch **seconds** and `retryAfter` in seconds.
 *
 * @example
 * ```ts
 * import {
 *   checkTokenBucketRateLimit,
 *   createRateLimitResponse,
 *   getClientIp,
 *   matchRateTier,
 * } from "@/lib/rateLimit";
 *
 * const tier = matchRateTier(req.nextUrl.pathname, req.method);
 * if (tier) {
 *   const result = await checkTokenBucketRateLimit(tier, getClientIp(req));
 *   if (!result.success) return createRateLimitResponse(result);
 * }
 * ```
 */
export async function checkTokenBucketRateLimit(
  tier: RateTier,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = new TokenBucketLimiter({
    limit: tier.limit,
    windowMs: tier.windowMs,
    interval: tier.interval,
    name: tier.name,
  });
  return limiter.consume(identifier);
}

/**
 * Synchronous in-memory token-bucket check; consumes one token when allowed.
 *
 * Never uses Redis, so state is per server instance. The bucket for
 * `<tier.name>:<identifier>` starts full (`tier.limit` tokens) and refills
 * proportionally to elapsed time; a backwards clock jump does not add tokens.
 *
 * @param tier - Tier from `RATE_TIERS`.
 * @param identifier - Who is being limited, e.g. client IP or user ID.
 * @returns The result; `remaining` is the whole tokens left, `reset` is in
 *   epoch **seconds**, and `retryAfter` (when blocked) is the seconds until the
 *   next token, minimum 1.
 */
export function checkInMemoryTokenBucket(
  tier: RateTier,
  identifier: string,
): RateLimitResult {
  const now = Date.now();
  const bucketKey = `${tier.name}:${identifier}`;
  let bucket = defaultMemoryStore.getTokenBucketEntry(bucketKey);

  if (!bucket) {
    bucket = {
      tokens: tier.limit,
      lastRefill: now,
      windowMs: tier.windowMs,
      maxTokens: tier.limit,
    };
    defaultMemoryStore.setTokenBucketEntry(bucketKey, bucket);
  } else {
    bucket.windowMs = tier.windowMs;
    bucket.maxTokens = tier.limit;
  }

  // Guard against backward clock jumps / clock skew
  if (now < bucket.lastRefill) {
    bucket.lastRefill = now;
  }

  // Refill tokens proportionally to elapsed time
  const elapsed = Math.max(0, now - bucket.lastRefill);
  if (elapsed > 0) {
    const refillTokens = (elapsed / tier.windowMs) * tier.limit;
    bucket.tokens = Math.min(
      tier.limit,
      Math.max(0, bucket.tokens) + refillTokens,
    );
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens = Math.max(0, bucket.tokens - 1);
    defaultMemoryStore.setTokenBucketEntry(bucketKey, bucket);
    const remaining = Math.floor(bucket.tokens);
    const resetSec = Math.ceil((now + tier.windowMs) / 1000);
    return {
      success: true,
      limit: tier.limit,
      remaining,
      reset: resetSec,
      retryAfter: 0,
      identity: identifier,
    };
  }

  // Bucket depleted: persist state and calculate required wait time
  defaultMemoryStore.setTokenBucketEntry(bucketKey, bucket);
  const needed = Math.max(1, 1 - bucket.tokens);
  const timeToNextTokenMs = Math.ceil((needed / tier.limit) * tier.windowMs);
  const retryAfter = Math.max(1, Math.ceil(timeToNextTokenMs / 1000));
  const resetSec = Math.ceil((now + timeToNextTokenMs) / 1000);

  return {
    success: false,
    limit: tier.limit,
    remaining: Math.max(0, Math.floor(bucket.tokens)),
    reset: resetSec,
    retryAfter,
    identity: identifier,
  };
}

/**
 * Clears all in-memory token buckets and cached Upstash limiters. Intended for
 * tests; does not touch Redis.
 */
export function resetTokenBuckets(): void {
  defaultMemoryStore.clearTokenBuckets();
  clearCachedLimiters();
}

// ─── Tier-Based Sliding Window Convenience APIs ──────────────────────────────

export function memTieredRateLimit(
  namespace: string,
  tier: RateLimitTier,
  identity: string,
  config: TierConfig = TIER_CONFIGS[tier],
): TieredRateLimitResult {
  const now = Date.now();
  const windowMs = config.windowMs;
  const limit = config.limit;
  const key = `worksphere:ratelimit:${namespace}:${tier}:${identity}`;

  let entry = defaultMemoryStore.getSlidingWindowEntry(key);
  if (!entry) {
    entry = { timestamps: [], resetTime: now + windowMs };
    defaultMemoryStore.setSlidingWindowEntry(key, entry);
  }

  const windowStart = now - windowMs;
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

  if (entry.timestamps.length >= limit) {
    const reset = entry.timestamps[0] + windowMs;
    const retryAfter = Math.max(1, Math.ceil((reset - now) / 1000));
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfter,
      reset,
      tier,
      identity,
    };
  }

  entry.timestamps.push(now);
  entry.resetTime = now + windowMs;
  const remaining = Math.max(0, limit - entry.timestamps.length);
  const reset = entry.timestamps[0] + windowMs;

  return {
    allowed: true,
    limit,
    remaining,
    retryAfter: 0,
    reset,
    tier,
    identity,
  };
}

export function getTieredRateLimitInfo(
  namespace: string,
  tier: RateLimitTier,
  identity: string,
  config: TierConfig = TIER_CONFIGS[tier],
): { count: number; remaining: number; resetTime: number; isLimited: boolean } {
  const now = Date.now();
  const windowMs = config.windowMs;
  const limit = config.limit;
  const key = `worksphere:ratelimit:${namespace}:${tier}:${identity}`;

  const entry = defaultMemoryStore.getSlidingWindowEntry(key);
  if (!entry) {
    return {
      count: 0,
      remaining: limit,
      resetTime: now + windowMs,
      isLimited: false,
    };
  }

  const windowStart = now - windowMs;
  let firstValid = 0;
  while (
    firstValid < entry.timestamps.length &&
    entry.timestamps[firstValid] <= windowStart
  ) {
    firstValid++;
  }
  const validCount = entry.timestamps.length - firstValid;
  const resetTime =
    validCount > 0 ? entry.timestamps[firstValid] + windowMs : now + windowMs;

  return {
    count: validCount,
    remaining: Math.max(0, limit - validCount),
    resetTime,
    isLimited: validCount >= limit,
  };
}

function getUpstashLimiter(
  redis: any,
  namespace: string,
  tier: RateLimitTier,
): any {
  const cacheKey = `${namespace}:${tier}`;
  let limiter = getCachedLimiter(cacheKey);
  if (!limiter) {
    const config = TIER_CONFIGS[tier];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Ratelimit } = require("@upstash/ratelimit");
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        config.limit,
        (config.windowDuration || "15 m") as any,
      ),
      prefix: `worksphere:ratelimit:${namespace}:${tier}`,
    });
    setCachedLimiter(cacheKey, limiter);
  }
  return limiter;
}

export async function checkTieredRateLimit(
  req: Request | Headers,
  options?: CheckTieredRateLimitOptions,
): Promise<TieredRateLimitResult> {
  const namespace = options?.namespace ?? "ai-public";

  let userId: string | null = null;
  if (options && "userId" in options) {
    userId = options.userId ?? null;
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { auth } = require("@clerk/nextjs/server");
      const authResult = await auth();
      userId = authResult?.userId ?? null;
    } catch {
      userId = null;
    }
  }

  let tier: RateLimitTier;
  let identity: string;

  if (userId && typeof userId === "string" && userId.trim().length > 0) {
    tier = "authenticated";
    identity = userId.trim();
  } else {
    tier = "anonymous";
    identity = options?.ip ?? getClientIp(req);
  }

  const config = TIER_CONFIGS[tier];

  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    const redis = getRedisClient();
    if (redis) {
      try {
        const limiter = getUpstashLimiter(redis, namespace, tier);
        const result = await limiter.limit(identity);
        if (result.pending) {
          void Promise.resolve(result.pending).catch(() => {});
        }
        const reset = result.reset ?? Date.now() + config.windowMs;
        const retryAfter = result.success
          ? 0
          : Math.max(1, Math.ceil((reset - Date.now()) / 1000));

        return {
          allowed: result.success,
          limit: result.limit ?? config.limit,
          remaining: Math.max(0, result.remaining),
          retryAfter,
          reset,
          tier,
          identity,
        };
      } catch (err) {
        console.error(
          "Upstash Redis rate limit error, falling back to in-memory:",
          err,
        );
        return memTieredRateLimit(namespace, tier, identity, config);
      }
    }
  }

  return memTieredRateLimit(namespace, tier, identity, config);
}

export function getRateLimitHeaders(
  result: TieredRateLimitResult,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(Math.max(1, result.retryAfter));
  }
  return headers;
}

/**
 * Parses a Retry-After header value into whole seconds to wait.
 * Supports integer seconds and HTTP-date formats.
 */
export function parseRetryAfterHeader(
  headerValue: string | null | undefined,
  fallbackSeconds = 60,
): number {
  if (!headerValue) return fallbackSeconds;
  const parsedInt = parseInt(headerValue, 10);
  if (!isNaN(parsedInt)) return Math.max(1, parsedInt);
  const dateMs = Date.parse(headerValue);
  if (!isNaN(dateMs)) {
    return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return fallbackSeconds;
}

export function createRateLimitResponse(
  result: TieredRateLimitResult,
): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: getRateLimitHeaders(result),
    },
  );
}

export function applyRateLimitHeaders<T extends Response>(
  response: T,
  result: TieredRateLimitResult,
): T {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set(
    "X-RateLimit-Remaining",
    String(Math.max(0, result.remaining)),
  );
  if (!result.allowed) {
    response.headers.set("Retry-After", String(Math.max(1, result.retryAfter)));
  }
  return response;
}

export function resetTieredRateLimit(identifier?: string): void {
  resetRateLimit(identifier);
  clearCachedLimiters();
}
