import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhook(.*)",
  "/privacy(.*)",
  "/terms(.*)",
]);

export default function middleware(request: any, event: any) {
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === "pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk") {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", request.nextUrl.pathname);
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      }
    });
  }

  const clerkMw = clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", req.nextUrl.pathname);
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      }
    });
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
