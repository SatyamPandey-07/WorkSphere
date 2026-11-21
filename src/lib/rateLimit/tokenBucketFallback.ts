/**
 * tokenBucketFallback.ts
 * In-memory client-side/edge token bucket fallback rate limiter.
 *
 * Activated strictly when external Redis or edge rate-limiting services encounter
 * transient network failures (HTTP 503, ETIMEDOUT, ECONNREFUSED, or gateway timeouts),
 * preventing fail-open unlimited request vulnerabilities while preserving resilience.
 *
 * Uses monotonic timestamps via `performance.now()` to ensure immunity against
 * system clock jumps, NTP synchronizations, or daylight savings shifts.
 */

export interface TokenBucketFallbackConfig {
  /**
   * Maximum token capacity that the bucket can hold.
   * Must be a positive finite number.
   */
  capacity: number;
  /**
   * Refill rate in tokens per second.
   * Must be a positive finite number.
   */
  refillRatePerSecond: number;
  /**
   * Burst allowance above the base capacity.
   * When > 0, effective capacity = capacity + burstAllowance.
   * Must be a non-negative finite number (default: 0).
   */
  burstAllowance?: number;
  /**
   * Maximum idle time in milliseconds before a bucket entry is pruned.
   * Defaults to 60,000 ms (1 minute).
   */
  maxIdleMs?: number;
  /**
   * Maximum number of active buckets allowed in memory to prevent memory leaks/DoS.
   * Defaults to 10,000 entries.
   */
  maxBuckets?: number;
}

export interface FallbackRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetSeconds: number;
}

interface BucketEntry {
  tokens: number;
  lastRefillMs: number;
  lastAccessMs: number;
}

export class TokenBucketLimiter {
  public readonly capacity: number;
  public readonly refillRatePerSecond: number;
  public readonly burstAllowance: number;
  public readonly effectiveCapacity: number;
  public readonly maxIdleMs: number;
  public readonly maxBuckets: number;

  private readonly buckets = new Map<string, BucketEntry>();

  constructor(config: TokenBucketFallbackConfig) {
    if (
      typeof config.capacity !== "number" ||
      !Number.isFinite(config.capacity) ||
      config.capacity <= 0
    ) {
      throw new Error(
        `TokenBucketLimiter: capacity must be a positive finite number, received: ${config.capacity}`,
      );
    }

    if (
      typeof config.refillRatePerSecond !== "number" ||
      !Number.isFinite(config.refillRatePerSecond) ||
      config.refillRatePerSecond <= 0
    ) {
      throw new Error(
        `TokenBucketLimiter: refillRatePerSecond must be a positive finite number, received: ${config.refillRatePerSecond}`,
      );
    }

    const burst = config.burstAllowance ?? 0;
    if (
      typeof burst !== "number" ||
      !Number.isFinite(burst) ||
      burst < 0
    ) {
      throw new Error(
        `TokenBucketLimiter: burstAllowance must be a non-negative finite number, received: ${burst}`,
      );
    }

    this.capacity = config.capacity;
    this.refillRatePerSecond = config.refillRatePerSecond;
    this.burstAllowance = burst;
    this.effectiveCapacity = config.capacity + burst;
    this.maxIdleMs = config.maxIdleMs ?? 60_000;
    this.maxBuckets = config.maxBuckets ?? 10_000;
  }

  /**
   * Evaluates and consumes tokens for a given identifier atomically within the event loop.
   *
   * @param identifier Unique client key (e.g. `tier:userId` or `tier:clientIp`)
   * @param cost Number of tokens requested (default: 1)
   * @param nowMonotonic Optional monotonic time override for deterministic testing
   */
  public consume(
    identifier: string,
    cost = 1,
    nowMonotonic?: number,
  ): FallbackRateLimitResult {
    const safeCost =
      Number.isFinite(cost) && cost >= 1 ? Math.floor(cost) : 1;
    const now =
      typeof nowMonotonic === "number" && Number.isFinite(nowMonotonic)
        ? nowMonotonic
        : performance.now();

    let entry = this.buckets.get(identifier);

    if (!entry) {
      // Memory boundary protection: clean up expired buckets if capacity is reached
      if (this.buckets.size >= this.maxBuckets) {
        this.pruneExpired(now);
        // If still full, drop oldest accessed bucket
        if (this.buckets.size >= this.maxBuckets) {
          const oldestKey = this.buckets.keys().next().value;
          if (oldestKey !== undefined) {
            this.buckets.delete(oldestKey);
          }
        }
      }

      entry = {
        tokens: this.effectiveCapacity,
        lastRefillMs: now,
        lastAccessMs: now,
      };
      this.buckets.set(identifier, entry);
    } else {
      // Monotonic delta refill calculation
      const elapsedMs = Math.max(0, now - entry.lastRefillMs);
      if (elapsedMs > 0) {
        const elapsedSeconds = elapsedMs / 1000;
        const tokensToAdd = elapsedSeconds * this.refillRatePerSecond;
        entry.tokens = Math.min(
          this.effectiveCapacity,
          entry.tokens + tokensToAdd,
        );
        entry.lastRefillMs = now;
      }
      entry.lastAccessMs = now;
    }

    const resetSeconds = Math.max(
      1,
      Math.ceil((this.effectiveCapacity - entry.tokens) / this.refillRatePerSecond),
    );

    if (entry.tokens >= safeCost) {
      // Deduct atomically
      entry.tokens -= safeCost;
      return {
        allowed: true,
        limit: this.effectiveCapacity,
        remaining: Math.floor(entry.tokens),
        retryAfterSeconds: 0,
        resetSeconds,
      };
    }

    // Rejected requests must NEVER consume tokens
    const deficit = safeCost - entry.tokens;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(deficit / this.refillRatePerSecond),
    );

    return {
      allowed: false,
      limit: this.effectiveCapacity,
      remaining: Math.floor(entry.tokens),
      retryAfterSeconds,
      resetSeconds: Math.max(resetSeconds, retryAfterSeconds),
    };
  }

  /**
   * Prunes idle buckets that have been inactive longer than maxIdleMs.
   */
  public pruneExpired(nowMonotonic?: number): number {
    const now =
      typeof nowMonotonic === "number" && Number.isFinite(nowMonotonic)
        ? nowMonotonic
        : performance.now();

    let pruned = 0;
    for (const [key, entry] of this.buckets.entries()) {
      if (now - entry.lastAccessMs >= this.maxIdleMs) {
        this.buckets.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Returns current bucket count in memory.
   */
  public get size(): number {
    return this.buckets.size;
  }

  /**
   * Resets all in-memory buckets (useful for test isolation).
   */
  public reset(): void {
    this.buckets.clear();
  }
}

/**
 * Global fallback limiter singleton cache keyed by tier name.
 */
const fallbackLimiters = new Map<string, TokenBucketLimiter>();

/**
 * Retrieves or lazily creates a TokenBucketLimiter instance configured for the tier.
 */
export function getOrCreateFallbackLimiter(
  tierName: string,
  capacity: number,
  refillRatePerSecond: number,
  burstAllowance = 0,
): TokenBucketLimiter {
  const existing = fallbackLimiters.get(tierName);
  if (existing) {
    return existing;
  }

  const limiter = new TokenBucketLimiter({
    capacity,
    refillRatePerSecond,
    burstAllowance,
  });
  fallbackLimiters.set(tierName, limiter);
  return limiter;
}

/**
 * Clears cached fallback limiters (for testing).
 */
export function resetFallbackLimiters(): void {
  fallbackLimiters.clear();
}

/**
 * Determines whether an error returned from Upstash/Redis indicates a transient,
 * recoverable network or service outage (HTTP 503, ETIMEDOUT, ECONNREFUSED, etc.).
 */
export function isRecoverableRedisError(error: unknown): boolean {
  if (!error) return false;

  // Check typed error status codes
  if (typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (err.status === 503 || err.statusCode === 503) {
      return true;
    }
    if (err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED" || err.code === "ECONNRESET" || err.code === "EAI_AGAIN") {
      return true;
    }
    if (typeof err.message === "string") {
      const msg = err.message.toLowerCase();
      if (
        msg.includes("503") ||
        msg.includes("timeout") ||
        msg.includes("timed out") ||
        msg.includes("econnrefused") ||
        msg.includes("network") ||
        msg.includes("service unavailable")
      ) {
        return true;
      }
    }
  }

  return false;
}
