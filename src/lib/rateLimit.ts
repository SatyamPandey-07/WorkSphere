/**
 * Rate Limiting — Upstash Redis (distributed) with in-memory fallback
 *
 * Production: Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env
 * Development: Falls back to an in-memory sliding window automatically
 */

import { auth } from "@clerk/nextjs/server";
import { Ratelimit } from "@upstash/ratelimit";
import { NextResponse } from "next/server";

const DEFAULT_WINDOW_MS = 60_000;

let redisClient: any = null;

function getRedisClient() {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  if (redisClient) return redisClient;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis");
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return redisClient;
  } catch {
    return null;
  }
}

/**
 * Sliding-window check in one MULTI/EXEC:
 * ZREMRANGEBYSCORE → ZADD → ZCARD → EXPIRE.
 * Avoids Lua `eval` timeouts under ~200 RPS while keeping prune+count+write atomic
 * so concurrent bursts cannot all pass on a stale ZCARD (issue #1034).
 */
async function upstashRateLimit(
  identifier: string,
  limit: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return memRateLimit(identifier, limit, windowMs);

  try {
    const now = Date.now();
    const windowStart = now - windowMs;
    const windowSeconds = Math.ceil(windowMs / 1000);
    const key = `worksphere:ratelimit:${identifier}`;
    const member = microTimestampMember(
      Math.floor(now / 1000),
      (now % 1000) * 1000,
      `${Math.random().toString(36).slice(2, 10)}`,
    );

    const tx = redis.multi();
    tx.zremrangebyscore(key, 0, windowStart);
    tx.zadd(key, { score: now, member });
    tx.zcard(key);
    tx.expire(key, windowSeconds);
    const result = await tx.exec();

    // MULTI result order: rem, add, card, expire
    const count = Number(result?.[2] ?? 0);
    if (count > limit) {
      await redis.zrem(key, member);
      return false;
    }

    return true;
  } catch {
    return memRateLimit(identifier, limit, windowMs);
  }
}

// ─── In-memory fallback (development / no Redis) ─────────────────────────────
interface MemEntry {
  timestamps: number[];
  resetTime: number;
}
const memStore = new Map<string, MemEntry>();

const CLEANUP_INTERVAL_MS = 60_000;
const MAX_MEM_ENTRIES = 10_000;

function cleanupExpiredEntries() {
  const now = Date.now();

  for (const [key, value] of memStore) {
    if (now > value.resetTime) {
      memStore.delete(key);
    }
  }
}

const globalCleanup = globalThis as typeof globalThis & {
  __rateLimitCleanupTimer?: NodeJS.Timeout;
};

if (!globalCleanup.__rateLimitCleanupTimer) {
  globalCleanup.__rateLimitCleanupTimer = setInterval(
    cleanupExpiredEntries,
    CLEANUP_INTERVAL_MS,
  );

  globalCleanup.__rateLimitCleanupTimer.unref?.();
}

function memRateLimit(
  identifier: string,
  limit: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): boolean {
  const now = Date.now();
  const start = now - windowMs;

  let entry = memStore.get(identifier);
  if (!entry) {
    if (memStore.size >= MAX_MEM_ENTRIES) {
      cleanupExpiredEntries();
      if (memStore.size >= MAX_MEM_ENTRIES) {
        const oldestKey = memStore.keys().next().value;
        if (oldestKey) memStore.delete(oldestKey);
      }
    }
    entry = { timestamps: [], resetTime: now + windowMs };
    memStore.set(identifier, entry);
  }

  let firstValid = 0;
  while (
    firstValid < entry.timestamps.length &&
    entry.timestamps[firstValid] <= start
  ) {
    firstValid++;
  }
  if (firstValid > 0) {
    entry.timestamps = entry.timestamps.slice(firstValid);
  }

  if (entry.timestamps.length >= limit) {
    return false;
  }

  entry.timestamps.push(now);
  entry.resetTime = now + windowMs;
  return true;
}

function memGetInfo(
  identifier: string,
  limit: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): { count: number; remaining: number; resetTime: number; isLimited: boolean } {
  const now = Date.now();
  const start = now - windowMs;

  const entry = memStore.get(identifier);
  if (!entry) {
    return {
      count: 0,
      remaining: limit,
      resetTime: now + windowMs,
      isLimited: false,
    };
  }

  let firstValid = 0;
  while (
    firstValid < entry.timestamps.length &&
    entry.timestamps[firstValid] <= start
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

// ─── Public API (Legacy) ─────────────────────────────────────────────────────

/**
 * Returns true if the request should be allowed, false if rate-limited.
 * Prefers Upstash Redis; falls back to in-memory when env vars are absent.
 */
export async function rateLimit(
  identifier: string,
  limit = 10,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<boolean> {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return upstashRateLimit(identifier, limit, windowMs);
  }

  return memRateLimit(identifier, limit, windowMs);
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
  return memGetInfo(identifier, limit, windowMs);
}

export function resetRateLimit(identifier?: string): void {
  if (identifier) {
    memStore.delete(identifier);
  } else {
    memStore.clear();
    upstashLimiters.clear();
  }
}

export function resetRedisScripts(): void {
  redisClient = null;
  upstashLimiters.clear();
}

export function microTimestampMember(
  sec: number | string,
  usec: number,
  nonce: string,
): string {
  const padUsec = String(usec).padStart(6, "0");
  return `${sec}${padUsec}:${nonce}`;
}

// ─── Tier-Based Sliding Window Rate Limiter (#3475) ──────────────────────────

export type RateLimitTier = "anonymous" | "authenticated";

export interface TierConfig {
  readonly limit: number;
  readonly windowMs: number;
  readonly windowDuration:
    `${number} m` | `${number}m` | `${number} s` | `${number}s`;
}

/**
 * Tiered Rate Limiting profiles:
 * - Anonymous: 10 requests / 15 minutes, identified by client IP.
 * - Authenticated: 60 requests / 15 minutes, identified by Clerk user ID.
 */
export const TIER_CONFIGS: Record<RateLimitTier, TierConfig> = {
  anonymous: {
    limit: 10,
    windowMs: 15 * 60 * 1000, // 900,000 ms = 15 minutes
    windowDuration: "15 m",
  },
  authenticated: {
    limit: 60,
    windowMs: 15 * 60 * 1000, // 900,000 ms = 15 minutes
    windowDuration: "15 m",
  },
} as const;

export interface TieredRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number; // in seconds
  reset: number; // epoch ms
  tier: RateLimitTier;
  identity: string;
}

export interface CheckTieredRateLimitOptions {
  /** Explicit user ID override (e.g. for testing or pre-authenticated requests). If undefined, calls auth() from @clerk/nextjs/server */
  userId?: string | null;
  /** Explicit client IP override (e.g. for testing) */
  ip?: string;
  /** Namespace prefix for rate limiting (default: "ai-public") */
  namespace?: string;
}

// Cached Upstash Ratelimit instances keyed by `${namespace}:${tier}`
const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(
  redis: any,
  namespace: string,
  tier: RateLimitTier,
): Ratelimit {
  const cacheKey = `${namespace}:${tier}`;
  let limiter = upstashLimiters.get(cacheKey);
  if (!limiter) {
    const config = TIER_CONFIGS[tier];
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.limit, config.windowDuration),
      prefix: `worksphere:ratelimit:${namespace}:${tier}`,
    });
    upstashLimiters.set(cacheKey, limiter);
  }
  return limiter;
}

/**
 * Safely extracts the client IP from request headers.
 * Respects proxy headers (X-Forwarded-For, X-Real-IP) and falls back to loopback.
 */
export function getClientIp(reqOrHeaders: Request | Headers): string {
  const headers =
    reqOrHeaders instanceof Headers ? reqOrHeaders : reqOrHeaders.headers;

  if (
    "ip" in reqOrHeaders &&
    typeof (reqOrHeaders as any).ip === "string" &&
    (reqOrHeaders as any).ip.trim()
  ) {
    return (reqOrHeaders as any).ip.trim();
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }

  return "127.0.0.1";
}

/**
 * In-memory sliding-window fallback for local development, offline mode,
 * and graceful degradation if Upstash Redis fails in production.
 */
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

  let entry = memStore.get(key);
  if (!entry) {
    if (memStore.size >= MAX_MEM_ENTRIES) {
      cleanupExpiredEntries();
      if (memStore.size >= MAX_MEM_ENTRIES) {
        const oldestKey = memStore.keys().next().value;
        if (oldestKey) memStore.delete(oldestKey);
      }
    }
    entry = { timestamps: [], resetTime: now + windowMs };
    memStore.set(key, entry);
  }

  // Prune timestamps older than sliding window
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

/**
 * Inspect in-memory rate limit info without consuming quota.
 */
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

  const entry = memStore.get(key);
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

/**
 * Main tiered rate-limiting check.
 * Identifies the tier (anonymous vs authenticated), checks the sliding window
 * via Upstash Redis (if configured) or in-memory fallback, and returns a detailed result.
 */
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

  // Upstash Redis when configured
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

  // In-memory fallback (offline / local development / unconfigured Upstash)
  return memTieredRateLimit(namespace, tier, identity, config);
}

/**
 * Standard rate-limit headers:
 * - X-RateLimit-Limit
 * - X-RateLimit-Remaining
 * - Retry-After (included when request is blocked)
 */
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
 * Creates standard HTTP 429 Too Many Requests response with rate-limit headers.
 */
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

/**
 * Attaches X-RateLimit headers to any successful Response or NextResponse.
 */
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
  upstashLimiters.clear();
}
