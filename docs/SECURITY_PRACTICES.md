# Developer Security Practices & API Rate Limit Settings

This document defines the security architecture, rate-limiting design patterns, cache stores, and client-server security protocols implemented in the WorkSphere platform.

---

## 1. API Rate Limiting Design Pattern

WorkSphere implements a distributed rate-limiting system designed to protect APIs against brute-force attacks, denial-of-service (DoS) attempts, and API budget depletion (such as Groq LLM tokens or outbound notification costs).

### Distributed Cache Store (Upstash Redis)

- **Primary Cache**: WorkSphere uses **Upstash Redis** as its distributed cache. It is accessed via an HTTPS-based REST client (`@upstash/redis` and `@upstash/ratelimit`), which eliminates persistent TCP connection pools and makes it lightweight and compatible with serverless/Edge environments.
- **Algorithm**: Enforces a **Sliding Window** rate limit algorithm. This smooths out request bursts over a rolling 1-minute window, rather than abruptly resetting counts at fixed intervals.
- **In-Memory Fallback**: If Upstash environment variables are missing (e.g. during local offline development), the rate limiter automatically falls back to a clean in-memory map store (`memRateLimit`), ensuring that protection remains active.

### Scoping & Identification

To identify callers uniquely across sessions:

1. **Authenticated Requests**: Uses the user's Clerk `userId`.
2. **Anonymous/Public Requests**: Extracts the client's public IP address (via the `x-forwarded-for` or `x-real-ip` headers).
3. **Key Isolation**: Identifiers are prefixed with the route name (e.g., `chat:<userId>` or `forgot-password:<ip>`) to isolate rate limits across different APIs.

---

## 2. HTTP 429 Rate Limit Headers

When a rate limit threshold is exceeded on a protected API endpoint, the application immediately halts execution and responds with `HTTP 429 Too Many Requests`.

### Headers Returned on HTTP 429

The response carries the following standard headers:

| Header Name             |   Type   | Description                                                                       |
| :---------------------- | :------: | :-------------------------------------------------------------------------------- |
| `Retry-After`           | `string` | The number of seconds the client must wait before their rate-limit window resets. |
| `X-RateLimit-Limit`     | `string` | The maximum number of allowed requests in the rolling 1-minute window.            |
| `X-RateLimit-Remaining` | `string` | The remaining request allowance (always `0` when blocked).                        |

### Error Response Payload

Protected APIs return a JSON payload with a user-friendly message and the retry wait time:

```json
{
  "error": "Rate limit exceeded. Please wait before trying again.",
  "retryAfter": 45
}
```

---

## 3. CSRF Protection Security Pattern

WorkSphere protects state-changing endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) using the **Signed Double-Submit Cookie Pattern**.

### Signed Double-Submit Cookie Mechanism

This pattern is implemented using Next.js Middleware and standard Web Crypto APIs (`crypto.subtle`), ensuring Edge-runtime compatibility:

1. **Token Issuance**:
   - The server generates a random 32-byte raw token.
   - It signs this raw token using an HMAC-SHA256 signature with `CSRF_SECRET` (falling back to `CLERK_SECRET_KEY`).
   - The server sets an `httpOnly`, `sameSite: "lax"`, secure cookie named `csrf_token` with the value: `${raw}.${signature}`.
2. **Client Header Reflection**:
   - The client fetches the raw CSRF token via `GET /api/auth/csrf-token` (which is public and excluded from session checks).
   - For mutating requests, the client echoes this raw token back to the server in the `x-csrf-token` request header.
3. **Middleware Verification**:
   - The middleware splits the `csrf_token` cookie value into raw token and signature parts.
   - It re-computes the HMAC-SHA256 signature of the raw part and uses a **constant-time comparison** (`timingSafeEqual`) to verify it matches the cookie signature.
   - Finally, it verifies that the `x-csrf-token` header value is equal to the cookie's raw token part.

---

## 4. Client-Side Auto-Refresh & Retry Interceptor

To prevent user experience crashes when auth sessions expire or idle for too long (such as on the OTP verification screen), the client-side uses a fetch interceptor hook.

- **Hook Location**: `src/hooks/useCsrfToken.ts`
- **Fetch Interceptor**: Monkey-patches `window.fetch` once on initial mount.
- **Auto-Refresh & Retry Flow**:
  1. If a same-origin mutating request receives a `403 Forbidden` response containing a CSRF validation error payload, the interceptor intercepts the response.
  2. It calls `fetch("/api/auth/csrf-token")` to retrieve a fresh CSRF token and cookie.
  3. It automatically updates the headers of the original request and retries it, making the recovery seamless and completely transparent to the user.

---

## 5. Public Endpoint Security Guidelines

### Clerk Public Routes (`isPublicRoute`)

Public endpoints must be configured inside the Next.js middleware file.

- **Rule**: Any route that does not require user authentication (e.g. Landing page, sign-in/sign-up forms, and auth APIs like password resets and OTP verifications) must be explicitly listed in the `isPublicRoute` matcher.
- **Implementation**:
  ```typescript
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
  ```

### Webhook Signature Verification (Svix)

Webhook routes (such as `/api/webhook` which receives events from Clerk) are public and do not use CSRF cookies or session authentication. Instead, they are protected using **cryptographic signatures**.

- **Signature Engine**: Powered by **Svix**.
- **Verification Rule**: Webhook handlers must read the `svix-id`, `svix-timestamp`, and `svix-signature` headers from the request, verifying them against the local `CLERK_WEBHOOK_SIGNING_SECRET` before parsing and trusting the payload.
