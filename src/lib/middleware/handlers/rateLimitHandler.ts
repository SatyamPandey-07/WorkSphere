import { NextResponse } from "next/server";
import {
  matchRateTier,
  getClientIp,
  checkTokenBucketRateLimit,
  type RateLimitResult,
} from "@/lib/tokenBucketRateLimit";
import {
  consumeSensitiveRateLimit,
  createSlidingWindowRateLimitResponse,
  getSlidingWindowRateLimitHeaders,
  matchSensitiveRateLimit,
} from "@/lib/rateLimit/slidingWindowRateLimiter";
import {
  getOrCreateFallbackLimiter,
  isRecoverableRedisError,
} from "@/lib/ratelimit/tokenBucketFallback";
import type { MiddlewareHandler } from "../types";

export const REDIS_TIMEOUT_MS = 1500;

export const rateLimitMiddleware: MiddlewareHandler = async (
  req,
  ctx,
  next,
) => {
  // CORS preflight requests bypass rate limits
  if (req.method === "OPTIONS") {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api")) {
    const sensitiveRule = matchSensitiveRateLimit(req.nextUrl.pathname);

    if (sensitiveRule) {
      const clientIp = getClientIp(req);
      let userId: string | null = null;
      if (ctx.userId !== undefined) {
        userId = ctx.userId;
      } else if (ctx.auth) {
        try {
          const authState = await ctx.auth();
          userId = authState?.userId ?? null;
          ctx.userId = userId;
          ctx.sessionClaims = authState?.sessionClaims ?? null;
        } catch {
          // Fall back to IP identifier if auth resolution fails
        }
      }

      const identifier = userId || clientIp;
      const fallback: RateLimitResult = {
        success: true,
        limit: sensitiveRule.limit,
        remaining: sensitiveRule.limit,
        reset: Math.ceil((Date.now() + sensitiveRule.windowMs) / 1000),
        retryAfter: 0,
        identity: identifier,
      };

      let strictResult: RateLimitResult;
      try {
        const timeoutPromise = new Promise<RateLimitResult>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Redis rate-limit check timed out")),
            REDIS_TIMEOUT_MS,
          );
          timer.unref?.();
        });

        strictResult = await Promise.race([
          consumeSensitiveRateLimit(req.nextUrl.pathname, identifier).then(
            (check) => check?.result ?? fallback,
          ),
          timeoutPromise,
        ]);
      } catch (err: unknown) {
        if (isRecoverableRedisError(err)) {
          // Activate in-memory token bucket fallback limiter to prevent unbounded traffic during outages
          const refillRate = sensitiveRule.limit / (sensitiveRule.windowMs / 1000);
          const fallbackLimiter = getOrCreateFallbackLimiter(
            `sensitive:${sensitiveRule.name}`,
            sensitiveRule.limit,
            refillRate,
            0,
          );
          const fbRes = fallbackLimiter.consume(identifier, 1);
          strictResult = {
            success: fbRes.allowed,
            limit: fbRes.limit,
            remaining: fbRes.remaining,
            reset: Math.floor(Date.now() / 1000) + fbRes.resetSeconds,
            retryAfter: fbRes.retryAfterSeconds,
            identity: identifier,
          };
        } else {
          strictResult = fallback;
        }
      }

      if (!strictResult.success) {
        return createSlidingWindowRateLimitResponse(strictResult);
      }

      ctx.rateLimitHeaders = getSlidingWindowRateLimitHeaders(strictResult);
    } else {
      // Multi-tier token bucket rate limiting for remaining API routes
      const tier = matchRateTier(req.nextUrl.pathname, req.method);
      if (tier) {
        const clientIp = getClientIp(req);
        let userId: string | null = null;
        if (ctx.userId !== undefined) {
          userId = ctx.userId;
        } else if (ctx.auth) {
          try {
            const authState = await ctx.auth();
            userId = authState?.userId ?? null;
            ctx.userId = userId;
            ctx.sessionClaims = authState?.sessionClaims ?? null;
          } catch {
            // Fall back to IP identifier if auth resolution fails
          }
        }

        const identifier = `${tier.name}:${userId || clientIp}`;

        let rateLimitResult: RateLimitResult;
        try {
          const timeoutPromise = new Promise<RateLimitResult>((_, reject) => {
            const timer = setTimeout(() => {
              reject(new Error("Redis token bucket rate-limit check timed out"));
            }, REDIS_TIMEOUT_MS);
            timer.unref?.();
          });

          rateLimitResult = await Promise.race([
            checkTokenBucketRateLimit(tier, identifier),
            timeoutPromise,
          ]);
        } catch (err: unknown) {
          if (isRecoverableRedisError(err)) {
            // Activate client-side / edge token bucket fallback when Redis experiences transient failure
            const refillRate = tier.limit / (tier.windowMs / 1000);
            const fallbackLimiter = getOrCreateFallbackLimiter(
              `tier:${tier.name}`,
              tier.limit,
              refillRate,
              0,
            );
            const fbRes = fallbackLimiter.consume(identifier, 1);
            rateLimitResult = {
              success: fbRes.allowed,
              limit: fbRes.limit,
              remaining: fbRes.remaining,
              reset: Math.floor(Date.now() / 1000) + fbRes.resetSeconds,
              retryAfter: fbRes.retryAfterSeconds,
              tier: tier.name,
              identity: identifier,
            };
          } else {
            // Fail-open for unrecognized exceptions to preserve availability
            rateLimitResult = {
              success: true,
              limit: tier.limit,
              remaining: tier.limit,
              reset: Math.ceil((Date.now() + tier.windowMs) / 1000),
              retryAfter: 0,
              tier: tier.name,
              identity: identifier,
            };
          }
        }

        if (!rateLimitResult.success) {
          const retryAfter = Math.max(1, rateLimitResult.retryAfter);
          const resetSeconds = Math.max(
            1,
            rateLimitResult.reset - Math.floor(Date.now() / 1000) > 0
              ? rateLimitResult.reset - Math.floor(Date.now() / 1000)
              : retryAfter,
          );

          return NextResponse.json(
            {
              error: "Too many requests. Please slow down and try again.",
              retryAfter,
              limit: rateLimitResult.limit,
              remaining: rateLimitResult.remaining,
              reset: rateLimitResult.reset,
            },
            {
              status: 429,
              headers: {
                "Retry-After": String(retryAfter),
                "RateLimit-Limit": String(rateLimitResult.limit),
                "RateLimit-Remaining": String(rateLimitResult.remaining),
                "RateLimit-Reset": String(resetSeconds),
                "X-RateLimit-Limit": String(rateLimitResult.limit),
                "X-RateLimit-Remaining": String(rateLimitResult.remaining),
                "X-RateLimit-Reset": String(rateLimitResult.reset),
              },
            },
          );
        }

        const resetCountdown = Math.max(
          0,
          rateLimitResult.reset - Math.floor(Date.now() / 1000),
        );
        ctx.rateLimitHeaders = {
          "RateLimit-Limit": String(rateLimitResult.limit),
          "RateLimit-Remaining": String(rateLimitResult.remaining),
          "RateLimit-Reset": String(resetCountdown),
          "X-RateLimit-Limit": String(rateLimitResult.limit),
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
          "X-RateLimit-Reset": String(rateLimitResult.reset),
        };
      }
    }
  }

  const res = await next();

  if (ctx.rateLimitHeaders) {
    for (const [key, value] of Object.entries(ctx.rateLimitHeaders)) {
      res.headers.set(key, value);
    }
  }

  return res;
};
