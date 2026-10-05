import type { NextRequest, NextResponse } from "next/server";

export interface MiddlewareContext {
  auth?: () => Promise<{ userId: string | null; sessionClaims: Record<string, any> | null; [key: string]: any }>;
  protect?: () => Promise<any>;
  userId?: string | null;
  sessionClaims?: Record<string, any> | null;
  rateLimitHeaders?: Record<string, string> | null;
  nonce?: string;
  csp?: string;
  requestHeaders?: Headers;
  [key: string]: any;
}

export type MiddlewareNext = () => Promise<NextResponse>;

export type MiddlewareHandler = (
  req: NextRequest,
  ctx: MiddlewareContext,
  next: MiddlewareNext,
) => Promise<NextResponse>;
