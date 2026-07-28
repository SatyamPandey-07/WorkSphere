/**
 * Rate Limiting — Upstash Redis (distributed) with in-memory fallback
 *
 * Production: Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env
 * Development: Falls back to an in-memory sliding window automatically
 */

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

// ─── Public API ───────────────────────────────────────────────────────────────

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
