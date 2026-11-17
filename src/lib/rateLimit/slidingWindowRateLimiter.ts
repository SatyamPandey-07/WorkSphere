import { NextResponse } from "next/server";
import type { IRateLimiter, RateLimitResult } from "./types";
import {
  defaultMemoryStore,
  type MemoryRateLimitStore,
} from "./stores/memoryStore";
import { getRedisClient, microTimestampMember } from "./stores/redisStore";
import { SLIDING_WINDOW_LOG_LUA_SCRIPT } from "./lua/slidingWindowScript";

export { SLIDING_WINDOW_LOG_LUA_SCRIPT };

export interface SlidingWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
  namespace?: string;
  store?: MemoryRateLimitStore;
}

export interface AtomicSlidingWindowResult extends RateLimitResult {
  count: number;
}

function sanitizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
}

function sanitizeWindow(windowMs: number): number {
  return Number.isFinite(windowMs) && windowMs > 0
    ? Math.floor(windowMs)
    : 60_000;
}

function sanitizeCost(cost: number, allowZero = false): number {
  if (!Number.isFinite(cost)) return allowZero ? 0 : 1;
  const floor = Math.floor(cost);
  return allowZero ? Math.max(0, floor) : Math.max(1, floor);
}

export async function executeSlidingWindowLog(
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
  cost = 1,
): Promise<AtomicSlidingWindowResult | null> {
  if (!redis || typeof redis.eval !== "function") return null;

  const safeLimit = sanitizeLimit(limit);
  const safeWindowMs = sanitizeWindow(windowMs);
  const safeNow = Number.isFinite(now) && now > 0 ? now : Date.now();
  const safeCost = sanitizeCost(cost);

  try {
    const rawResult = await redis.eval(
      SLIDING_WINDOW_LOG_LUA_SCRIPT,
      [key],
      [safeLimit, safeWindowMs, safeNow, member, safeCost],
    );

    const [allowedNum, remainingNum, resetSecNum, retryAfterNum, countNum] =
      Array.isArray(rawResult)
        ? rawResult
        : [0, 0, Math.ceil((safeNow + safeWindowMs) / 1000), 1, safeLimit];

    return {
      success: Number(allowedNum) === 1,
      limit: safeLimit,
      remaining: Math.max(0, Number(remainingNum)),
      reset: Number(resetSecNum),
      retryAfter: Math.max(0, Number(retryAfterNum)),
      identity: key,
      count: Math.max(0, Number(countNum)),
    };
  } catch (err) {
    console.error(
      "[SlidingWindowRateLimiter] Atomic Lua evaluation failed:",
      err,
    );
    return null;
  }
}

export class SlidingWindowRateLimiter implements IRateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly namespace: string;
  private readonly store: MemoryRateLimitStore;

  constructor(options: SlidingWindowRateLimiterOptions) {
    this.limit = sanitizeLimit(options.limit);
    this.windowMs = sanitizeWindow(options.windowMs);
    this.namespace = options.namespace || "sliding-window";
    this.store = options.store || defaultMemoryStore;
  }

  private redisKey(key: string): string {
    return `worksphere:ratelimit:${this.namespace}:${key}`;
  }

  private memoryKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async consume(key: string, points = 1): Promise<RateLimitResult> {
    const cost = sanitizeCost(points);
    const now = Date.now();
    const redis = getRedisClient();
    if (redis) {
      const atomicResult = await executeSlidingWindowLog(
        redis,
        this.redisKey(key),
        this.limit,
        this.windowMs,
        now,
        undefined,
        cost,
      );
      if (atomicResult !== null) {
        return atomicResult;
      }
    }

    return this.consumeMemory(key, cost, now);
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const redis = getRedisClient();
    if (redis) {
      const atomicResult = await executeSlidingWindowLog(
        redis,
        this.redisKey(key),
        this.limit,
        this.windowMs,
        now,
        undefined,
        0,
      );
      if (atomicResult !== null) {
        return atomicResult;
      }
    }

    return this.checkMemory(key, now);
  }

  private consumeMemory(
    key: string,
    cost: number,
    now: number,
  ): RateLimitResult {
    const storeKey = this.memoryKey(key);
    const windowStart = now - this.windowMs;
    let entry = this.store.getSlidingWindowEntry(storeKey);

    if (!entry) {
      entry = { timestamps: [], resetTime: now + this.windowMs };
    }

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

    if (entry.timestamps.length + cost > this.limit) {
      const resetTimeMs =
        entry.timestamps[0] !== undefined
          ? entry.timestamps[0] + this.windowMs
          : now + this.windowMs;
      entry.resetTime = resetTimeMs;
      this.store.setSlidingWindowEntry(storeKey, entry);
      return {
        success: false,
        limit: this.limit,
        remaining: Math.max(0, this.limit - entry.timestamps.length),
        reset: Math.ceil(resetTimeMs / 1000),
        retryAfter: Math.max(1, Math.ceil((resetTimeMs - now) / 1000)),
        identity: key,
      };
    }

    for (let i = 0; i < cost; i++) {
      entry.timestamps.push(now);
    }
    const resetTimeMs =
      entry.timestamps[0] !== undefined
        ? entry.timestamps[0] + this.windowMs
        : now + this.windowMs;
    entry.resetTime = resetTimeMs;
    this.store.setSlidingWindowEntry(storeKey, entry);

    return {
      success: true,
      limit: this.limit,
      remaining: Math.max(0, this.limit - entry.timestamps.length),
      reset: Math.ceil(resetTimeMs / 1000),
      retryAfter: 0,
      identity: key,
    };
  }

  private checkMemory(key: string, now: number): RateLimitResult {
    const entry = this.store.getSlidingWindowEntry(this.memoryKey(key));
    if (!entry) {
      return {
        success: true,
        limit: this.limit,
        remaining: this.limit,
        reset: Math.ceil((now + this.windowMs) / 1000),
        retryAfter: 0,
        identity: key,
      };
    }

    const windowStart = now - this.windowMs;
    let firstValid = 0;
    while (
      firstValid < entry.timestamps.length &&
      entry.timestamps[firstValid] <= windowStart
    ) {
      firstValid++;
    }

    const validCount = entry.timestamps.length - firstValid;
    const resetTimeMs =
      validCount > 0
        ? entry.timestamps[firstValid] + this.windowMs
        : now + this.windowMs;

    return {
      success: validCount < this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - validCount),
      reset: Math.ceil(resetTimeMs / 1000),
      retryAfter:
        validCount >= this.limit
          ? Math.max(1, Math.ceil((resetTimeMs - now) / 1000))
          : 0,
      identity: key,
    };
  }

  reset(key?: string): void {
    if (key) {
      this.store.deleteSlidingWindowEntry(this.memoryKey(key));
      return;
    }
    this.store.clearSlidingWindow();
  }
}

export type SensitiveRateLimitScope = "auth" | "bookings" | "pay";

export interface SensitiveRateLimitRule {
  readonly scope: SensitiveRateLimitScope;
  readonly namespace: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly pathPrefixes: readonly string[];
}

export const SENSITIVE_RATE_LIMIT_RULES: Record<
  SensitiveRateLimitScope,
  SensitiveRateLimitRule
> = {
  auth: {
    scope: "auth",
    namespace: "strict-auth",
    limit: 30,
    windowMs: 60_000,
    pathPrefixes: ["/api/auth"],
  },
  bookings: {
    scope: "bookings",
    namespace: "strict-bookings",
    limit: 10,
    windowMs: 60_000,
    pathPrefixes: ["/api/bookings"],
  },
  pay: {
    scope: "pay",
    namespace: "strict-pay",
    limit: 5,
    windowMs: 60_000,
    pathPrefixes: ["/api/pay"],
  },
};

export function matchSensitiveRateLimit(
  pathname: string,
): SensitiveRateLimitRule | null {
  for (const rule of Object.values(SENSITIVE_RATE_LIMIT_RULES)) {
    for (const prefix of rule.pathPrefixes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return rule;
      }
    }
  }
  return null;
}

export interface SensitiveRateLimitCheck {
  rule: SensitiveRateLimitRule;
  result: RateLimitResult;
}

export async function consumeSensitiveRateLimit(
  pathname: string,
  identifier: string,
  options: {
    limiter?: IRateLimiter;
    store?: MemoryRateLimitStore;
  } = {},
): Promise<SensitiveRateLimitCheck | null> {
  const rule = matchSensitiveRateLimit(pathname);
  if (!rule) return null;

  const limiter =
    options.limiter ||
    new SlidingWindowRateLimiter({
      limit: rule.limit,
      windowMs: rule.windowMs,
      namespace: rule.namespace,
      store: options.store,
    });

  const result = await limiter.consume(identifier);
  return { rule, result };
}

export function getSlidingWindowRateLimitHeaders(
  result: RateLimitResult,
  now = Date.now(),
): Record<string, string> {
  const nowSec = Math.floor(now / 1000);
  const resetIn = Math.max(0, result.reset - nowSec);
  const retryAfter = result.success ? 0 : Math.max(1, result.retryAfter);

  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "RateLimit-Reset": String(resetIn),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(result.reset),
    "Retry-After": String(retryAfter),
  };
}

export function createSlidingWindowRateLimitResponse(
  result: RateLimitResult,
): NextResponse {
  return NextResponse.json(
    {
      error: "Too many requests. Please slow down and try again.",
      retryAfter: Math.max(1, result.retryAfter),
      limit: result.limit,
      remaining: Math.max(0, result.remaining),
      reset: result.reset,
    },
    {
      status: 429,
      headers: getSlidingWindowRateLimitHeaders(result),
    },
  );
}
