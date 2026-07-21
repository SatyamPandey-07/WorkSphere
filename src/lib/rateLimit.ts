/**
 * Rate Limiting — Upstash Redis (distributed) with in-memory fallback
 *
 * Production: Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env
 * Development: Falls back to an in-memory sliding window automatically
 */

/**
 * Token Bucket Rate Limiting Lua Script for Upstash Redis.
 *
 * Uses a hash to store (tokens, lastRefill) and atomically refills tokens
 * based on elapsed time. Handles concurrent burst traffic correctly because
 * the Lua script executes atomically — no duplicate-member issue that the
 * previous sliding-window ZADD approach had.
 */
export const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local window_seconds = tonumber(ARGV[3])

local state = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(state[1])
local lastRefill = tonumber(state[2])

if tokens == nil then
    redis.call('HMSET', key, 'tokens', limit - 1, 'lastRefill', now)
    redis.call('EXPIRE', key, window_seconds)
    return 1
end

local elapsed_ms = math.max(0, now - lastRefill)
local refill = math.floor(elapsed_ms / (window_seconds * 1000) * limit)
tokens = math.min(limit, tokens + refill)

if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
    redis.call('EXPIRE', key, window_seconds)
    return 1
else
    redis.call('EXPIRE', key, window_seconds)
    return 0
end
`;

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

async function upstashRateLimit(
  identifier: string,
  limit: number,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return memRateLimit(identifier, limit);

  try {
    const now = Date.now();
    const windowSeconds = 60;
    const key = `worksphere:ratelimit:${identifier}`;

    const allowed = await redis.eval(
      TOKEN_BUCKET_LUA,
      [key],
      [now, limit, windowSeconds],
    );

    return Number(allowed) === 1;
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
const WINDOW_MS = 60_000;

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
