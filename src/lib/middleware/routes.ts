import { createRouteMatcher } from "@clerk/nextjs/server";
import { CSRF_PROTECTED_METHODS } from "@/lib/csrf";

/**
 * Public routes accessible without active Clerk authentication.
 */
export const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/venues(.*)",
  "/collections/public(.*)",
  "/collections/join(.*)",
  "/s/(.*)",
  "/offline",
  "/privacy(.*)",
  "/terms(.*)",
  "/api/venues(.*)",
  "/api/map/(.*)",
  "/api/collections/public(.*)",
  // Clerk user-sync webhook (Svix-signed) and the queue worker (secret-authenticated).
  "/api/webhook",
  "/api/webhooks/worker",
  "/api/cron/(.*)",
  "/api/auth/csrf-token",
  // SAML ACS endpoint receives POSTs directly from the identity provider.
  "/api/auth/sso/saml",
  // Passkey sign-in is used by signed-out visitors.
  "/api/auth/passkey/authenticate/(.*)",
  // Session refresh and logout endpoints
  "/api/auth/session(.*)",
]);

/**
 * Routes exempt from CSRF validation even though they're mutating:
 * - webhooks and cron are authenticated by their own signature/secret, not a browser session;
 * - the SSE venue-updates stream must not have cookies rewritten mid-stream.
 */
export const isCsrfExemptMatcher = createRouteMatcher([
  "/api/webhook",
  "/api/webhooks/worker",
  "/api/cron/(.*)",
  "/api/auth/csrf-token",
  // SAML responses are authenticated by the IdP XML signature.
  "/api/auth/sso/saml",
  "/api/venues/updates",
  "/api/auth/session(.*)",
]);

/**
 * Checks whether a request matches CSRF exemptions or is a static asset.
 */
export function isCsrfExemptRoute(req: Request): boolean {
  const path = new URL(req.url).pathname;
  if (path.startsWith("/api") && CSRF_PROTECTED_METHODS.has(req.method)) {
    return isCsrfExemptMatcher(req as any);
  }
  const staticAssetRegex = /\.(png|jpg|jpeg|gif|svg|mp3|wav|ico|css|js)$/i;
  return isCsrfExemptMatcher(req as any) || staticAssetRegex.test(path);
}

/**
 * Admin routes requiring admin or super_admin permissions.
 */
export const isAdminRoute = createRouteMatcher(["/admin(.*)", "/api/admin(.*)"]);

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
