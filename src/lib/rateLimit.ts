/**
 * Rate Limiting — Upstash Redis (distributed) with in-memory fallback
 *
 * Production: Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env
 * Development: Falls back to an in-memory sliding window automatically
 */

const WINDOW_MS = 60_000;

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
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return memRateLimit(identifier, limit);

  try {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const windowSeconds = Math.ceil(WINDOW_MS / 1000);
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
    return memRateLimit(identifier, limit);
  }
}

// ─── In-memory fallback (development / no Redis) ─────────────────────────────
interface MemEntry {
  count: number;
  resetTime: number;
}
const memStore = new Map<string, MemEntry>();

interface RateLimitInfo {
  count: number;
  remaining: number;
  resetTime: number;
  isLimited: boolean;
}
const rateLimitInfoStore = new Map<string, RateLimitInfo>();

const CLEANUP_INTERVAL_MS = 60_000;

function cleanupExpiredEntries() {
  const now = Date.now();

  for (const [key, value] of memStore) {
    if (now > value.resetTime) {
      memStore.delete(key);
    }
  }

  for (const [key, value] of rateLimitInfoStore) {
    if (now > value.resetTime) {
      rateLimitInfoStore.delete(key);
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

function memRateLimit(identifier: string, limit: number): boolean {
  const now = Date.now();

  const entry = memStore.get(identifier);

  if (!entry || now > entry.resetTime) {
    memStore.set(identifier, { count: 1, resetTime: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}

function memGetInfo(
  identifier: string,
  limit: number,
): { count: number; remaining: number; resetTime: number; isLimited: boolean } {
  const entry = memStore.get(identifier);
  if (!entry || Date.now() > entry.resetTime) {
    return {
      count: 0,
      remaining: limit,
      resetTime: Date.now() + WINDOW_MS,
      isLimited: false,
    };
  }
  return {
    count: entry.count,
    remaining: Math.max(0, limit - entry.count),
    resetTime: entry.resetTime,
    isLimited: entry.count >= limit,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the request should be allowed, false if rate-limited.
 * Prefers Upstash Redis; falls back to in-memory when env vars are absent.
 */
export async function rateLimit(
  identifier: string,
  limit = 10,
): Promise<boolean> {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return upstashRateLimit(identifier, limit);
  }

  return memRateLimit(identifier, limit);
}

export async function getRateLimitInfo(
  identifier: string,
  limit = 10,
): Promise<{
  count: number;
  remaining: number;
  resetTime: number;
  isLimited: boolean;
} | null> {
  return memGetInfo(identifier, limit);
}

/** Reset in-memory rate limit (useful in tests). */
export function resetRateLimit(identifier?: string): void {
  if (identifier) {
    memStore.delete(identifier);
    rateLimitInfoStore.delete(identifier);
  } else {
    memStore.clear();
    rateLimitInfoStore.clear();
  }
}

export function resetRedisScripts(): void {
  redisClient = null;
}

export function microTimestampMember(
  sec: number | string,
  usec: number,
  nonce: string,
): string {
  const padUsec = String(usec).padStart(6, "0");
  return `${sec}${padUsec}:${nonce}`;
}
