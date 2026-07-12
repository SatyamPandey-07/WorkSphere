# Clerk Authentication & JWT Validation

This document explains how WorkSphere authenticates requests using [Clerk](https://clerk.com), how `src/middleware.ts` gates access to routes, and how server-side code verifies who's making a request. It reflects the current implementation in the repo (`src/middleware.ts`, `src/lib/auth.ts`, and the API routes under `src/app/api`).

## 1. JWT Verification Flow

Clerk issues a short-lived **session JWT** to the browser after sign-in and stores it in a `__session` cookie (plus a client-side copy Clerk's SDK manages for you). Every request from the browser to a WorkSphere page or API route automatically carries that cookie — there's no manual token attachment in `fetch` calls.

```
┌────────────┐        1. Sign in via Clerk        ┌────────────┐
│   Browser  │ ───────────────────────────────►   │   Clerk    │
│ (Next.js   │ ◄─────────────────────────────────  │  (hosted)  │
│  client)   │      2. Session JWT in cookie       └────────────┘
└─────┬──────┘
      │ 3. Request to /api/* or a page
      │    (cookie sent automatically)
      ▼
┌───────────────────────┐
│   src/middleware.ts    │  4. clerkMiddleware() intercepts
│  (Next.js Middleware)  │     the request before it reaches
└─────────┬──────────────┘     any route handler
          │ 5. Verifies JWT signature + expiry
          │    against Clerk's public keys
          ▼
┌───────────────────────┐
│   Route Handler /      │  6. auth() / currentUser() reads
│   Page Component       │     the already-verified session
└───────────────────────┘     from request context
```

Key points:

- **The JWT itself never has to be decoded by application code.** Clerk's middleware verifies the signature (against Clerk's rotating public keys) and expiry as part of `clerkMiddleware()`, before your route handler runs.
- Route handlers and Server Components call `auth()` (or `currentUser()`) from `@clerk/nextjs/server`, which reads the verified session that middleware already attached to the request — not the raw cookie.
- If verification fails (missing, expired, or tampered token), `auth()` simply returns `userId: null`. Whether that turns into a redirect or a 401 depends on the route (see below).

## 2. Middleware Routing (`src/middleware.ts`)

`src/middleware.ts` runs on **every matched request** (see the `matcher` config at the bottom of the file) before it reaches a page or API route. It does three things:

```ts
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
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  // Local/dev fallback when Clerk isn't configured
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === "pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk") {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  })(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot|css|js|json|txt|xml|webmanifest)|manifest\\.json|sw\\.js|service-worker\\.js|robots\\.txt).*)",
    "/(api|trpc)(.*)",
  ],
};
```

**Step by step:**

1. **`createRouteMatcher`** defines an allowlist of public routes — the landing page, sign-in/sign-up pages, the Clerk webhook endpoint, and static legal pages. Everything not on this list is treated as protected.
2. **The dev-key escape hatch**: if the app is running with Clerk's placeholder publishable key (i.e., Clerk hasn't been configured yet), middleware skips auth entirely and just forwards the request. This lets contributors run the app locally without setting up a Clerk project first.
3. **`clerkMiddleware(...)`** wraps the request. Inside the callback, `auth.protect()` is called for any route that *isn't* public. `auth.protect()` is what actually triggers JWT verification — if the session is missing or invalid, it short-circuits the request (redirecting to sign-in for pages, or returning a 401 for API routes) before your handler code ever runs.
4. **The `matcher` export** controls which requests Next.js even routes through this middleware. It deliberately excludes static assets (images, fonts, the service worker, `manifest.json`) so those aren't needlessly gated behind auth, but explicitly *includes* everything under `/api` and `/trpc`.
5. A custom `x-pathname` header is attached to the forwarded request, which app code uses to know the current route without re-parsing the URL.

**Net effect:** by the time a request reaches an API route handler or Server Component, one of two things is already true — it hit a public route with no auth check, or `auth.protect()` already confirmed there's a valid, verified session.

## 3. Decoding Secrets: How Routes Verify Sessions

WorkSphere never manually decodes or verifies the Clerk JWT signature in application code — that's handled entirely by the Clerk SDK using the keys below. There are two distinct verification paths in the app:

### a) Session verification for signed-in users

Every protected API route (favorites, venue ratings, conversations, etc.) calls `auth()` from `@clerk/nextjs/server`, which reads the session already validated by `clerkMiddleware()`:

```ts
import { auth } from "@clerk/nextjs/server";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // proceed knowing userId is a verified Clerk user id
}
```

This relies on two env vars configured in `.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...   # public, safe for the browser
CLERK_SECRET_KEY=sk_test_...                    # server-only, used to talk to Clerk's API
```

The secret key is used by the Clerk SDK server-side to fetch signing keys and validate the JWT's signature and claims (issuer, expiry, audience). Application code never touches the raw token or the secret directly — `auth()` and `currentUser()` are the only interfaces.

For routes that also need full profile data (name, email, avatar) rather than just the id, `src/lib/auth.ts` exposes a helper that calls `currentUser()` and lazily syncs the user into the local database if a webhook hasn't created it yet:

```ts
import { currentUser } from "@clerk/nextjs/server";

export async function ensureUserExists(userId: string) {
  const existingUser = await prisma.user.findUnique({ where: { id: userId } });
  if (existingUser) return existingUser;

  const user = await currentUser();
  if (!user || user.id !== userId) return null;

  return prisma.user.create({
    data: {
      id: user.id,
      email: user.emailAddresses[0]?.emailAddress,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
    },
  });
}
```

### b) Signature verification for the Clerk webhook

The one route explicitly excluded from `auth.protect()` — `/api/webhook` — receives events directly from Clerk's servers, not from a signed-in browser. It has no session cookie to check. Instead it verifies a **Svix HMAC signature** using a separate secret (`WEBHOOK_SECRET`, from the Clerk Dashboard's webhook configuration):

```ts
import { Webhook } from "svix";
import { headers } from "next/headers";

const wh = new Webhook(process.env.WEBHOOK_SECRET!);

const svix_id = headerPayload.get("svix-id");
const svix_timestamp = headerPayload.get("svix-timestamp");
const svix_signature = headerPayload.get("svix-signature");

const evt = wh.verify(body, {
  "svix-id": svix_id,
  "svix-timestamp": svix_timestamp,
  "svix-signature": svix_signature,
}) as WebhookEvent;
```

If verification fails, the route returns a `400` and does not process the payload. On a verified `user.created` event, it creates the corresponding row in the local `User` table — this is the primary path that keeps Postgres in sync with Clerk; `ensureUserExists` above is only a fallback for when this webhook hasn't fired yet.

## Summary

| Layer | Mechanism | Secret used |
|---|---|---|
| Browser → Middleware | Session JWT in cookie, verified by `clerkMiddleware()` | `CLERK_SECRET_KEY` (server-side, via Clerk SDK) |
| Middleware → Route | `auth.protect()` gates non-public routes before handlers run | — |
| Route → Session data | `auth()` / `currentUser()` read the already-verified session | `CLERK_SECRET_KEY` |
| Clerk → Webhook route | Svix HMAC signature on the raw payload, unrelated to session JWTs | `WEBHOOK_SECRET` |

Related env vars (see `README.md` → Environment Variables): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, and `WEBHOOK_SECRET`.
