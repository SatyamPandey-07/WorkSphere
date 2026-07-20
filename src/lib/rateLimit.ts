/**
 * Rate Limiting — Upstash Redis (distributed) with in-memory fallback
 *
 * Production: Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env
 * Development: Falls back to an in-memory sliding window automatically
 */

const WINDOW_MS = 60_000;

// ZSET sliding window. Member = stringified microsecond stamp so concurrent
// hits in the same ms don't collide / get dropped under load.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local nonce = ARGV[3]

local t = redis.call("TIME")
local sec = t[1]
local usec = t[2]
local nowMs = tonumber(sec) * 1000 + math.floor(tonumber(usec) / 1000)
local member = sec .. string.format("%06d", tonumber(usec)) .. ":" .. nonce

redis.call("ZREMRANGEBYSCORE", key, "-inf", nowMs - windowMs)
local count = redis.call("ZCARD", key)
if count >= limit then
  return 0
end

redis.call("ZADD", key, nowMs, member)
redis.call("PEXPIRE", key, windowMs)
return 1
`;

/** ZSET member id used by the Lua script (exported for tests). */
export function microTimestampMember(
  sec: string | number,
  usec: string | number,
  nonce: string,
): string {
  const u = String(usec).padStart(6, "0");
  return `${sec}${u}:${nonce}`;
}

type RedisScript = {
  eval: (keys: string[], args: string[]) => Promise<unknown>;
};

type RedisClient = {
  createScript: (script: string) => RedisScript;
};

const scriptByLimit = new Map<number, RedisScript>();

function getRedisScript(limitPerMinute: number): RedisScript | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }

  const cached = scriptByLimit.get(limitPerMinute);
  if (cached) return cached;

  try {
    // Dynamic require so jest doesn't pull in @upstash/redis ESM
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis");

    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    }) as RedisClient;

    const script = redis.createScript(SLIDING_WINDOW_LUA);
    scriptByLimit.set(limitPerMinute, script);
    return script;
  } catch {
    return null;
  }
}

async function redisSlidingWindow(
  identifier: string,
  limit: number,
): Promise<boolean | null> {
  const script = getRedisScript(limit);
  if (!script) return null;

  try {
    const key = `worksphere:ratelimit:${limit}:${identifier}`;
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const result = await script.eval(
      [key],
      [String(limit), String(WINDOW_MS), nonce],
    );
    return Number(result) === 1;
  } catch (err) {
    console.error("[rateLimit] redis eval failed, falling back to memory", err);
    return null;
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
  const redisResult = await redisSlidingWindow(identifier, limit);
  if (redisResult !== null) {
    return redisResult;
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
