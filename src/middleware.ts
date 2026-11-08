import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  runMiddlewarePipeline,
  isCsrfExemptRoute,
  ROUTE_PERMISSIONS,
  type RoutePermissionRule,
} from "./lib/middleware";
import { generateCryptographicNonce, generateCsp } from "./lib/security/csp";
import { matchRateTier, getClientIp } from "./lib/tokenBucketRateLimit";

/**
 * WorkSphere Orchestrated Edge Middleware Pipeline
 * Chains Rate Limiting, Authentication & Authorization, Security Headers (CSP & Nonce), and CSRF Protection.
 */
export default clerkMiddleware(async (auth, req) => {
  return await runMiddlewarePipeline(req, {
    auth,
    protect: auth.protect,
  });
});

export {
  generateCryptographicNonce,
  generateCsp,
  isCsrfExemptRoute,
  matchRateTier,
  getClientIp,
  ROUTE_PERMISSIONS,
  type RoutePermissionRule,
};

export const config = {
  matcher: [
    // Skip static assets (including manifest/service worker) so they aren't gated by auth
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot|css|js|json|txt|xml|webmanifest)|manifest\\.json|sw\\.js|service-worker\\.js|robots\\.txt).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Clerk internal proxy routes
    "/__clerk/:path*",
  ],
};
