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
  /**
   * Optional tier identifier used when reporting telemetry metrics.
   */
  tierName?: string;
  /**
   * Whether `consume()` invocations report into the shared fallback telemetry counters.
   * Defaults to true.
   */
  trackMetrics?: boolean;
}

export interface FallbackRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetSeconds: number;
}

export interface TokenBucketLimiterMetrics {
  totalRequests: number;
  allowedRequests: number;
  rejectedRequests: number;
  activeBuckets: number;
}

export interface FallbackTierTelemetry extends TokenBucketLimiterMetrics {
  tier: string;
  lastActivatedAtMs: number | null;
}

export interface FallbackMetricsSnapshot {
  active: boolean;
  activationCount: number;
  totalRequests: number;
  allowedRequests: number;
  rejectedRequests: number;
  totalFallbackDurationMs: number;
  activeFallbackDurationMs: number;
  lastActivatedAtMs: number | null;
  lastRecoveredAtMs: number | null;
  lastReason: string | null;
  activeBucketCount: number;
  tiers: Record<string, FallbackTierTelemetry>;
  exportedAt: string;
}

interface BucketEntry {
  tokens: number;
  lastRefillMs: number;
  lastAccessMs: number;
}

interface InternalTierTelemetry {
  activationCount: number;
  requestCount: number;
  allowedCount: number;
  rejectedCount: number;
}

interface InternalFallbackTelemetryState {
  active: boolean;
  activeSinceMs: number | null;
  lastActivatedAtMs: number | null;
  completedDurationMs: number;
  activationCount: number;
  requestCount: number;
  allowedCount: number;
  rejectedCount: number;
  activeTiersInEpisode: Set<string>;
  byTier: Map<string, InternalTierTelemetry>;
}

const globalForFallback = globalThis as unknown as {
  __worksphereRateLimitFallbackTelemetry?: InternalFallbackTelemetryState;
  __worksphereRateLimitFallbackLimiters?: Map<string, TokenBucketLimiter>;
};

const telemetryState: InternalFallbackTelemetryState =
  globalForFallback.__worksphereRateLimitFallbackTelemetry ?? {
    active: false,
    activeSinceMs: null,
    lastActivatedAtMs: null,
    completedDurationMs: 0,
    activationCount: 0,
    requestCount: 0,
    allowedCount: 0,
    rejectedCount: 0,
    activeTiersInEpisode: new Set<string>(),
    byTier: new Map<string, InternalTierTelemetry>(),
  };

if (!globalForFallback.__worksphereRateLimitFallbackTelemetry) {
  globalForFallback.__worksphereRateLimitFallbackTelemetry = telemetryState;
}

function resolveMonotonicNow(nowMonotonic?: number): number {
  return typeof nowMonotonic === "number" && Number.isFinite(nowMonotonic)
    ? nowMonotonic
    : performance.now();
}

function getOrCreateTierTelemetry(tierName: string): InternalTierTelemetry {
  let entry = telemetryState.byTier.get(tierName);
  if (!entry) {
    entry = {
      activationCount: 0,
      requestCount: 0,
      allowedCount: 0,
      rejectedCount: 0,
    };
    telemetryState.byTier.set(tierName, entry);
  }
  return entry;
}

/**
 * Records entry into fallback rate-limiting mode for a given tier.
 * Consecutive calls while already in fallback mode belong to the same outage episode
 * unless recovery has been recorded via `recordFallbackRecovery()`.
 */
export function recordFallbackActivation(
  tierName = "default",
  nowMonotonic?: number,
): void {
  const now = resolveMonotonicNow(nowMonotonic);

  if (!telemetryState.active) {
    telemetryState.active = true;
    telemetryState.activeSinceMs = now;
    telemetryState.lastActivatedAtMs = now;
    telemetryState.activationCount += 1;
    telemetryState.activeTiersInEpisode.clear();
  }

  if (!telemetryState.activeTiersInEpisode.has(tierName)) {
    telemetryState.activeTiersInEpisode.add(tierName);
    const tierStats = getOrCreateTierTelemetry(tierName);
    tierStats.activationCount += 1;
  }
}

/**
 * Records recovery back to primary Redis rate limiting, closing the active fallback
 * episode and accumulating its elapsed duration.
 */
export function recordFallbackRecovery(nowMonotonic?: number): void {
  if (!telemetryState.active) {
    return;
  }

  const now = resolveMonotonicNow(nowMonotonic);
  if (telemetryState.activeSinceMs !== null) {
    telemetryState.completedDurationMs += Math.max(
      0,
      now - telemetryState.activeSinceMs,
    );
  }
  telemetryState.active = false;
  telemetryState.activeSinceMs = null;
  telemetryState.activeTiersInEpisode.clear();
}

function recordFallbackConsume(
  tierName: string,
  allowed: boolean,
  now: number,
): void {
  if (!telemetryState.active) {
    recordFallbackActivation(tierName, now);
  } else if (!telemetryState.activeTiersInEpisode.has(tierName)) {
    telemetryState.activeTiersInEpisode.add(tierName);
    getOrCreateTierTelemetry(tierName).activationCount += 1;
  }

  telemetryState.requestCount += 1;
  if (allowed) {
    telemetryState.allowedCount += 1;
  } else {
    telemetryState.rejectedCount += 1;
  }

  const tierStats = getOrCreateTierTelemetry(tierName);
  tierStats.requestCount += 1;
  if (allowed) {
    tierStats.allowedCount += 1;
  } else {
    tierStats.rejectedCount += 1;
  }
}

export class TokenBucketLimiter {
  public readonly capacity: number;
  public readonly refillRatePerSecond: number;
  public readonly burstAllowance: number;
  public readonly effectiveCapacity: number;
  public readonly maxIdleMs: number;
  public readonly maxBuckets: number;
  public readonly tierName: string;
  public readonly trackMetrics: boolean;

  private readonly buckets = new Map<string, BucketEntry>();
  private totalRequests = 0;
  private allowedRequests = 0;
  private rejectedRequests = 0;

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
    this.tierName = config.tierName ?? "default";
    this.trackMetrics = config.trackMetrics ?? true;
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
    const now = resolveMonotonicNow(nowMonotonic);

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

    this.totalRequests += 1;

    if (entry.tokens >= safeCost) {
      // Deduct atomically
      entry.tokens -= safeCost;
      this.allowedRequests += 1;
      return {
        allowed: true,
        limit: this.effectiveCapacity,
        remaining: Math.floor(entry.tokens),
        retryAfterSeconds: 0,
        resetSeconds,
      };
    }

    // Rejected requests must NEVER consume tokens
    this.rejectedRequests += 1;
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

  public getMetrics(): TokenBucketLimiterMetrics {
    return {
      totalRequests: this.totalRequests,
      allowedRequests: this.allowedRequests,
      rejectedRequests: this.rejectedRequests,
      activeBuckets: this.buckets.size,
    };
  }

  public resetMetrics(): void {
    this.totalRequests = 0;
    this.allowedRequests = 0;
    this.rejectedRequests = 0;
  }

  /**
   * Returns per-limiter request and rejection counters.
   */
  public getMetrics(): {
    requestCount: number;
    allowedCount: number;
    rejectedCount: number;
    activeBuckets: number;
  } {
    return {
      requestCount: this.instanceRequestCount,
      allowedCount: this.instanceAllowedCount,
      rejectedCount: this.instanceRejectedCount,
      activeBuckets: this.buckets.size,
    };
  }

  /**
   * Prunes idle buckets that have been inactive longer than maxIdleMs.
   */
  public pruneExpired(nowMonotonic?: number): number {
    const now = resolveMonotonicNow(nowMonotonic);

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
   * Resets all in-memory buckets and instance counters (useful for test isolation).
   */
  public reset(): void {
    this.buckets.clear();
    this.resetMetrics();
  }
}

/**
 * Global fallback limiter singleton cache keyed by tier name.
 */
const fallbackLimiters = new Map<string, TokenBucketLimiter>();
const tierLastActivatedAtMs = new Map<string, number>();

interface FallbackTelemetryState {
  active: boolean;
  activationCount: number;
  currentEpisodeStartMs: number | null;
  accumulatedDurationMs: number;
  lastActivatedAtMs: number | null;
  lastRecoveredAtMs: number | null;
  lastReason: string | null;
}

const telemetryState: FallbackTelemetryState = {
  active: false,
  activationCount: 0,
  currentEpisodeStartMs: null,
  accumulatedDurationMs: 0,
  lastActivatedAtMs: null,
  lastRecoveredAtMs: null,
  lastReason: null,
};

function normalizeTimestampMs(nowMs?: number): number {
  return typeof nowMs === "number" && Number.isFinite(nowMs)
    ? nowMs
    : Date.now();
}

export function isFallbackActive(): boolean {
  return telemetryState.active;
}

/**
 * Records an in-memory fallback activation due to a Redis timeout or outage.
 * Consecutive calls while already active update metadata without double-counting
 * the same outage episode.
 */
export function recordFallbackActivation(
  reason?: string,
  tierName?: string,
  nowMs?: number,
): void {
  const ts = normalizeTimestampMs(nowMs);
  if (!telemetryState.active) {
    telemetryState.active = true;
    telemetryState.activationCount += 1;
    telemetryState.currentEpisodeStartMs = ts;
  }
  telemetryState.lastActivatedAtMs = ts;
  if (reason && reason.trim().length > 0) {
    telemetryState.lastReason = reason.trim();
  }
  if (tierName && tierName.trim().length > 0) {
    tierLastActivatedAtMs.set(tierName.trim(), ts);
  }
}

/**
 * Marks the end of an active fallback outage episode when Redis recovers
 * and accumulates its duration into totalFallbackDurationMs.
 */
export function recordFallbackRecovery(nowMs?: number): void {
  if (!telemetryState.active) {
    return;
  }
  const ts = normalizeTimestampMs(nowMs);
  if (telemetryState.currentEpisodeStartMs !== null) {
    telemetryState.accumulatedDurationMs += Math.max(
      0,
      ts - telemetryState.currentEpisodeStartMs,
    );
  }
  telemetryState.active = false;
  telemetryState.currentEpisodeStartMs = null;
  telemetryState.lastRecoveredAtMs = ts;
}

/**
 * Returns a structured telemetry snapshot suitable for `/api/health` or admin vitals.
 */
export function getFallbackMetricsSnapshot(
  nowMs?: number,
): FallbackMetricsSnapshot {
  const ts = normalizeTimestampMs(nowMs);
  const activeFallbackDurationMs =
    telemetryState.active && telemetryState.currentEpisodeStartMs !== null
      ? Math.max(0, ts - telemetryState.currentEpisodeStartMs)
      : 0;

  let totalRequests = 0;
  let allowedRequests = 0;
  let rejectedRequests = 0;
  let activeBucketCount = 0;
  const tiers: Record<string, FallbackTierTelemetry> = {};

  for (const [tier, limiter] of fallbackLimiters.entries()) {
    const m = limiter.getMetrics();
    totalRequests += m.totalRequests;
    allowedRequests += m.allowedRequests;
    rejectedRequests += m.rejectedRequests;
    activeBucketCount += m.activeBuckets;
    tiers[tier] = {
      tier,
      ...m,
      lastActivatedAtMs: tierLastActivatedAtMs.get(tier) ?? null,
    };
  }

  return {
    active: telemetryState.active,
    activationCount: telemetryState.activationCount,
    totalRequests,
    allowedRequests,
    rejectedRequests,
    totalFallbackDurationMs:
      telemetryState.accumulatedDurationMs + activeFallbackDurationMs,
    activeFallbackDurationMs,
    lastActivatedAtMs: telemetryState.lastActivatedAtMs,
    lastRecoveredAtMs: telemetryState.lastRecoveredAtMs,
    lastReason: telemetryState.lastReason,
    activeBucketCount,
    tiers,
    exportedAt: new Date(ts).toISOString(),
  };
}

/**
 * Formats fallback telemetry in Prometheus/OpenMetrics text exposition format.
 */
export function formatFallbackMetricsPrometheus(
  snapshot: FallbackMetricsSnapshot = getFallbackMetricsSnapshot(),
): string {
  const lines = [
    "# HELP worksphere_ratelimit_fallback_active Whether the in-memory rate-limit fallback is currently active (1 = active, 0 = inactive).",
    "# TYPE worksphere_ratelimit_fallback_active gauge",
    `worksphere_ratelimit_fallback_active ${snapshot.active ? 1 : 0}`,
    "# HELP worksphere_ratelimit_fallback_activations_total Total number of fallback activation episodes triggered by Redis timeouts or outages.",
    "# TYPE worksphere_ratelimit_fallback_activations_total counter",
    `worksphere_ratelimit_fallback_activations_total ${snapshot.activationCount}`,
    "# HELP worksphere_ratelimit_fallback_duration_ms_total Cumulative duration spent in fallback mode in milliseconds.",
    "# TYPE worksphere_ratelimit_fallback_duration_ms_total counter",
    `worksphere_ratelimit_fallback_duration_ms_total ${snapshot.totalFallbackDurationMs}`,
    "# HELP worksphere_ratelimit_fallback_requests_total Total requests evaluated by the in-memory fallback limiter.",
    "# TYPE worksphere_ratelimit_fallback_requests_total counter",
    `worksphere_ratelimit_fallback_requests_total{outcome="allowed"} ${snapshot.allowedRequests}`,
    `worksphere_ratelimit_fallback_requests_total{outcome="rejected"} ${snapshot.rejectedRequests}`,
    "# HELP worksphere_ratelimit_fallback_active_buckets Active client buckets currently tracked in memory.",
    "# TYPE worksphere_ratelimit_fallback_active_buckets gauge",
    `worksphere_ratelimit_fallback_active_buckets ${snapshot.activeBucketCount}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Resets fallback telemetry counters and episode state without clearing limiters.
 */
export function resetFallbackMetrics(): void {
  telemetryState.active = false;
  telemetryState.activationCount = 0;
  telemetryState.currentEpisodeStartMs = null;
  telemetryState.accumulatedDurationMs = 0;
  telemetryState.lastActivatedAtMs = null;
  telemetryState.lastRecoveredAtMs = null;
  telemetryState.lastReason = null;
  tierLastActivatedAtMs.clear();
  for (const limiter of fallbackLimiters.values()) {
    limiter.resetMetrics();
  }
}

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
    tierName,
    trackMetrics: true,
  });
  fallbackLimiters.set(tierName, limiter);
  return limiter;
}

/**
 * Clears cached fallback limiters and resets telemetry (for testing).
 */
export function resetFallbackLimiters(): void {
  fallbackLimiters.clear();
  resetFallbackMetrics();
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
    if (
      err.code === "ETIMEDOUT" ||
      err.code === "ECONNREFUSED" ||
      err.code === "ECONNRESET" ||
      err.code === "EAI_AGAIN"
    ) {
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
