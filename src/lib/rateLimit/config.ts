import type { RateLimitTier, RateTierType, RateTier, TierConfig } from "./types";

/**
 * Centralized Tier Configurations:
 * - Anonymous: 10 requests / 15 minutes, identified by client IP.
 * - Authenticated: 60 requests / 15 minutes, identified by Clerk user ID.
 * - Public: 60 requests / 1 minute.
 * - Admin: 120 requests / 1 minute.
 * - Webhooks: 1000 requests / 1 minute (high throughput for verified webhooks).
 */
export const TIER_CONFIGS: Record<RateLimitTier, TierConfig> = {
  anonymous: {
    limit: 10,
    windowMs: 15 * 60 * 1000, // 15 minutes
    windowDuration: "15 m",
  },
  authenticated: {
    limit: 60,
    windowMs: 15 * 60 * 1000, // 15 minutes
    windowDuration: "15 m",
  },
  public: {
    limit: 60,
    windowMs: 60 * 1000, // 1 minute
    windowDuration: "1 m",
  },
  admin: {
    limit: 120,
    windowMs: 60 * 1000, // 1 minute
    windowDuration: "1 m",
  },
  webhooks: {
    limit: 1000,
    windowMs: 60 * 1000, // 1 minute
    windowDuration: "1 m",
  },
} as const;

/**
 * Multi-Tier Token Bucket Rate Limiting:
 * - Public search: 60 req/min
 * - Authentication endpoints: 5 req/min
 * - Telemetry ingestion: 120 req/min
 */
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
 * Resolves client IP from request or headers.
 */
export function getClientIp(reqOrHeaders: Request | Headers): string {
  const headers =
    reqOrHeaders instanceof Headers ? reqOrHeaders : reqOrHeaders.headers;

  if (
    "ip" in reqOrHeaders &&
    typeof (reqOrHeaders as any).ip === "string" &&
    (reqOrHeaders as any).ip.trim()
  ) {
    return (reqOrHeaders as any).ip.trim();
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }

  return "127.0.0.1";
}
