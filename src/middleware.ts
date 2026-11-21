import { NextRequest, NextResponse } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import {
  buildSignInRedirectUrl,
  isAuthRoute,
  sanitizeRedirectUrl,
} from '@/lib/auth/redirectSanitizer';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)',
  '/offline',
  '/api/health(.*)',
  '/api/webhooks/(.*)',
  '/api/venues/check-in/iot',
  '/api/venues/search(.*)',
]);

const isProtectedWorkspaceRoute = createRouteMatcher([
  '/workspace(.*)',
  '/dashboard(.*)',
  '/admin(.*)',
  '/user-profile(.*)',
  '/analytics/nomad-tax(.*)',
]);

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { pathname, search } = req.nextUrl;

  // 1. If the user is already on `/sign-in` or `/sign-up` (for example, when third-party
  //    or session cookies are blocked in incognito/Safari), NEVER redirect to `/sign-in` again.
  //    Only normalize the `redirect_url` param if it is recursively nested or unsafe.
  if (isAuthRoute(pathname)) {
    const rawRedirect = req.nextUrl.searchParams.get('redirect_url');
    if (rawRedirect) {
      const sanitized = sanitizeRedirectUrl(rawRedirect);
      if (sanitized !== rawRedirect) {
        const cleanedUrl = new URL(pathname, req.nextUrl.origin);
        req.nextUrl.searchParams.forEach((value, key) => {
          if (key !== 'redirect_url') {
            cleanedUrl.searchParams.set(key, value);
          }
        });
        cleanedUrl.searchParams.set('redirect_url', sanitized);
        return NextResponse.redirect(cleanedUrl);
      }
    }
    return NextResponse.next();
  }

  // 2. Allow public routes through without auth enforcement
  if (isPublicRoute(req) && !isProtectedWorkspaceRoute(req)) {
    return NextResponse.next();
  }

  // 3. Enforce authentication on protected routes with loop-safe single-level `redirect_url`
  const session = await auth();
  if (!session.userId && (isProtectedWorkspaceRoute(req) || !isPublicRoute(req))) {
    const signInUrl = buildSignInRedirectUrl(req.nextUrl, '/sign-in');

    // Guard against no-op self-redirect loops
    const currentFull = `${pathname}${search}`;
    const targetFull = `${signInUrl.pathname}${signInUrl.search}`;
    if (currentFull === targetFull) {
      return NextResponse.next();
    }

    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|wasm)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};