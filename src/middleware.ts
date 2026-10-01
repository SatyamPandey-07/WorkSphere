import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_PROTECTED_METHODS,
  issueCsrfToken,
  verifyCsrfToken,
} from "./lib/csrf";

function getClerkFrontendApiHost(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const match = key?.match(/^pk_(?:test|live)_(.+)$/);
  if (!match) return null;
  try {
    return atob(match[1]).replace(/\$$/, "");
  } catch {
    return null;
  }
}

function getPartyKitOrigins(): string[] {
  const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST;
  const origins = ["https://*.partykit.dev", "wss://*.partykit.dev"];
  if (host) {
    const bare = host.replace(/^(https?|wss?):\/\//, "").replace(/\/.*$/, "");
    origins.push(`https://${bare}`, `wss://${bare}`);
    if (process.env.NODE_ENV === "development") {
      origins.push(`http://${bare}`, `ws://${bare}`);
    }
  }
  return origins;
}

export function generateCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const clerkFrontendApi = getClerkFrontendApiHost();
  const clerkHosts = [
    "https://*.clerk.com",
    "https://*.clerk.accounts.dev",
    ...(clerkFrontendApi ? [`https://${clerkFrontendApi}`] : []),
  ].join(" ");

  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'self'`,
    `form-action 'self'`,
    `script-src 'self' 'nonce-${nonce}' ${clerkHosts} https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    // Map tiles, avatars, venue photos and user uploads come from many hosts.
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: data:`,
    `connect-src 'self' ${clerkHosts} https://clerk-telemetry.com https://router.project-osrm.org https://nominatim.openstreetmap.org ${getPartyKitOrigins().join(" ")}`,
    `frame-src 'self' ${clerkHosts} https://challenges.cloudflare.com`,
    `worker-src 'self' blob:`,
  ].join("; ");
}

const isPublicRoute = createRouteMatcher([
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
  // Passkey sign-in is used by signed-out visitors.
  "/api/auth/passkey/authenticate/(.*)",
]);

// Routes exempt from CSRF validation even though they're mutating:
// - webhooks and cron are authenticated by their own signature/secret, not a browser session;
// - the SSE venue-updates stream must not have cookies rewritten mid-stream.
const isCsrfExemptMatcher = createRouteMatcher([
  "/api/webhook",
  "/api/webhooks/worker",
  "/api/cron/(.*)",
  "/api/auth/csrf-token",
  "/api/venues/updates",
]);

export function isCsrfExemptRoute(req: Request): boolean {
  const path = new URL(req.url).pathname;
  const staticAssetRegex = /\.(png|jpg|jpeg|gif|svg|mp3|wav|ico|css|js)$/i;
  return isCsrfExemptMatcher(req as any) || staticAssetRegex.test(path);
}

const isAdminRoute = createRouteMatcher(["/admin(.*)", "/api/admin(.*)"]);

/**
 * Ensures a valid signed CSRF cookie exists on safe (GET/HEAD/OPTIONS) requests,
 * and validates the cookie+header pair on mutating requests.
 */
async function applyCsrfProtection(
  req: Request,
  res: NextResponse,
): Promise<NextResponse> {
  const url = new URL(req.url);
  const isApiRoute = url.pathname.startsWith("/api");

  const cookieHeader = req.headers.get("cookie") || "";
  const existingCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`))
    ?.slice(CSRF_COOKIE_NAME.length + 1);

  if (
    isApiRoute &&
    !isCsrfExemptRoute(req) &&
    CSRF_PROTECTED_METHODS.has(req.method)
  ) {
    const headerToken = req.headers.get(CSRF_HEADER_NAME);
    const isValid = await verifyCsrfToken(existingCookie, headerToken);
    if (!isValid) {
      return NextResponse.json(
        { error: "CSRF validation failed. Please refresh and try again." },
        { status: 403 },
      );
    }
    return res;
  }

  // Safe request: issue a token cookie if one isn't already set.
  if (!existingCookie && !isCsrfExemptRoute(req)) {
    const { cookieValue } = await issueCsrfToken();
    res.cookies.set(CSRF_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  return res;
}

function isAdminSession(sessionClaims: Record<string, any> | null): boolean {
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
  // `email` is only present when the Clerk session token is customised to
  // include it; pages and API routes re-check with getAdminUser() regardless.
  const userEmail = (
    (sessionClaims?.email as string | undefined) ?? ""
  ).toLowerCase();
  return (
    adminEmails.length > 0 &&
    userEmail.length > 0 &&
    adminEmails.includes(userEmail)
  );
}

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  if (isAdminRoute(req)) {
    const { sessionClaims } = await auth();
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

  const nonce = btoa(crypto.randomUUID());
  const csp = generateCsp(nonce);

  // Next.js reads the nonce from the request's CSP header and applies it to
  // its own inline bootstrap scripts; the layout reads x-csp-nonce.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  requestHeaders.set("x-csp-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return applyCsrfProtection(req, res);
});

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
