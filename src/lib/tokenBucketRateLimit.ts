/**
 * Multi-Tier Token Bucket Rate Limiting
 *
 * Implements distributed token bucket rate limiting across public API routes:
 * - Public search: 60 req/min
 * - Authentication endpoints: 5 req/min
 * - Telemetry ingestion: 120 req/min
 *
 * Backed by distributed Upstash Redis / @upstash/ratelimit across multi-container
 * and serverless Vercel edge/lambda deployments, with an in-memory token bucket fallback.
 */

export type RateTierType = "search" | "auth" | "telemetry";

export interface RateTier {
  name: RateTierType;
  limit: number;
  windowMs: number;
  interval: "1 m";
}

export const RATE_TIERS: Record<RateTierType, RateTier> = {
  search: {
    name: "search",
    limit: 60,
    windowMs: 60_000,
    interval: "1 m",
  },
  auth: {
    name: "auth",
    limit: 5,
    windowMs: 60_000,
    interval: "1 m",
  },
  telemetry: {
    name: "telemetry",
    limit: 120,
    windowMs: 60_000,
    interval: "1 m",
  },
};

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
  retryAfter: number; // Seconds to wait
}

interface MemoryBucketEntry {
  tokens: number;
  lastRefill: number;
}

const memoryBuckets = new Map<string, MemoryBucketEntry>();
const upstashLimiters = new Map<string, any>();

/**
 * Maps an incoming API pathname to its corresponding rate tier.
 * Returns null if the route is not subject to public tier rate limiting.
 */
export function matchRateTier(pathname: string): RateTier | null {
  // Never rate-limit webhooks, cron jobs, or health checks
  if (
    pathname === "/api/webhook" ||
    pathname.startsWith("/api/cron") ||
    pathname === "/api/webhooks/worker"
  ) {
    return null;
  }

  // Telemetry ingestion: 120 req/min
  if (
    pathname.startsWith("/api/telemetry") ||
    pathname.includes("/telemetry") ||
    pathname.includes("/noise-metrics") ||
    pathname.includes("/wifi-prediction") ||
    pathname.includes("/wifiTelemetry")
  ) {
    return RATE_TIERS.telemetry;
  }

  // Authentication endpoints: 5 req/min
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/partykit/auth") ||
    pathname === "/api/user/verify-student"
  ) {
    return RATE_TIERS.auth;
  }

  // Public search: 60 req/min
  if (
    pathname.startsWith("/api/venues") ||
    pathname.startsWith("/api/map") ||
    pathname.startsWith("/api/search") ||
    pathname.startsWith("/api/location")
  ) {
    return RATE_TIERS.search;
  }

  return null;
}

/**
 * Extracts client IP from standard proxy headers.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}

/**
 * Evaluates rate limit using distributed Upstash Redis via @upstash/ratelimit.
 * Returns null if Redis is not configured or throws an error.
 */
async function checkDistributedTokenBucket(
  tier: RateTier,
  identifier: string,
): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    let limiter = upstashLimiters.get(tier.name);
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
        limiter: RatelimitClass.tokenBucket(tier.limit, tier.interval, tier.limit),
        prefix: `worksphere:ratelimit:${tier.name}`,
      });
      upstashLimiters.set(tier.name, limiter);
    }

    const result = await limiter.limit(identifier);
    const now = Date.now();
    const resetTimeSec = Math.ceil(result.reset / 1000);
    const retryAfter = Math.max(1, Math.ceil((result.reset - now) / 1000));

    return {
      success: Boolean(result.success),
      limit: tier.limit,
      remaining: Math.max(0, result.remaining ?? 0),
      reset: resetTimeSec,
      retryAfter,
    };
  } catch (err) {
    console.warn(`Upstash token bucket error for tier ${tier.name}:`, err);
    return null;
  }
}

/**
 * In-memory token bucket rate limit fallback for development, testing,
 * or when Redis credentials are not configured.
 */
export function checkInMemoryTokenBucket(
  tier: RateTier,
  identifier: string,
): RateLimitResult {
  const now = Date.now();
  let bucket = memoryBuckets.get(identifier);

  if (!bucket) {
    bucket = { tokens: tier.limit, lastRefill: now };
    memoryBuckets.set(identifier, bucket);
  }

  // Refill tokens proportionally to elapsed time
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    const refillTokens = (elapsed / tier.windowMs) * tier.limit;
    bucket.tokens = Math.min(tier.limit, bucket.tokens + refillTokens);
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    const remaining = Math.floor(bucket.tokens);
    const resetSec = Math.ceil((now + tier.windowMs) / 1000);
    return {
      success: true,
      limit: tier.limit,
      remaining,
      reset: resetSec,
      retryAfter: 0,
    };
  }

  // Bucket depleted
  const timeToNextTokenMs = Math.ceil(((1 - bucket.tokens) / tier.limit) * tier.windowMs);
  const retryAfter = Math.max(1, Math.ceil(timeToNextTokenMs / 1000));
  const resetSec = Math.ceil((now + timeToNextTokenMs) / 1000);

  return {
    success: false,
    limit: tier.limit,
    remaining: 0,
    reset: resetSec,
    retryAfter,
  };
}

/**
 * Main entry point: checks token bucket rate limit using distributed Upstash Redis
 * with automatic in-memory fallback.
 */
export async function checkTokenBucketRateLimit(
  tier: RateTier,
  identifier: string,
): Promise<RateLimitResult> {
  const distributedResult = await checkDistributedTokenBucket(tier, identifier);
  if (distributedResult !== null) {
    return distributedResult;
  }

  return checkInMemoryTokenBucket(tier, identifier);
}

/**
 * Clears in-memory rate limiting state. Useful in tests.
 */
export function resetTokenBuckets(): void {
  memoryBuckets.clear();
  upstashLimiters.clear();
}
