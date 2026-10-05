import { NextResponse, type NextRequest } from "next/server";
import { isPublicRoute, isAdminRoute, isAdminSession } from "../routes";
import type { MiddlewareHandler } from "../types";

export const authMiddleware: MiddlewareHandler = async (req, ctx, next) => {
  if (!isPublicRoute(req)) {
    if (ctx.protect) {
      await ctx.protect();
    }
  }

  if (isAdminRoute(req)) {
    let sessionClaims = ctx.sessionClaims;
    if (sessionClaims === undefined && ctx.auth) {
      const authState = await ctx.auth();
      sessionClaims = authState?.sessionClaims ?? null;
      ctx.sessionClaims = sessionClaims;
      ctx.userId = authState?.userId ?? null;
    }

    if (!isAdminSession(sessionClaims as Record<string, any> | null)) {
      if (req.nextUrl.pathname.startsWith("/api")) {
        return NextResponse.json(
          { error: "Forbidden: Admin access required" },
          { status: 403 },
        );
      }
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return await next();
};
