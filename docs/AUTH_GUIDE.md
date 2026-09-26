# Clerk Authentication Guide

## 1. Overview

WorkSphere uses [Clerk](https://clerk.com) for user identity, session management, and authentication across the platform.

Authentication enforcement is centralized in Next.js middleware ([src/middleware.ts](file:///c:/Users/kadal/Downloads/worksphere/WorkSphere/src/middleware.ts)). WorkSphere follows a **protect-by-default (deny-by-default)** security model:

- Every route intercepted by the middleware requires an authenticated Clerk user session by default.
- Only routes explicitly defined in the public routes allowlist bypass authentication.
- Requests to protected routes without a valid session are intercepted before executing page components or API route handlers.

---

## 2. Clerk Middleware Configuration

### Middleware Location & Scope

The authentication middleware is configured in:

- **[src/middleware.ts](file:///c:/Users/kadal/Downloads/worksphere/WorkSphere/src/middleware.ts)**

The middleware executes on every incoming request matching the `config.matcher` pattern, before the request reaches Next.js pages, layouts, or route handlers.

### How the Middleware Works

1. **Request Interception**: The Next.js `config.matcher` directs requests through `middleware()`, while ignoring static assets (images, fonts, stylesheets, service workers).
2. **Public Route Evaluation**: `createRouteMatcher` evaluates whether the incoming request URL matches any pattern in `isPublicRoute`.
3. **Session Enforcement (`auth.protect()`)**:
   - If the route **is not public**, the middleware executes `await auth.protect()`.
   - If the request has a valid Clerk session, execution continues.
   - If the request lacks a valid session:
     - **Web Pages**: The user is automatically redirected to `/sign-in` with a `redirect_url` parameter to return them after authentication.
     - **API Routes**: Clerk immediately returns an HTTP `401 Unauthorized` response.
4. **Admin Route Authorization (`isAdminRoute`)**: For routes starting with `/admin` or `/api/admin`, the middleware checks whether the authenticated user has an administrative role (`admin`, `super_admin`, `superadmin` in `sessionClaims.metadata.role`) or matches `ADMIN_EMAILS`. Unauthorized requests receive a `403 Forbidden` (for APIs) or are redirected to `/` (for pages).
5. **Security & Context Headers**: Injects Content Security Policy (CSP) headers with a unique cryptographic nonce, tracks request pathnames via `x-pathname`, and validates CSRF tokens on mutating API calls.

### Middleware Implementation Example

The core Clerk authentication logic in [src/middleware.ts](file:///c:/Users/kadal/Downloads/worksphere/WorkSphere/src/middleware.ts) is structured as follows:

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// 1. Define routes accessible without authentication
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

const isAdminRoute = createRouteMatcher(["/admin(.*)", "/api/admin(.*)"]);

// 2. Protect routes inside the clerkMiddleware handler
export default function middleware(request: any, event: any) {
  const clerkMw = clerkMiddleware(async (auth, req) => {
    // Protect all routes by default unless matched by isPublicRoute
    if (!isPublicRoute(req)) {
      await auth.protect();
    }

    // Role-based access control for administrative paths
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

    // Security headers and CSRF verification follow...
  });

  return clerkMw(request, event);
}

// 3. Matcher configuration controlling which paths run through middleware
export const config = {
  matcher: [
    // Skip static assets, media, fonts, and service workers
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot|css|js|json|txt|xml|webmanifest)|manifest\\.json|sw\\.js|service-worker\\.js|robots\\.txt).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Clerk internal proxy routes
    "/__clerk/:path*",
  ],
};
```

---

## 3. Public vs Protected Routes

WorkSphere distinguishes between **Public** routes (accessible to guests without signing in) and **Protected** routes (requiring an authenticated Clerk session). Admin routes additionally require an administrative role.

### Route Classification Table

| Route/Pattern                 | Access            | Purpose                                                                                        |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `/`                           | Public            | Landing and home page with featured venues and search                                          |
| `/sign-in(.*)`                | Public            | Clerk user authentication sign-in flow                                                         |
| `/sign-up(.*)`                | Public            | Clerk user registration and onboarding flow                                                    |
| `/venues(.*)`                 | Public            | Public venue listings, venue detail views, and navigation                                      |
| `/collections/public(.*)`     | Public            | View shared public venue collections via share tokens                                          |
| `/collections/join(.*)`       | Public            | Landing page to accept collaborative collection invitations                                    |
| `/privacy(.*)`                | Public            | Privacy policy and data handling documentation                                                 |
| `/terms(.*)`                  | Public            | Terms of service and user agreements                                                           |
| `/api/venues(.*)`             | Public            | Venue search, details, reviews, photos, amenities, and noise telemetry                         |
| `/api/map/(.*)`               | Public            | Geospatial map tiles, seating heatmaps, and noise forecast data                                |
| `/api/collections/public(.*)` | Public            | Public collection retrieval, sharing, and upvote endpoints                                     |
| `/api/webhook(.*)`            | Public            | External incoming webhooks (e.g., Clerk user sync, Stripe events; verified by Svix/signatures) |
| `/api/auth/csrf-token`        | Public            | Generates and issues CSRF protection tokens                                                    |
| `/api/auth/resend-otp`        | Public            | Resends one-time verification codes during sign-in/verification                                |
| `/api/auth/verify-otp`        | Public            | Validates one-time verification codes                                                          |
| `/api/auth/forgot-password`   | Public            | Initiates account password recovery requests                                                   |
| `/api/auth/reset-password`    | Public            | Finalizes password reset operations                                                            |
| `/api/auth/webauthn/verify`   | Public            | WebAuthn passkey assertion verification during sign-in                                         |
| `/dashboard`                  | Protected         | Personal user dashboard, recent activity, and shortcuts                                        |
| `/dashboard/webhooks`         | Protected         | Developer webhook management and endpoint monitoring                                           |
| `/saved`                      | Protected         | User's bookmarked and favorite venues                                                          |
| `/collections`                | Protected         | User collections management (private and collaborative)                                        |
| `/collections/[id]`           | Protected         | View and manage a specific private or shared collection                                        |
| `/reserve/[venueId]`          | Protected         | Venue desk and space reservation booking workflow                                              |
| `/workspace`                  | Protected         | Virtual workspace, real-time collaboration, and canvas                                         |
| `/settings`                   | Protected         | User account, preferences, and privacy settings                                                |
| `/user-profile(.*)`           | Protected         | Account profile management via Clerk UserProfile component                                     |
| `/sessions/[slug]`            | Protected         | Live collaborative study and co-working session rooms                                          |
| `/social`                     | Protected         | Community feed, member directory, and study groups                                             |
| `/analytics`                  | Protected         | Personal productivity and work session analytics                                               |
| `/ai`                         | Protected         | AI study assistant and workspace recommendations                                               |
| `/compare`                    | Protected         | Side-by-side venue comparison matrix                                                           |
| `/venue-admin`                | Protected         | Venue owner management and verification portal                                                 |
| `/test-student-zkp`           | Protected         | Zero-knowledge student verification testing portal                                             |
| `/admin(.*)`                  | Protected (Admin) | Admin console (analytics, feedback, system health, partition management)                       |
| `/api/admin(.*)`              | Protected (Admin) | Admin API endpoints (system metrics, telemetry exports, partition management)                  |
| `/api/favorites(.*)`          | Protected         | Manage user favorites, tags, notes, and favorite sync                                          |
| `/api/bookings(.*)`           | Protected         | Create, confirm, export, and manage venue bookings                                             |
| `/api/reservations(.*)`       | Protected         | Desk reservation booking, availability checks, and recurring reservations                      |
| `/api/folders(.*)`            | Protected         | Collaborative folders, team invites, and folder short links                                    |
| `/api/conversations(.*)`      | Protected         | Direct messages, chat channels, and conversation threads                                       |
| `/api/chat`                   | Protected         | AI assistant streaming chat responses                                                          |
| `/api/user(.*)`               | Protected         | User profiles, notification preferences, streaks, badges, and student verification             |
| `/api/social(.*)`             | Protected         | Social study sessions, RSVPs, and presence status broadcasting                                 |
| `/api/push(.*)`               | Protected         | Web Push notification subscription management and keys                                         |
| `/api/receipts(.*)`           | Protected         | Booking receipt downloads and invoice records                                                  |
| `/api/partykit/auth`          | Protected         | PartyKit real-time websocket room authentication tokens                                        |
| `/api/ar(.*)`                 | Protected         | Augmented Reality spatial anchor storage and retrieval                                         |
| `/api/auth/passkey(.*)`       | Protected         | Passkey credential management, registration options, and key rotation                          |
| `/api/auth/sso(.*)`           | Protected         | Enterprise Single Sign-On (SSO) SAML and PKCE metadata                                         |
| `/api/availability/delta`     | Protected         | Real-time seat inventory availability diffs                                                    |
| `/api/cron/reminders`         | Protected         | Background reservation reminder scheduler                                                      |
| `/api/jobs(.*)`               | Protected         | Asynchronous background job status tracking                                                    |
| `/api/location`               | Protected         | User reverse geolocation lookup                                                                |
| `/api/memory(.*)`             | Protected         | AI user context and memory extraction                                                          |
| `/api/menu-translate`         | Protected         | Menu image OCR and translation service                                                         |
| `/api/newsletter`             | Protected         | Newsletter subscription management                                                             |
| `/api/sync`                   | Protected         | Offline IndexedDB data synchronization                                                         |
| `/api/translate`              | Protected         | Text translation service                                                                       |
| `/api/upload`                 | Protected         | File and image uploads to Cloudinary/storage                                                   |
| `/s/[shortCode]`              | Protected         | Short link resolver and redirect handler                                                       |

---

## 4. How to Protect a New Route

Because WorkSphere uses a **protect-by-default** model, protecting a new route requires zero middleware edits. Any new page or API route created in `src/app` is automatically protected unless it is added to `isPublicRoute`.

### Step-by-Step Guide

#### Step 1: Create the Route File

Create your new route under `src/app`:

- For a page: `src/app/my-feature/page.tsx`
- For an API route: `src/app/api/my-feature/route.ts`

#### Step 2: Ensure Route is Omitted from `isPublicRoute`

Leave [src/middleware.ts](file:///c:/Users/kadal/Downloads/worksphere/WorkSphere/src/middleware.ts) unchanged. Because your route is not listed in `isPublicRoute`, the middleware automatically intercepts it and executes `await auth.protect()`.

#### Step 3: Access Authenticated User Context in Your Code

##### In an API Route Handler (`route.ts`):

Call `auth()` from `@clerk/nextjs/server` to access the verified user ID:

```typescript
// src/app/api/my-feature/route.ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId } = await auth();

  // Defensive check (middleware already guarantees authentication)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    message: "Authenticated access granted",
    userId,
  });
}
```

##### In a Server Component (`page.tsx`):

```tsx
// src/app/my-feature/page.tsx
import { auth, currentUser } from "@clerk/nextjs/server";

export default async function MyFeaturePage() {
  const { userId } = await auth();
  const user = await currentUser();

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">My Protected Feature</h1>
      <p>Logged in as: {user?.firstName ?? userId}</p>
    </main>
  );
}
```

##### In a Client Component:

```tsx
"use client";

import { useUser } from "@clerk/nextjs";

export default function MyClientComponent() {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) {
    return <div>Loading user profile...</div>;
  }

  if (!isSignedIn) {
    return <div>Not signed in</div>;
  }

  return <div>Hello, {user.fullName}!</div>;
}
```

#### Step 4: Verify Route Protection

1. **Unauthenticated Access**:
   - **Page Route (`/my-feature`)**: Visiting the URL in an unauthenticated or incognito browser window automatically redirects to:
     ```text
     /sign-in?redirect_url=http%3A%2F%2Flocalhost%3A3000%2Fmy-feature
     ```
   - **API Route (`/api/my-feature`)**: Sending a request without a session cookie returns an HTTP `401 Unauthorized` status:
     ```bash
     curl -i http://localhost:3000/api/my-feature
     # HTTP/1.1 401 Unauthorized
     ```
2. **Authenticated Access**:
   - Signing in via `/sign-in` completes authentication and redirects to `/my-feature`.
   - The route handler receives the verified `userId`.

---

## 5. How to Add a Public Route

When creating a route that should be publicly accessible without authentication (such as a marketing page, terms document, public lookup endpoint, or third-party webhook), you must explicitly register it in the public allowlist.

### Step-by-Step Guide

1. Open **[src/middleware.ts](file:///c:/Users/kadal/Downloads/worksphere/WorkSphere/src/middleware.ts)**.
2. Locate the `isPublicRoute` array defined inside `createRouteMatcher([ ... ])`.
3. Add your route pattern to the array:
   - For an exact page match: `"/about"`
   - For nested subpaths or dynamic segments: `"/about(.*)"` or `"/api/public-catalog(.*)"`

```typescript
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
  // Added public route:
  "/about(.*)",
  "/api/public-catalog(.*)",
]);
```

4. **CSRF Exemption for Mutating Webhook Endpoints**:
   If the new route is a mutating API endpoint (`POST`, `PUT`, `DELETE`, `PATCH`) called by external third-party services that do not hold a browser CSRF cookie (e.g., payment gateways or third-party webhooks), also add it to `isCsrfExemptMatcher` in [src/middleware.ts](file:///c:/Users/kadal/Downloads/worksphere/WorkSphere/src/middleware.ts):

```typescript
const isCsrfExemptMatcher = createRouteMatcher([
  "/api/webhook(.*)",
  "/api/auth/csrf-token",
  "/api/custom-webhook(.*)", // Exempt external webhooks from CSRF checks
]);
```

5. Save the file and verify both unauthenticated and authenticated requests reach the route without redirection.

---

## 6. Testing Authentication

### 1. Verifying Public Routes Work Without Login

To verify a route is public:

- **Browser**: Open a private/incognito window (no active Clerk session cookies) and navigate to the route (e.g., `http://localhost:3000/venues`).
- **Terminal (cURL)**:
  ```bash
  curl -i http://localhost:3000/api/venues
  ```
- **Expected Result**: The endpoint returns HTTP `200 OK` (or appropriate response data) without redirecting to `/sign-in`.

### 2. Verifying Protected Routes Require Authentication

To verify that protection is working:

- **Browser**: In a private/incognito window, navigate to a protected page (e.g., `http://localhost:3000/dashboard` or `http://localhost:3000/saved`).
- **Expected Result**: The browser is immediately redirected to:
  ```text
  http://localhost:3000/sign-in?redirect_url=...
  ```
- **Terminal (cURL)**:
  ```bash
  curl -i http://localhost:3000/api/favorites
  ```
- **Expected Result**: HTTP `401 Unauthorized` is returned.

### 3. Verifying Authenticated User Access

- Sign in through `http://localhost:3000/sign-in` using test credentials.
- Navigate to the protected page (e.g., `/dashboard` or `/saved`).
- **Expected Result**: The page renders successfully and displays user-specific data.
- API requests sent from the browser session include the Clerk session cookie and resolve with HTTP `200 OK`.

### 4. Unit Testing with Mocks (Jest)

When writing Jest tests for components or route handlers that interact with Clerk, mock `@clerk/nextjs` or `@clerk/nextjs/server` as documented in [CONTRIBUTING.md](file:///c:/Users/kadal/Downloads/worksphere/WorkSphere/CONTRIBUTING.md):

```typescript
// Mocking Clerk in API route tests
jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({
    userId: "test-user-id",
    sessionId: "test-session-id",
  }),
  currentUser: jest.fn().mockResolvedValue({
    id: "test-user-id",
    firstName: "Test",
    lastName: "User",
    emailAddresses: [{ emailAddress: "test@example.com" }],
  }),
}));
```

To test unauthenticated scenarios, configure the mock to return `null`:

```typescript
(auth as jest.Mock).mockResolvedValueOnce({ userId: null, sessionId: null });
```

---

## 7. Common Mistakes

### 1. Assuming New Routes Are Public by Default

- **Mistake**: Creating a new route intended for public or guest use and expecting it to work without updating [src/middleware.ts](file:///c:/Users/kadal/Downloads/worksphere/WorkSphere/src/middleware.ts).
- **Result**: WorkSphere's protect-by-default architecture blocks unauthenticated visitors and redirects them to `/sign-in`.
- **Solution**: Explicitly add the path pattern to `isPublicRoute`.

### 2. Accidentally Exposing Private Endpoints with Overly Broad Wildcards

- **Mistake**: Using generic patterns like `"/api(.*)"` or `"/user(.*)"` in `isPublicRoute`.
- **Result**: Completely disables authentication on sensitive API endpoints (e.g., `/api/user/settings`, `/api/bookings`).
- **Solution**: Target specific subpaths (e.g., `"/api/venues(.*)"` instead of `"/api/(.*)"`).

### 3. Protecting External Webhook Endpoints

- **Mistake**: Forgetting to add webhook endpoints to `isPublicRoute`.
- **Result**: Incoming webhook events from Clerk, Stripe, or other providers are rejected with HTTP 401 because external webhook callers do not have a browser session.
- **Solution**: Ensure all webhook paths match `"/api/webhook(.*)"` or are explicitly added to `isPublicRoute`. Webhook security must be handled via signature verification (e.g., Svix), not session cookies.

### 4. Forgetting CSRF Exemptions for Mutating Webhook Routes

- **Mistake**: Adding a webhook endpoint to `isPublicRoute`, but forgetting to add it to `isCsrfExemptMatcher`.
- **Result**: The middleware's CSRF protection blocks incoming `POST` webhook requests with `403 Forbidden: CSRF validation failed`.
- **Solution**: Add webhook routes to both `isPublicRoute` and `isCsrfExemptMatcher`.

### 5. Using Incorrect Route Matcher Pattern Syntax

- **Mistake**: Using standard glob asterisks like `"/venues/*"` or omitting the leading slash (`"venues(.*)"`).
- **Result**: Clerk's `createRouteMatcher` will not match the requested path properly, causing public routes to remain blocked or behaving unpredictably.
- **Solution**: Always include a leading slash and use `(.*)` for subpaths (e.g., `"/venues(.*)"`).

### 6. Misconfiguring `config.matcher` in Middleware

- **Mistake**: Altering the negative lookahead regex in `config.matcher`.
- **Result**: Can cause static assets (images, CSS, web manifest) to trigger authentication checks, degrading performance and breaking public asset loading.
- **Solution**: Keep route inclusion/exclusion logic inside `isPublicRoute` rather than altering the root `config.matcher`.

### 7. Expecting Standard Users to Access Admin Routes

- **Mistake**: Testing protected admin routes (`/admin/*` or `/api/admin/*`) with a standard authenticated user.
- **Result**: Requests are denied with HTTP `403 Forbidden` or redirected to `/` because admin routes enforce role checks beyond basic authentication.
- **Solution**: Set the user's Clerk metadata role to `admin` or add their email to the `ADMIN_EMAILS` environment variable.
