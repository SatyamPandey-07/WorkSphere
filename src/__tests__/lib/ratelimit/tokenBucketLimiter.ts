export interface TokenBucketConfig {
    /** Maximum token capacity in the bucket */
    capacity: number;
    /** Token refill rate per second */
    refillRatePerSecond: number;
    /** Optional Upstash Redis REST URL (falls back to in-memory when omitted) */
    redisUrl?: string;
    /** Optional Upstash Redis REST Token */
    redisToken?: string;
    /** Namespace prefix for Redis keys */
    prefix?: string;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    limit: number;
    resetAtMs: number;
    /** RFC 7231 Section 7.1.3 compliant delay-seconds integer (>= 1 when rate-limited, 0 when allowed) */
    retryAfterSeconds: number;
    headers: Record<string, string>;
}

interface InMemoryBucketState {
    tokens: number;
    lastRefillMs: number;
}

// Atomic Lua token-bucket script for Upstash Redis
const TOKEN_BUCKET_LUA_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
local tokens = tonumber(bucket[1])
local last_refill_ms = tonumber(bucket[2])

if tokens == nil or last_refill_ms == nil then
  tokens = capacity
  last_refill_ms = now_ms
else
  local elapsed_ms = math.max(0, now_ms - last_refill_ms)
  local refilled = (elapsed_ms / 1000.0) * refill_rate
  tokens = math.min(capacity, tokens + refilled)
  last_refill_ms = now_ms
end

local allowed = 0
local wait_seconds = 0

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  local deficit = cost - tokens
  if refill_rate > 0 then
    wait_seconds = deficit / refill_rate
  else
    wait_seconds = 1
  end
end

local ttl_seconds = math.max(1, math.ceil((capacity / math.max(refill_rate, 0.001)) * 2))
redis.call('HMSET', key, 'tokens', tostring(tokens), 'last_refill_ms', tostring(last_refill_ms))
redis.call('EXPIRE', key, ttl_seconds)

return { allowed, math.floor(tokens), tostring(wait_seconds), ttl_seconds }
`;

/**
 * Clamps computed reset/wait durations to a valid RFC 7231 Retry-After integer (>= 1 second),
 * guarding against negative Redis TTLs (-1, -2) and system clock skew.
 */
export function normalizeRetryAfterSeconds(resetDurationSeconds: number): number {
    if (!Number.isFinite(resetDurationSeconds)) {
        return 1;
    }
    return Math.max(1, Math.ceil(resetDurationSeconds));
}

export class TokenBucketLimiter {
    private readonly capacity: number;
    private readonly refillRatePerSecond: number;
    private readonly redisUrl?: string;
    private readonly redisToken?: string;
    private readonly prefix: string;
    private readonly memoryBuckets = new Map<string, InMemoryBucketState>();

    constructor(config: TokenBucketConfig) {
        if (config.capacity <= 0) {
            throw new Error('TokenBucketLimiter capacity must be greater than 0');
        }
        if (config.refillRatePerSecond <= 0) {
            throw new Error('TokenBucketLimiter refillRatePerSecond must be greater than 0');
        }

        this.capacity = config.capacity;
        this.refillRatePerSecond = config.refillRatePerSecond;
        this.redisUrl = config.redisUrl ?? process.env.UPSTASH_REDIS_REST_URL;
        this.redisToken = config.redisToken ?? process.env.UPSTASH_REDIS_REST_TOKEN;
        this.prefix = config.prefix ?? 'worksphere:rl:tb';
    }

    /**
     * Consumes `cost` tokens for `identifier` using Redis when configured,
     * gracefully falling back to local in-memory evaluation on missing credentials or Redis errors.
     */
    public async consume(
        identifier: string,
        cost = 1,
        nowMs: number = Date.now()
    ): Promise<RateLimitResult> {
        const normalizedCost = Math.max(1, cost);
        const key = `${this.prefix}:${identifier}`;

        if (this.redisUrl && this.redisToken) {
            try {
                return await this.consumeFromRedis(key, normalizedCost, nowMs);
            } catch {
                // Fall back to in-memory bucket on Redis network/timeout errors
            }
        }

        return this.consumeInMemory(key, normalizedCost, nowMs);
    }

    private async consumeFromRedis(
        key: string,
        cost: number,
        nowMs: number
    ): Promise<RateLimitResult> {
        const endpoint = `${this.redisUrl!.replace(/\/$/, '')}/eval`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.redisToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify([
                TOKEN_BUCKET_LUA_SCRIPT,
                1,
                key,
                this.capacity,
                this.refillRatePerSecond,
                nowMs,
                cost,
            ]),
        });

        if (!response.ok) {
            throw new Error(`Upstash Redis eval failed with status ${response.status}`);
        }

        const payload = (await response.json()) as {
            result?: [number, number, string | number, number];
        };

        if (!Array.isArray(payload.result) || payload.result.length < 3) {
            throw new Error('Malformed Upstash Redis Lua script response');
        }

        const allowed = Number(payload.result[0]) === 1;
        const remaining = Math.max(0, Number(payload.result[1]) || 0);
        const rawWaitSeconds = Number(payload.result[2]);
        const rawTtlSeconds = Number(payload.result[3]);

        // Guard against negative Redis TTLs (-1 for missing expiry, -2 for missing key) or clock skew
        const effectiveWaitSeconds =
            Number.isFinite(rawWaitSeconds) && rawWaitSeconds > 0
                ? rawWaitSeconds
                : rawTtlSeconds;

        const retryAfterSeconds = allowed
            ? 0
            : normalizeRetryAfterSeconds(effectiveWaitSeconds);

        const resetDurationSeconds = allowed
            ? Math.max(0, Math.ceil((this.capacity - remaining) / this.refillRatePerSecond))
            : retryAfterSeconds;

        const resetAtMs = nowMs + resetDurationSeconds * 1000;

        return this.buildResult({
            allowed,
            remaining,
            resetAtMs,
            retryAfterSeconds,
        });
    }

    /**
     * Evaluates token consumption in memory with clock-skew protection and RFC 7231 Retry-After clamping.
     */
    public consumeInMemory(
        key: string,
        cost = 1,
        nowMs: number = Date.now()
    ): RateLimitResult {
        const existing = this.memoryBuckets.get(key);

        let tokens = this.capacity;
        let lastRefillMs = nowMs;

        if (existing) {
            // Clamp elapsed time to >= 0 so backward clock drift never subtracts tokens or yields negative wait
            const elapsedMs = Math.max(0, nowMs - existing.lastRefillMs);
            const refilledTokens = (elapsedMs / 1000) * this.refillRatePerSecond;
            tokens = Math.min(this.capacity, existing.tokens + refilledTokens);
            lastRefillMs = Math.max(nowMs, existing.lastRefillMs);
        }

        if (tokens >= cost) {
            tokens -= cost;
            this.memoryBuckets.set(key, { tokens, lastRefillMs });

            const fullRefillSeconds = Math.ceil(
                (this.capacity - tokens) / this.refillRatePerSecond
            );

            return this.buildResult({
                allowed: true,
                remaining: Math.floor(tokens),
                resetAtMs: nowMs + Math.max(0, fullRefillSeconds) * 1000,
                retryAfterSeconds: 0,
            });
        }

        // Persist clamped bucket state without modifying token count
        this.memoryBuckets.set(key, { tokens, lastRefillMs });

        const deficit = cost - tokens;
        const rawResetSeconds = deficit / this.refillRatePerSecond;
        const retryAfterSeconds = normalizeRetryAfterSeconds(rawResetSeconds);
        const resetAtMs = nowMs + retryAfterSeconds * 1000;

        return this.buildResult({
            allowed: false,
            remaining: 0,
            resetAtMs,
            retryAfterSeconds,
        });
    }

    /**
     * Helper for computing a compliant Retry-After header from any target reset timestamp (ms),
     * safely clamping negative values caused by clock drift (nowMs > resetAtMs) to 1.
     */
    public static computeRetryAfterFromResetTimestamp(
        resetAtMs: number,
        nowMs: number = Date.now()
    ): number {
        const resetDurationSeconds = (resetAtMs - nowMs) / 1000;
        return normalizeRetryAfterSeconds(resetDurationSeconds);
    }

    private buildResult(params: {
        allowed: boolean;
        remaining: number;
        resetAtMs: number;
        retryAfterSeconds: number;
    }): RateLimitResult {
        const headers: Record<string, string> = {
            'X-RateLimit-Limit': String(this.capacity),
            'X-RateLimit-Remaining': String(params.remaining),
            'X-RateLimit-Reset': String(Math.ceil(params.resetAtMs / 1000)),
        };

        if (!params.allowed) {
            headers['Retry-After'] = String(
                normalizeRetryAfterSeconds(params.retryAfterSeconds)
            );
        }

        return {
            allowed: params.allowed,
            remaining: params.remaining,
            limit: this.capacity,
            resetAtMs: params.resetAtMs,
            retryAfterSeconds: params.retryAfterSeconds,
            headers,
        };
    }
}