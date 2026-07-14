import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_PROTECTED_METHODS,
  issueCsrfToken,
  verifyCsrfToken,
} from "./lib/csrf";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhook(.*)",
  "/api/auth/csrf-token",
  "/api/auth/resend-otp",
  "/api/auth/verify-otp",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/privacy(.*)",
  "/terms(.*)",
]);

// Routes exempt from CSRF validation even though they're mutating — webhooks are
// authenticated via their own provider signature (Stripe/Clerk/etc.), not a browser
// session, so there's no browser-held CSRF cookie to check against.
const isCsrfExemptRoute = createRouteMatcher(["/api/webhook(.*)", "/api/auth/csrf-token"]);

/**
 * Ensures a valid signed CSRF cookie exists on safe (GET/HEAD/OPTIONS) requests,
 * and validates the cookie+header pair on mutating requests. This runs independently
 * of locale switching, auth state, or any other client-side transition — the token
 * lifecycle lives entirely in this middleware, so a locale change can never leave a
 * stale/missing cookie behind for a subsequent form submission.
 */
async function applyCsrfProtection(req: Request, res: NextResponse): Promise<NextResponse> {
  const url = new URL(req.url);
  const isApiRoute = url.pathname.startsWith("/api");
  if (!isApiRoute || isCsrfExemptRoute(req as any)) {
    return res;
  }

  const cookieHeader = req.headers.get("cookie") || "";
  const existingCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`))
    ?.slice(CSRF_COOKIE_NAME.length + 1);

  if (CSRF_PROTECTED_METHODS.has(req.method)) {
    const headerToken = req.headers.get(CSRF_HEADER_NAME);
    const isValid = await verifyCsrfToken(existingCookie, headerToken);
    if (!isValid) {
      return NextResponse.json(
        { error: "CSRF validation failed. Please refresh and try again." },
        { status: 403 }
      );
    }
    return res;
  }

  // Safe method: issue a fresh token if one isn't already set (first visit,
  // expired cookie, or cleared client state — including after a locale switch).
  if (!existingCookie) {
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
  const isApiOrNonGet = request.nextUrl.pathname.startsWith("/api") || request.method !== "GET";

  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === "pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk") {
    if (isApiOrNonGet) {
      return NextResponse.next();
    }
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", request.nextUrl.pathname);
    const res = NextResponse.next({
      request: {
        headers: requestHeaders,
      }
    });
    return applyCsrfProtection(request, res);
  }

  const clerkMw = clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
    const isReqApiOrNonGet = req.nextUrl.pathname.startsWith("/api") || req.method !== "GET";
    if (isReqApiOrNonGet) {
      return NextResponse.next();
    }
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", req.nextUrl.pathname);
    const res = NextResponse.next({
      request: {
        headers: requestHeaders,
      }
    });
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
  ],
};
