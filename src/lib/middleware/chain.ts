import { NextResponse, type NextRequest } from "next/server";
import type { MiddlewareHandler, MiddlewareContext, MiddlewareNext } from "./types";
import { rateLimitMiddleware } from "./handlers/rateLimitHandler";
import { authMiddleware } from "./handlers/authHandler";
import { securityHeadersMiddleware } from "./handlers/securityHeadersHandler";
import { csrfMiddleware } from "./handlers/csrfHandler";

/**
 * Composes an array of middleware handlers into a single unified pipeline.
 */
export function chainMiddleware(
  handlers: MiddlewareHandler[],
): (req: NextRequest, ctx: MiddlewareContext) => Promise<NextResponse> {
  return async (req: NextRequest, ctx: MiddlewareContext = {}): Promise<NextResponse> => {
    let index = 0;

    const next: MiddlewareNext = async (): Promise<NextResponse> => {
      if (index < handlers.length) {
        const handler = handlers[index++];
        return await handler(req, ctx, next);
      }
      const requestHeaders = ctx.requestHeaders || new Headers(req.headers);
      return NextResponse.next({ request: { headers: requestHeaders } });
    };

    return await next();
  };
}

/**
 * Default standard pipeline handler chain in execution order:
 * 1. Rate Limiting (CORS preflight + token bucket limiting)
 * 2. Authentication & Admin Authorization
 * 3. Security Headers (CSP & Nonce generation)
 * 4. CSRF Protection
 */
export const defaultMiddlewareChain = [
  rateLimitMiddleware,
  authMiddleware,
  securityHeadersMiddleware,
  csrfMiddleware,
];

/**
 * Pre-composed default middleware pipeline orchestrator.
 */
export const runMiddlewarePipeline = chainMiddleware(defaultMiddlewareChain);
