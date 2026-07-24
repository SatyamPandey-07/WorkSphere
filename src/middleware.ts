import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { recordApiLatency } from "./lib/performanceTelemetry";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_PROTECTED_METHODS,
  issueCsrfToken,
  verifyCsrfToken,
} from "./lib/csrf";

function generateCsp(nonce: string): string {
  return [
    `base-uri 'self'`,
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https://cdn.clerk.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src 'self' https://images.unsplash.com https://*.unsplash.com https://res.cloudinary.com data: blob:`,
    `connect-src 'self' https://*.clerk.com https://api.groq.com https://router.project-osrm.org wss://*.partykit.dev`,
    `frame-src 'self' https://*.clerk.com`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
  ].join("; ");
}

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/venues(.*)",
  "/collections/public(.*)",
  "/collections/join(.*)",
  "/api/venues(.*)",
  "/api/map/(.*)",
  "/api/collections/public(.*)",
  "/api/webhook(.*)",
  "/api/auth/csrf-token",
  "/api/auth/resend-otp",
  "/api/auth/verify-otp",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/webauthn/verify",
  "/privacy(.*)",
  "/terms(.*)",
]);

// Routes exempt from CSRF validation even though they're mutating — webhooks are
// authenticated via their own provider signature (Stripe/Clerk/etc.), not a browser
// session, so there's no browser-held CSRF cookie to check against.
const isCsrfExemptRoute = createRouteMatcher([
  "/api/webhook(.*)",
  "/api/auth/csrf-token",
]);

const isAdminRoute = createRouteMatcher(["/admin(.*)", "/api/admin(.*)"]);

/**
 * Ensures a valid signed CSRF cookie exists on safe (GET/HEAD/OPTIONS) requests,
 * and validates the cookie+header pair on mutating requests. This runs independently
 * of locale switching, auth state, or any other client-side transition — the token
 * lifecycle lives entirely in this middleware, so a locale change can never leave a
 * stale/missing cookie behind for a subsequent form submission.
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
    !isCsrfExemptRoute(req as any) &&
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

  // Safe request (GET/HEAD): issue a fresh token cookie if one isn't already set
  // (first visit, OAuth redirect return, expired cookie, or cleared client state).
  if (!existingCookie && !isCsrfExemptRoute(req as any)) {
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

export default function middleware(request: any, event: any) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY =
      "pk_test_Y2xvc2luZy12dWx0dXJlLTEwLmNsZXJrLmFjY291bnRzLmRldiQ";
  }
  const clerkMw = clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }

    if (isAdminRoute(req)) {
      const authObj = await auth();
      const role = (
        authObj.sessionClaims?.metadata?.role as string | undefined
      )?.toLowerCase();
      const isAdminRole =
        role === "admin" || role === "super_admin" || role === "superadmin";

      const adminEmails = (
        process.env.ADMIN_EMAILS ||
        process.env.ADMIN_EMAIL ||
        ""
      )
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      const isEnvAdmin = adminEmails.length > 0 && Boolean(authObj.userId);

      if (!isAdminRole && !isEnvAdmin) {
        if (req.nextUrl.pathname.startsWith("/api")) {
          return NextResponse.json(
            { error: "Forbidden: Admin access required" },
            { status: 403 },
          );
        }
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", req.nextUrl.pathname);
    const nonce = crypto.randomUUID();
    requestHeaders.set("x-csp-nonce", nonce);
    const start = Date.now();
    requestHeaders.set("x-request-start", String(start));

    const region =
      req.headers.get("x-vercel-ip-country") ||
      req.headers.get("x-vercel-edge-region") ||
      "local";

    recordApiLatency(
      req.nextUrl.pathname,
      Math.max(5, Date.now() - start),
      region,
    );

    const res = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    res.headers.set("Content-Security-Policy", generateCsp(nonce));
    return applyCsrfProtection(req, res);
  });

  return clerkMw(request, event);
}

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
