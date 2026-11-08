export type RateLimitTier = "anonymous" | "authenticated" | "public" | "admin" | "webhooks";

export type RateTierType = "search" | "auth" | "telemetry";

export interface TierConfig {
  readonly limit: number;
  readonly windowMs: number;
  readonly windowDuration?: `${number} m` | `${number}m` | `${number} s` | `${number}s` | string;
  readonly interval?: string;
}

export interface RateTier {
  name: RateTierType;
  limit: number;
  windowMs: number;
  interval: "1 m";
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds or epoch ms
  retryAfter: number; // Seconds to wait
  tier?: string;
  identity?: string;
}

export interface TieredRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number; // in seconds
  reset: number; // epoch ms
  tier: RateLimitTier;
  identity: string;
}

export interface CheckTieredRateLimitOptions {
  /** Explicit user ID override (e.g. for testing or pre-authenticated requests). */
  userId?: string | null;
  /** Explicit client IP override (e.g. for testing) */
  ip?: string;
  /** Namespace prefix for rate limiting (default: "ai-public") */
  namespace?: string;
}

/**
 * Unified Rate Limiter interface.
 */
export interface IRateLimiter {
  /**
   * Consume a given number of points for the specified key/identifier.
   */
  consume(key: string, points?: number): Promise<RateLimitResult>;

  /**
   * Check remaining points without consuming quota.
   */
  check?(key: string): Promise<RateLimitResult>;

  /**
   * Reset rate limit state for a key or all keys.
   */
  reset?(key?: string): Promise<void> | void;
}
