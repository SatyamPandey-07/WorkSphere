import { NextResponse, type NextRequest } from "next/server";
import {
  matchRateTier,
  getClientIp,
  checkTokenBucketRateLimit,
} from "@/lib/tokenBucketRateLimit";
import type { MiddlewareHandler } from "../types";

export const rateLimitMiddleware: MiddlewareHandler = async (req, ctx, next) => {
  // CORS preflight requests bypass rate limits
  if (req.method === "OPTIONS") {
    return NextResponse.next();
  }

  // Multi-tier token bucket rate limiting for API routes
  if (req.nextUrl.pathname.startsWith("/api")) {
    const tier = matchRateTier(req.nextUrl.pathname);
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
      const rateLimitResult = await checkTokenBucketRateLimit(tier, identifier);

      if (!rateLimitResult.success) {
        return NextResponse.json(
          {
            error: "Too many requests. Please slow down and try again.",
            retryAfter: rateLimitResult.retryAfter,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(rateLimitResult.retryAfter),
              "X-RateLimit-Limit": String(rateLimitResult.limit),
              "X-RateLimit-Remaining": String(rateLimitResult.remaining),
              "X-RateLimit-Reset": String(rateLimitResult.reset),
            },
          },
        );
      }

      ctx.rateLimitHeaders = {
        "X-RateLimit-Limit": String(rateLimitResult.limit),
        "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        "X-RateLimit-Reset": String(rateLimitResult.reset),
      };
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
