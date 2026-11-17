/**
 * Rate limiting utilities imported via `@/lib/rateLimit`.
 *
 * This file is what `@/lib/rateLimit` resolves to (a file takes precedence over
 * the `./rateLimit/` directory). It provides:
 *
 * - **Legacy sliding window** — {@link rateLimit}, {@link getRateLimitInfo}:
 *   boolean allow/deny per identifier.
 * - **Tiered sliding window** — {@link checkTieredRateLimit} and helpers:
 *   anonymous (by IP) vs authenticated (by Clerk user ID) quotas from
 *   {@link TIER_CONFIGS}, plus HTTP header/429 helpers.
 * - **Token bucket** — re-exported from `./tokenBucketRateLimit`
 *   (`checkTokenBucketRateLimit`, `RATE_TIERS`, ...).
 *
 * **Storage.** When both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
 * are set, limits are enforced in Upstash Redis and shared across instances.
 * Otherwise — or if a Redis call throws — an in-process memory store is used.
 * The memory store is per server instance (not shared between serverless
 * invocations or replicas), holds at most 10,000 keys with LRU eviction, and
 * drops expired keys every 60 s.
 */

import type { RateLimitResult } from "./rateLimit/types";

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
 * Atomic sliding-window-log Lua script used by {@link rateLimit} on Redis.
 *
 * Runs as a single script on the Redis server, so prune, count and write
 * cannot interleave between concurrent requests:
 * 1. `ZREMRANGEBYSCORE` — drop entries older than `now - windowMs`
 * 2. `ZCARD` — count entries left in the window
 * 3. `ZADD` — record `cost` entries if `count + cost <= limit`
 * 4. `PEXPIRE` — expire the key after `windowMs`
 *
 * - `KEYS[1]` — sorted-set key
 * - `ARGV[1]` limit (min 1) · `ARGV[2]` windowMs (min 1, default 60000) ·
 *   `ARGV[3]` now in epoch ms (`<= 0` uses Redis `TIME`) ·
 *   `ARGV[4]` unique member prefix (see {@link microTimestampMember}) ·
 *   `ARGV[5]` cost (default 1; `0` only inspects without recording)
 *
 * Returns `[allowed (1|0), remaining, resetEpochSeconds, retryAfterSeconds, count]`.
 */
export const SLIDING_WINDOW_LOG_LUA_SCRIPT = `local key = KEYS[1]
local limit = math.max(1, math.floor(tonumber(ARGV[1]) or 1))
local window_ms = math.max(1, math.floor(tonumber(ARGV[2]) or 60000))
local now = tonumber(ARGV[3]) or 0
local member = ARGV[4]
local cost = math.max(0, math.floor(tonumber(ARGV[5]) or 1))

if now <= 0 then
  now = tonumber(redis.call("TIME")[1]) * 1000
end

local window_start = now - window_ms
redis.call("ZREMRANGEBYSCORE", key, "-inf", window_start)
local count = tonumber(redis.call("ZCARD", key))

local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local reset_time = now + window_ms
if oldest and #oldest >= 2 then
  reset_time = tonumber(oldest[2]) + window_ms
end

if cost == 0 then
  local remaining = math.max(0, limit - count)
  local retry_after = 0
  if count >= limit then
    retry_after = math.max(1, math.ceil((reset_time - now) / 1000))
  end
  return { count < limit and 1 or 0, remaining, math.ceil(reset_time / 1000), retry_after, count }
end

if count + cost <= limit then
  for i = 1, cost do
    redis.call("ZADD", key, now, member .. ":" .. i)
  end
  redis.call("PEXPIRE", key, window_ms)
  return { 1, math.max(0, limit - count - cost), math.ceil(reset_time / 1000), 0, count + cost }
end

local retry_after = math.max(1, math.ceil((reset_time - now) / 1000))
return { 0, 0, math.ceil(reset_time / 1000), retry_after, count }
`;

/**
 * Redis sliding-window check for {@link rateLimit}. Runs
 * {@link SLIDING_WINDOW_LOG_LUA_SCRIPT} with a cost of 1 against
 * `worksphere:ratelimit:<identifier>`, so prune + count + write are atomic and
 * concurrent bursts cannot all pass on a stale count (issue #1034).
 * Falls back to the in-memory limiter if no client can be created or the call throws.
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
    const key = `worksphere:ratelimit:${identifier}`;
    const member = microTimestampMember(
      Math.floor(now / 1000),
      (now % 1000) * 1000,
      `${Math.random().toString(36).slice(2, 10)}`,
    );

    const result = await redis.eval(
      SLIDING_WINDOW_LOG_LUA_SCRIPT,
      [key],
      [limit, windowMs, now, member, 1],
    );

    // Lua script result order: [allowed, remaining, reset, retry_after, count]
    const allowed = Number(result?.[0]) === 1;
    if (!allowed) {
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
  if (!identifier || typeof identifier !== "string") return true;
  const safeLimit =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? limit
      : 10;
  const safeWindowMs =
    typeof windowMs === "number" && Number.isFinite(windowMs) && windowMs > 0
      ? windowMs
      : DEFAULT_WINDOW_MS;

  const now = Date.now();
  const start = now - safeWindowMs;

  let entry = memStore.get(identifier);
  if (!entry) {
    if (memStore.size >= MAX_MEM_ENTRIES) {
      cleanupExpiredEntries();
      while (memStore.size >= MAX_MEM_ENTRIES) {
        const oldestKey = memStore.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        memStore.delete(oldestKey);
      }
    }
    entry = { timestamps: [], resetTime: now + safeWindowMs };
    memStore.set(identifier, entry);
  } else {
    // Refresh LRU order
    memStore.delete(identifier);
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

  if (entry.timestamps.length >= safeLimit) {
    return false;
  }

  entry.timestamps.push(now);
  entry.resetTime = now + safeWindowMs;
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
 * Sliding-window rate limit check that records the request when allowed.
 *
 * Uses Upstash Redis when `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` are set, and the per-instance memory store
 * otherwise. Redis errors fall back to the memory store; this function does
 * not throw for rate-limit reasons.
 *
 * In memory mode an empty or non-string `identifier` is always allowed, and an
 * invalid `limit` / `windowMs` (not a positive finite number) falls back to
 * 10 / 60000. On Redis the script clamps both to at least 1.
 *
 * @param identifier - Who is being limited, e.g. a user ID or client IP.
 *   Combine with a route prefix (`"reviews:" + ip`) to keep limits separate.
 * @param limit - Maximum requests allowed per window. Defaults to `10`.
 * @param windowMs - Window length in milliseconds. Defaults to `60000` (1 minute).
 * @returns `true` if the request is allowed (and counted), `false` if limited.
 *
 * @example
 * ```ts
 * const ip = getClientIp(req);
 * if (!(await rateLimit(`reviews:${ip}`, 5, 60_000))) {
 *   return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 * }
 * ```
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

/**
 * Reads the current {@link rateLimit} state for an identifier without
 * recording a request.
 *
 * Only the in-memory store can be inspected: when Upstash Redis is configured
 * (both env vars set) this returns `null`. Pass the same `limit` and
 * `windowMs` that are used with {@link rateLimit}.
 *
 * @param identifier - Same identifier passed to {@link rateLimit}.
 * @param limit - Maximum requests per window. Defaults to `10`.
 * @param windowMs - Window length in milliseconds. Defaults to `60000`.
 * @returns `null` when Redis is configured; otherwise
 *   `count` (requests in the window), `remaining`, `resetTime` (epoch ms when
 *   the oldest request leaves the window, or now + `windowMs` if empty) and
 *   `isLimited` (`count >= limit`).
 */
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
  return memGetInfo(identifier, limit, windowMs);
}

/**
 * Clears in-memory rate limit state. Intended for tests and local development.
 *
 * Does not touch Redis.
 *
 * @param identifier - Exact memory-store key to clear. For {@link rateLimit}
 *   this is the identifier itself; tiered entries are stored as
 *   `worksphere:ratelimit:<namespace>:<tier>:<identity>`, so a bare identity
 *   does not clear them. Omit to clear every in-memory entry and the cached
 *   Upstash tier limiters.
 */
export function resetRateLimit(identifier?: string): void {
  if (identifier) {
    memStore.delete(identifier);
  } else {
    memStore.clear();
    upstashLimiters.clear();
  }
}

/**
 * Drops the cached Redis client and cached Upstash tier limiters so the next
 * call re-reads the `UPSTASH_REDIS_REST_*` env vars. Intended for tests that
 * change those variables. Does not clear in-memory counters or Redis data.
 */
export function resetRedisScripts(): void {
  redisClient = null;
  upstashLimiters.clear();
}

/**
 * Builds a unique sorted-set member for {@link SLIDING_WINDOW_LOG_LUA_SCRIPT}:
 * seconds, microseconds zero-padded to 6 digits, then `:nonce`. The nonce keeps
 * members unique when several requests share the same microsecond.
 *
 * @param sec - Whole seconds since the epoch.
 * @param usec - Microseconds within the second (0–999999).
 * @param nonce - Random suffix.
 * @returns The member string.
 *
 * @example
 * ```ts
 * microTimestampMember(1700000000, 42, "ab12"); // "1700000000000042:ab12"
 * ```
 */
export function microTimestampMember(
  sec: number | string,
  usec: number,
  nonce: string,
): string {
  const padUsec = String(usec).padStart(6, "0");
  return `${sec}${padUsec}:${nonce}`;
}

// ─── Token Bucket Rate Limiting Exports (#3529) ──────────────────────────────
export {
  MemoryRateLimitStore,
  defaultMemoryStore,
  type MemEntry,
  type MemoryBucketEntry,
} from "./rateLimit/stores/memoryStore";

export {
  SlidingWindowLimiter,
  type SlidingWindowOptions,
} from "./rateLimit/limiters/slidingWindowLimiter";

export {
  TokenBucketLimiter,
  type TokenBucketOptions,
} from "./rateLimit/limiters/tokenBucketLimiter";

export {
  checkTokenBucketRateLimit,
  checkInMemoryTokenBucket,
  matchRateTier,
  resetTokenBuckets,
  RATE_TIERS,
  type RateTier,
  type RateTierType,
  type RateLimitResult,
} from "./tokenBucketRateLimit";

// ─── Tier-Based Sliding Window Rate Limiter (#3475) ──────────────────────────

/** Quota tier for {@link checkTieredRateLimit}: by client IP or by Clerk user ID. */
export type RateLimitTier = "anonymous" | "authenticated";

/** Quota for one {@link RateLimitTier}. */
export interface TierConfig {
  /** Maximum requests per window. */
  readonly limit: number;
  /** Window length in milliseconds (used by the in-memory limiter). */
  readonly windowMs: number;
  /** Same window as an Upstash duration string, e.g. `"15 m"` (used on Redis). Keep in sync with `windowMs`. */
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

/** Outcome of a tiered rate limit check. */
export interface TieredRateLimitResult {
  /** Whether the request is allowed (and was counted). */
  allowed: boolean;
  /** Maximum requests per window for this tier. */
  limit: number;
  /** Requests left in the current window (never negative). */
  remaining: number;
  /** Seconds to wait before retrying: `0` when allowed, at least `1` when blocked. */
  retryAfter: number;
  /** When the window frees up, in **epoch milliseconds**. */
  reset: number;
  /** Tier the request was counted against. */
  tier: RateLimitTier;
  /** Value the limit is keyed on: the trimmed user ID or the client IP. */
  identity: string;
}

/** Options for {@link checkTieredRateLimit}. */
export interface CheckTieredRateLimitOptions {
  /**
   * Explicit user ID (e.g. tests or already-authenticated handlers). When the
   * `userId` key is present — even as `undefined` or `null` — Clerk's `auth()`
   * is not called and an empty value means the anonymous tier. When the key is
   * absent, `auth()` from `@clerk/nextjs/server` is called.
   */
  userId?: string | null;
  /** Client IP override for the anonymous tier (e.g. tests). Defaults to {@link getClientIp}. */
  ip?: string;
  /** Separates quotas per feature/route; part of the storage key. Defaults to `"ai-public"`. */
  namespace?: string;
}

// Cached Upstash Ratelimit instances keyed by `${namespace}:${tier}`
const upstashLimiters = new Map<string, any>();

function getUpstashLimiter(
  redis: any,
  namespace: string,
  tier: RateLimitTier,
): any {
  const cacheKey = `${namespace}:${tier}`;
  let limiter = upstashLimiters.get(cacheKey);
  if (!limiter) {
    const config = TIER_CONFIGS[tier];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Ratelimit } = require("@upstash/ratelimit");
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
 * Extracts the client IP used as the anonymous rate-limit identity.
 *
 * Checked in order, first non-empty (trimmed) value wins:
 * 1. an `ip` string property on the request object (set by some platforms)
 * 2. `x-real-ip`
 * 3. `cf-connecting-ip`
 * 4. the first entry of `x-forwarded-for`
 * 5. `"127.0.0.1"` (also returned for `null`/`undefined` input)
 *
 * Header values are trusted as received. Checking proxy-set headers before
 * `x-forwarded-for` only prevents spoofing if the deployment's proxy
 * overwrites or strips client-supplied copies of these headers.
 *
 * @param reqOrHeaders - A `Request`/`NextRequest`, a `Headers` object, or nothing.
 * @returns The client IP string, or `"127.0.0.1"` if none is found.
 *
 * @example
 * ```ts
 * getClientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })); // "203.0.113.7"
 * ```
 */
export function getClientIp(
  reqOrHeaders: Request | Headers | null | undefined,
): string {
  if (!reqOrHeaders) {
    return "127.0.0.1";
  }

  if (
    typeof reqOrHeaders === "object" &&
    "ip" in reqOrHeaders &&
    typeof (reqOrHeaders as any).ip === "string" &&
    (reqOrHeaders as any).ip.trim()
  ) {
    return (reqOrHeaders as any).ip.trim();
  }

  const headers =
    reqOrHeaders instanceof Headers
      ? reqOrHeaders
      : reqOrHeaders &&
          typeof reqOrHeaders === "object" &&
          "headers" in reqOrHeaders &&
          reqOrHeaders.headers &&
          typeof reqOrHeaders.headers.get === "function"
        ? reqOrHeaders.headers
        : null;

  if (!headers) {
    return "127.0.0.1";
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }

  const cfConnectingIp = headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    const trimmed = cfConnectingIp.trim();
    if (trimmed) return trimmed;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  return "127.0.0.1";
}

/**
 * In-memory tiered sliding-window check that records the request when allowed.
 *
 * Used by {@link checkTieredRateLimit} when Redis is not configured or a Redis
 * call fails. State is per server instance and stored under
 * `worksphere:ratelimit:<namespace>:<tier>:<identity>`. An invalid `config`
 * (missing, or non-positive `limit`/`windowMs`) falls back to 10 requests per
 * 900000 ms.
 *
 * @param namespace - Quota namespace, e.g. `"ai-public"`.
 * @param tier - Tier being checked.
 * @param identity - User ID or client IP.
 * @param config - Quota to apply. Defaults to `TIER_CONFIGS[tier]`.
 * @returns The check result; `reset` is in epoch milliseconds.
 */
export function memTieredRateLimit(
  namespace: string,
  tier: RateLimitTier,
  identity: string,
  config: TierConfig = TIER_CONFIGS[tier] || TIER_CONFIGS.anonymous,
): TieredRateLimitResult {
  const safeConfig = config || TIER_CONFIGS[tier] || TIER_CONFIGS.anonymous;
  const now = Date.now();
  const windowMs =
    typeof safeConfig.windowMs === "number" &&
    Number.isFinite(safeConfig.windowMs) &&
    safeConfig.windowMs > 0
      ? safeConfig.windowMs
      : 900_000;
  const limit =
    typeof safeConfig.limit === "number" &&
    Number.isFinite(safeConfig.limit) &&
    safeConfig.limit > 0
      ? safeConfig.limit
      : 10;
  const key = `worksphere:ratelimit:${namespace}:${tier}:${identity}`;

  let entry = memStore.get(key);
  if (!entry) {
    if (memStore.size >= MAX_MEM_ENTRIES) {
      cleanupExpiredEntries();
      while (memStore.size >= MAX_MEM_ENTRIES) {
        const oldestKey = memStore.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        memStore.delete(oldestKey);
      }
    }
    entry = { timestamps: [], resetTime: now + windowMs };
    memStore.set(key, entry);
  } else {
    // Refresh LRU order
    memStore.delete(key);
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
 * Reads in-memory tiered rate limit state without recording a request.
 *
 * Only reflects the memory store; when {@link checkTieredRateLimit} is using
 * Redis this reports an empty window.
 *
 * @param namespace - Quota namespace used with {@link checkTieredRateLimit}.
 * @param tier - Tier to inspect.
 * @param identity - User ID or client IP.
 * @param config - Quota to evaluate against. Defaults to `TIER_CONFIGS[tier]`.
 * @returns `count` in the window, `remaining`, `resetTime` (epoch ms) and
 *   `isLimited` (`count >= limit`).
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
 * Tiered sliding-window rate limit check that records the request when allowed.
 *
 * 1. **Tier:** `authenticated` (keyed by trimmed user ID) when a non-empty user
 *    ID is found, otherwise `anonymous` (keyed by `options.ip` or
 *    {@link getClientIp}). See {@link CheckTieredRateLimitOptions.userId} for
 *    when Clerk's `auth()` is called; if it throws, the request is anonymous.
 * 2. **Quota:** from {@link TIER_CONFIGS}.
 * 3. **Storage:** Upstash `Ratelimit.slidingWindow` (cached per
 *    namespace + tier, prefix `worksphere:ratelimit:<namespace>:<tier>`) when
 *    both Upstash env vars are set; if that call throws, the error is logged
 *    and {@link memTieredRateLimit} is used. Without Redis, memory is used.
 *
 * Never throws for rate-limit or storage errors.
 *
 * @param req - Incoming request or its headers; used only to read the client IP.
 * @param options - Identity and namespace overrides.
 * @returns The check result; `reset` is in epoch milliseconds.
 *
 * @example
 * ```ts
 * export async function POST(req: Request) {
 *   const result = await checkTieredRateLimit(req, { namespace: "ai-chat" });
 *   if (!result.allowed) return createRateLimitResponse(result);
 *   return applyRateLimitHeaders(NextResponse.json({ ok: true }), result);
 * }
 * ```
 */
export async function checkTieredRateLimit(
  req: Request | Headers | null | undefined,
  options?: CheckTieredRateLimitOptions,
): Promise<TieredRateLimitResult> {
  const namespace = options?.namespace ?? "ai-public";
  const safeReq = req || new Headers();

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
    identity = options?.ip ?? getClientIp(safeReq);
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
 * Builds rate-limit response headers from a check result.
 *
 * Always includes `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`,
 * `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Adds `Retry-After` when the
 * request was blocked (`allowed === false`, or `success === false` for results
 * without `allowed`), and `X-RateLimit-Reset` when `result.reset` is set.
 *
 * Value rules:
 * - `RateLimit-Reset` and `Retry-After` are `retryAfter` in seconds, minimum 1
 *   (so an allowed request reports `"1"`).
 * - `X-RateLimit-Reset` is `result.reset` unchanged: epoch **ms** for
 *   {@link TieredRateLimitResult}, epoch **seconds** for token-bucket results.
 * - A non-finite `limit` becomes `10` and a non-finite `remaining` becomes `0`.
 * - A missing or non-object `result` returns fixed defaults (limit 10,
 *   remaining 10, reset 60).
 *
 * @param result - A tiered or token-bucket rate limit result.
 * @returns Header names mapped to string values.
 */
export function getRateLimitHeaders(
  result: TieredRateLimitResult | RateLimitResult | any,
): Record<string, string> {
  if (!result || typeof result !== "object") {
    return {
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "10",
      "RateLimit-Reset": "60",
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "10",
    };
  }
  const limit =
    typeof result.limit === "number" && Number.isFinite(result.limit)
      ? result.limit
      : 10;
  const remaining =
    typeof result.remaining === "number" && Number.isFinite(result.remaining)
      ? Math.max(0, result.remaining)
      : 0;
  const retryAfter =
    typeof result.retryAfter === "number" && Number.isFinite(result.retryAfter)
      ? Math.max(1, result.retryAfter)
      : 1;

  const isBlocked = "allowed" in result ? !result.allowed : !result.success;

  const headers: Record<string, string> = {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(remaining),
    "RateLimit-Reset": String(retryAfter),
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
  };
  if (isBlocked) {
    headers["Retry-After"] = String(retryAfter);
  }
  if (result.reset) {
    headers["X-RateLimit-Reset"] = String(result.reset);
  }
  return headers;
}

/**
 * Creates an HTTP 429 `NextResponse` for a blocked request.
 *
 * Body: `{ error, retryAfter, limit, remaining, reset }`. Headers come from
 * {@link getRateLimitHeaders}. Missing or invalid fields fall back to
 * `retryAfter` 1, `limit` 10, `remaining` 0, and `reset` = 60 s from now in
 * epoch **seconds** (a provided `reset` is passed through unchanged).
 *
 * @param result - The blocked check result.
 * @returns A `NextResponse` with status 429.
 */
export function createRateLimitResponse(
  result: TieredRateLimitResult | RateLimitResult | any,
): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NextResponse } = require("next/server");
  const retryAfter =
    typeof result?.retryAfter === "number" && Number.isFinite(result.retryAfter)
      ? Math.max(1, result.retryAfter)
      : 1;
  const limit =
    typeof result?.limit === "number" && Number.isFinite(result.limit)
      ? result.limit
      : 10;
  const remaining =
    typeof result?.remaining === "number" && Number.isFinite(result.remaining)
      ? Math.max(0, result.remaining)
      : 0;
  const reset =
    typeof result?.reset === "number" && Number.isFinite(result.reset)
      ? result.reset
      : Math.ceil(Date.now() / 1000) + 60;

  return NextResponse.json(
    {
      error: "Too many requests. Please try again later.",
      retryAfter,
      limit,
      remaining,
      reset,
    },
    {
      status: 429,
      headers: getRateLimitHeaders(result),
    },
  );
}

/**
 * Sets the headers from {@link getRateLimitHeaders} on a response, typically
 * a successful one, so clients can see their remaining quota.
 *
 * Mutates and returns the same response. Returns it unchanged if it has no
 * settable `headers`.
 *
 * @param response - A `Response` or `NextResponse`.
 * @param result - The check result for this request.
 * @returns The same `response` instance.
 */
export function applyRateLimitHeaders<T extends Response>(
  response: T,
  result: TieredRateLimitResult,
): T {
  if (
    !response ||
    !response.headers ||
    typeof response.headers.set !== "function"
  ) {
    return response;
  }
  const headers = getRateLimitHeaders(result);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Clears tiered rate limit state for tests: same as {@link resetRateLimit},
 * and also drops the cached Upstash tier limiters. Does not touch Redis.
 *
 * @param identifier - Exact memory-store key
 *   (`worksphere:ratelimit:<namespace>:<tier>:<identity>`); omit to clear all.
 */
export function resetTieredRateLimit(identifier?: string): void {
  resetRateLimit(identifier);
  upstashLimiters.clear();
}
