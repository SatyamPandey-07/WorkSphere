import { SLIDING_WINDOW_LOG_LUA_SCRIPT } from "../lua/slidingWindowScript";

let redisClientInstance: any = null;
const upstashLimiters = new Map<string, any>();

export function getRedisClient() {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  if (redisClientInstance) return redisClientInstance;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis");
    redisClientInstance = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return redisClientInstance;
  } catch {
    return null;
  }
}

export function getCachedLimiter(key: string): any {
  return upstashLimiters.get(key);
}

export function setCachedLimiter(key: string, limiter: any) {
  upstashLimiters.set(key, limiter);
}

export function resetRedisScripts(): void {
  redisClientInstance = null;
  upstashLimiters.clear();
}

export function clearCachedLimiters(): void {
  upstashLimiters.clear();
}

export function microTimestampMember(
  sec: number | string,
  usec: number,
  nonce: string,
): string {
  const safeUsec = Math.max(0, usec || 0);
  const padUsec = String(safeUsec).padStart(6, "0");
  return `${sec}${padUsec}:${nonce}`;
}

/**
 * Lua script for atomic distributed Token Bucket rate limiting.
 * Calculates token refill based on elapsed milliseconds and deducts requested cost in a single Redis transaction.
 *
 * KEYS[1]: Redis Key for the rate limit bucket (hash)
 * ARGV[1]: Max bucket capacity / limit (number)
 * ARGV[2]: Window duration in milliseconds (number)
 * ARGV[3]: Requested token cost / points (number)
 * ARGV[4]: Current timestamp in milliseconds (number)
 *
 * Returns: Array [ allowed (0|1), remaining (number), reset_sec (number), retry_after_sec (number), current_tokens (string) ]
 */
export const ATOMIC_TOKEN_BUCKET_LUA_SCRIPT = `
local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local data = redis.call("HMGET", key, "tokens", "lastRefill")
local current_tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if current_tokens == nil or last_refill == nil then
    current_tokens = max_tokens
    last_refill = now
else
    if now < last_refill then
        last_refill = now
    end
    local elapsed = math.max(0, now - last_refill)
    if elapsed > 0 then
        local refill = (elapsed / window_ms) * max_tokens
        current_tokens = math.min(max_tokens, math.max(0, current_tokens) + refill)
        last_refill = now
    end
end

local allowed = 0
local remaining = 0
local retry_after = 0
local reset_sec = math.ceil((now + window_ms) / 1000)

if current_tokens >= cost then
    allowed = 1
    current_tokens = math.max(0, current_tokens - cost)
    remaining = math.floor(current_tokens)
    retry_after = 0
    reset_sec = math.ceil((now + window_ms) / 1000)
    redis.call("HMSET", key, "tokens", tostring(current_tokens), "lastRefill", tostring(last_refill))
    redis.call("EXPIRE", key, math.max(1, math.ceil(window_ms / 1000) * 2))
else
    allowed = 0
    remaining = math.max(0, math.floor(current_tokens))
    local needed = math.max(1, cost - current_tokens)
    local time_to_next_ms = math.ceil((needed / max_tokens) * window_ms)
    retry_after = math.max(1, math.ceil(time_to_next_ms / 1000))
    reset_sec = math.ceil((now + time_to_next_ms) / 1000)
    local expire_ttl = math.max(1, math.ceil(window_ms / 1000) * 2, math.ceil(time_to_next_ms / 1000) * 2)
    redis.call("HMSET", key, "tokens", tostring(current_tokens), "lastRefill", tostring(last_refill))
    redis.call("EXPIRE", key, expire_ttl)
end

return { allowed, remaining, reset_sec, retry_after, tostring(current_tokens) }
`;

export const ATOMIC_SLIDING_WINDOW_LUA_SCRIPT = SLIDING_WINDOW_LOG_LUA_SCRIPT;

/**
 * Executes atomic distributed Token Bucket Lua script on Redis client.
 */
export async function executeAtomicTokenBucket(
  redis: any,
  key: string,
  limit: number,
  windowMs: number,
  cost = 1,
  now = Date.now(),
) {
  if (!redis || typeof redis.eval !== "function") return null;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10;
  const safeWindowMs =
    Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000;
  const safeCost = Number.isFinite(cost) && cost >= 0 ? Math.floor(cost) : 1;
  const safeNow = Number.isFinite(now) && now > 0 ? now : Date.now();

  try {
    const rawResult = await redis.eval(
      ATOMIC_TOKEN_BUCKET_LUA_SCRIPT,
      [key],
      [safeLimit, safeWindowMs, safeCost, safeNow],
    );

    const [allowedNum, remainingNum, resetSecNum, retryAfterNum] =
      Array.isArray(rawResult)
        ? rawResult
        : [
            0,
            0,
            Math.ceil((now + windowMs) / 1000),
            Math.max(1, Math.ceil(windowMs / 1000)),
          ];

    return {
      success: Number(allowedNum) === 1,
      limit: safeLimit,
      remaining: Math.max(0, Number(remainingNum)),
      reset: Number(resetSecNum),
      retryAfter: Number(retryAfterNum),
      identity: key,
    };
  } catch (err: any) {
    if (
      err instanceof Error &&
      /timeout|etimedout|timed out|abort/i.test(err.message)
    ) {
      console.warn(
        "[RedisStore] Redis connection timed out, failing open:",
        err.message,
      );
      return {
        success: true,
        limit: safeLimit,
        remaining: safeLimit,
        reset: Math.ceil((safeNow + safeWindowMs) / 1000),
        retryAfter: 0,
        identity: key,
      };
    }
    console.error(
      "[RedisStore] Atomic token bucket Lua evaluation failed:",
      err,
    );
    return null;
  }
}

/**
 * Executes atomic distributed Sliding Window Lua script on Redis client.
 */
export async function executeAtomicSlidingWindow(
  redis: any,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
  member = microTimestampMember(
    Math.floor(now / 1000),
    (now % 1000) * 1000,
    Math.random().toString(36).slice(2, 10),
  ),
) {
  if (!redis || typeof redis.eval !== "function") return null;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10;
  const safeWindowMs =
    Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000;
  const safeNow = Number.isFinite(now) && now > 0 ? now : Date.now();

  try {
    const rawResult = await redis.eval(
      ATOMIC_SLIDING_WINDOW_LUA_SCRIPT,
      [key],
      [safeLimit, safeWindowMs, safeNow, member],
    );

    const [allowedNum, remainingNum, resetSecNum, retryAfterNum] =
      Array.isArray(rawResult)
        ? rawResult
        : [1, limit - 1, Math.ceil((now + windowMs) / 1000), 0];

    return {
      success: Number(allowedNum) === 1,
      limit: safeLimit,
      remaining: Math.max(0, Number(remainingNum)),
      reset: Number(resetSecNum),
      retryAfter: Number(retryAfterNum),
      identity: key,
    };
  } catch (err) {
    console.error(
      "[RedisStore] Atomic sliding window Lua evaluation failed:",
      err,
    );
    return null;
  }
}
