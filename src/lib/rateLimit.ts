/**
 * Rate Limiting — Upstash Redis (distributed) with in-memory fallback
 *
 * Production: Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env
 * Development: Falls back to an in-memory sliding window automatically
 */

// ─── Upstash (production) ────────────────────────────────────────────────────
let upstashRatelimit: {
  limit: (identifier: string) => Promise<{ success: boolean; remaining: number; reset: number }>;
} | null = null;

function getUpstashRatelimit(limitPerMinute: number) {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }

  try {
    // Dynamic require so the build doesn't fail if packages aren't present yet
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Ratelimit } = require("@upstash/ratelimit");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis");

    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limitPerMinute, "1 m"),
      analytics: true,
      prefix: "worksphere:ratelimit",
    }) as {
      limit: (
        identifier: string
      ) => Promise<{ success: boolean; remaining: number; reset: number }>;
    };
  } catch {
    return null;
  }
}

// ─── In-memory fallback (development / no Redis) ─────────────────────────────
interface MemEntry {
  count: number;
  resetTime: number;
}
const memStore = new Map<string, MemEntry>();
const WINDOW_MS = 60_000;

function memRateLimit(identifier: string, limit: number): boolean {
  const now = Date.now();

  // Periodic cleanup — keep memory from growing unbounded
  if (memStore.size > 10_000) {
    for (const [k, v] of memStore) {
      if (now > v.resetTime) memStore.delete(k);
    }
  }

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
  limit: number
): { count: number; remaining: number; resetTime: number; isLimited: boolean } {
  const entry = memStore.get(identifier);
  if (!entry || Date.now() > entry.resetTime) {
    return { count: 0, remaining: limit, resetTime: Date.now() + WINDOW_MS, isLimited: false };
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
  limit = 10
): Promise<boolean> {
  const rl = upstashRatelimit ?? getUpstashRatelimit(limit);

  if (rl) {
    upstashRatelimit = rl; // cache for subsequent calls
    const { success } = await rl.limit(identifier);
    return success;
  }

  return memRateLimit(identifier, limit);
}

/**
 * Returns rate-limit metadata for the given identifier.
 * Falls back to in-memory data when Upstash is not configured.
 */
export function getRateLimitInfo(
  identifier: string,
  limit = 10
): { count: number; remaining: number; resetTime: number; isLimited: boolean } | null {
  return memGetInfo(identifier, limit);
}

/** Reset in-memory rate limit (useful in tests). */
export function resetRateLimit(identifier?: string): void {
  if (identifier) {
    memStore.delete(identifier);
  } else {
    memStore.clear();
  }
}
