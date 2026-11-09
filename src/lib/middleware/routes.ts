import { createRouteMatcher } from "@clerk/nextjs/server";
import { CSRF_PROTECTED_METHODS, isCsrfProtectedMethod } from "@/lib/csrf";

export interface RoutePermissionRule {
  pattern: string;
  isPublic?: boolean;
  isCsrfExempt?: boolean;
  isAdminOnly?: boolean;
  rateLimitTier?: "strict" | "auth" | "general" | "public" | "relaxed";
  description?: string;
}

/**
 * Centralized Route Permission & Exemption Manifest
 * Declaratively defines authentication requirements, CSRF check exemptions, and admin permissions.
 */
export const ROUTE_PERMISSIONS: RoutePermissionRule[] = [
  // Public Landing & Static Pages
  { pattern: "/", isPublic: true, description: "Landing page" },
  { pattern: "/sign-in(.*)", isPublic: true, description: "Sign in page" },
  { pattern: "/sign-up(.*)", isPublic: true, description: "Sign up page" },
  { pattern: "/venues(.*)", isPublic: true, description: "Public venue browsing" },
  { pattern: "/collections/public(.*)", isPublic: true, description: "Public collections view" },
  { pattern: "/collections/join(.*)", isPublic: true, description: "Collection invitation link" },
  { pattern: "/s/(.*)", isPublic: true, description: "Shortened URLs" },
  { pattern: "/offline", isPublic: true, description: "Offline fallback page" },
  { pattern: "/privacy(.*)", isPublic: true, description: "Privacy policy" },
  { pattern: "/terms(.*)", isPublic: true, description: "Terms of service" },

  // Public APIs
  { pattern: "/api/venues(.*)", isPublic: true, description: "Venues search & details API" },
  { pattern: "/api/map/(.*)", isPublic: true, description: "Map tile & routing API" },
  { pattern: "/api/collections/public(.*)", isPublic: true, description: "Public collection data API" },

  // Webhooks & Scheduled Workers (Signed/Secret authenticated, CSRF exempt)
  { pattern: "/api/webhook(.*)", isPublic: true, isCsrfExempt: true, description: "Clerk Svix webhook & payment webhooks" },
  { pattern: "/api/webhooks/worker", isPublic: true, isCsrfExempt: true, description: "Queue worker endpoint" },
  { pattern: "/api/cron/(.*)", isPublic: true, isCsrfExempt: true, description: "Scheduled cron jobs" },

  // Auth, CSRF & SSO Endpoints
  { pattern: "/api/auth/csrf-token", isPublic: true, isCsrfExempt: true, description: "CSRF token issuance endpoint" },
  { pattern: "/api/auth/sso/saml", isPublic: true, isCsrfExempt: true, description: "SAML ACS endpoint" },
  { pattern: "/api/auth/passkey/authenticate/(.*)", isPublic: true, description: "Passkey visitor authentication" },
  { pattern: "/api/auth/session(.*)", isPublic: true, isCsrfExempt: true, description: "Session refresh & logout endpoints" },

  // Realtime & Streaming Endpoints
  { pattern: "/api/venues/updates", isCsrfExempt: true, description: "Venue live updates SSE" },

  // Admin Routes
  { pattern: "/admin(.*)", isAdminOnly: true, description: "Admin dashboard pages" },
  { pattern: "/api/admin(.*)", isAdminOnly: true, description: "Admin management APIs" },
];

/**
 * Public routes accessible without active Clerk authentication.
 */
export const isPublicRoute = createRouteMatcher(
  ROUTE_PERMISSIONS.filter((r) => r.isPublic).map((r) => r.pattern)
);

/**
 * Routes exempt from CSRF validation even though they're mutating:
 * - webhooks and cron are authenticated by their own signature/secret, not a browser session;
 * - the SSE venue-updates stream must not have cookies rewritten mid-stream.
 */
export const isCsrfExemptMatcher = createRouteMatcher(
  ROUTE_PERMISSIONS.filter((r) => r.isCsrfExempt).map((r) => r.pattern)
);

/**
 * Admin routes requiring admin or super_admin permissions.
 */
export const isAdminRoute = createRouteMatcher(
  ROUTE_PERMISSIONS.filter((r) => r.isAdminOnly).map((r) => r.pattern)
);

/**
 * Checks whether a request matches CSRF exemptions or is a static asset.
 */
export function isCsrfExemptRoute(req: Request): boolean {
  const path = new URL(req.url).pathname;
  if (path.startsWith("/api") && isCsrfProtectedMethod(req.method)) {
    return isCsrfExemptMatcher(req as any);
  }
  const staticAssetRegex = /\.(png|jpg|jpeg|gif|svg|mp3|wav|ico|css|js)$/i;
  return isCsrfExemptMatcher(req as any) || staticAssetRegex.test(path);
}

/**
 * Validates whether the authenticated session claims or configured admin emails grant admin status.
 */
export function isAdminSession(sessionClaims: Record<string, any> | null): boolean {
  const role = (
    sessionClaims?.metadata?.role as string | undefined
  )?.toLowerCase();
  if (role === "admin" || role === "super_admin" || role === "superadmin") {
    return true;
  }

  const adminEmails = (
    process.env.ADMIN_EMAILS ||
    process.env.ADMIN_EMAIL ||
    ""
  )
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const userEmail = (
    (sessionClaims?.email as string | undefined) ?? ""
  ).toLowerCase();

  return (
    adminEmails.length > 0 &&
    userEmail.length > 0 &&
    adminEmails.includes(userEmail)
  );
}

/**
 * Middleware matcher pattern configuration for Next.js.
 */
export const middlewareMatcher = [
  // Skip static assets (including manifest/service worker) so they aren't gated by auth
  "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot|css|js|json|txt|xml|webmanifest)|manifest\\.json|sw\\.js|service-worker\\.js|robots\\.txt).*)",
  // Always run for API routes
  "/(api|trpc)(.*)",
  // Clerk internal proxy routes
  "/__clerk/:path*",
];
