# Edge Middleware Routing & Authentication Bypass Threat Model

This document outlines the architecture, execution pipeline, route classification logic, and security threat model for WorkSphere's edge middleware layer (`src/middleware.ts` and `src/lib/middleware/*`).

---

## 1. Architectural Overview

WorkSphere employs a modular, chained middleware pipeline executed in the Next.js Edge Runtime prior to reaching route handlers or React Server Components.

```
Incoming Request
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Rate Limiting Middleware (rateLimitHandler.ts)       │
│    - CORS preflight exemption (OPTIONS)                 │
│    - Multi-tier Token Bucket evaluation per IP/User     │
│    - Rejects with HTTP 429 & Retry-After headers        │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Authentication & AuthZ Middleware (authHandler.ts)   │
│    - Route classification matching (Public vs Protected)│
│    - Clerk session verification (ctx.protect())         │
│    - Admin role & email whitelist enforcement           │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Security Headers Middleware (securityHeaders.ts)     │
│    - Cryptographic Nonce generation                     │
│    - Strict Content-Security-Policy (CSP) computation   │
│    - Downstream header injection (x-csp-nonce)          │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ 4. CSRF Protection Middleware (csrfHandler.ts)          │
│    - Exemption check (webhooks, cron, safe methods)     │
│    - Double-submit HMAC signed cookie/header validation │
│    - Automatic token issuance on safe requests          │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
              Downstream Handler / Page Route
```

---

## 2. Route Classification Logic & Manifest

Route authorization is defined declaratively in `src/lib/middleware/routes.ts` via the `ROUTE_PERMISSIONS` manifest:

### A. Public Routes & APIs (`isPublic: true`)
Public routes do not require an active user session:
- **Pages**: Landing page (`/`), authentication pages (`/sign-in(.*)`, `/sign-up(.*)`), public venue browsing (`/venues(.*)`), public collections (`/collections/public(.*)`, `/collections/join(.*)`), vanity URLs (`/s/(.*)`), and legal terms (`/privacy(.*)`, `/terms(.*)`).
- **Public APIs**: Discovery and directory endpoints (`/api/venues(.*)`, `/api/map/(.*)`, `/api/collections/public(.*)`).
- **Authentication Handlers**: CSRF token issuance (`/api/auth/csrf-token`), SAML ACS (`/api/auth/sso/saml`), passkey visitor verification (`/api/auth/passkey/authenticate/(.*)`), and session termination (`/api/auth/session(.*)`).

### B. Webhook & Background Worker Endpoints (`isCsrfExempt: true`)
Endpoints designed for machine-to-machine integrations:
- **Endpoints**: `/api/webhook(.*)`, `/api/webhooks/worker`, `/api/cron/(.*)`.
- **Authentication**: Webhooks are verified using cryptographic signatures (e.g. Svix HMAC headers `svix-id`, `svix-timestamp`, `svix-signature` or payment gateway webhook secrets). Cron jobs verify bearer `CRON_SECRET` authorization tokens.
- **CSRF Behavior**: Exempt from browser-bound CSRF token verification because they do not rely on ambient browser cookies.

### C. Authenticated User Routes (Default)
Any route not explicitly declared in `isPublic` requires a valid Clerk session:
- **Pages**: User dashboard (`/dashboard(.*)`), reservation management (`/bookings(.*)`), and account settings (`/settings(.*)`).
- **APIs**: User profile data, booking mutations, payment methods, and private note syncing.
- **Enforcement**: Middleware executes `ctx.protect()`. Unauthenticated API requests receive `401 Unauthorized`; unauthenticated page navigations are redirected to `/sign-in` with a `redirect_url` parameter.

### D. Admin Only Routes (`isAdminOnly: true`)
Restricted strictly to administrators:
- **Patterns**: `/admin(.*)` and `/api/admin(.*)`.
- **Validation**:
  1. Inspects Clerk session claims for `metadata.role` equaling `"admin"`, `"super_admin"`, or `"superadmin"`.
  2. Fallback check verifies the user's primary email against the server-configured `ADMIN_EMAILS` environment whitelist.
- **Rejection**: API routes return `403 Forbidden: Admin access required`. Web pages redirect unauthorized users to `/`.

---

## 3. Threat Model Analysis & Security Mitigations

| Threat ID | Threat Vector | Risk / Impact | Mitigation Applied in Middleware |
| :--- | :--- | :--- | :--- |
| **TM-01** | **Path Traversal & Dot-Dot Normalization** | Authentication bypass via relative segments (e.g. `/api/venues/../admin/users` or encoded `/api/public/%2e%2e/admin`) | Edge Runtime standardizes `req.nextUrl.pathname` and `new URL(req.url).pathname` to canonical form before executing regex matchers. |
| **TM-02** | **Static Asset Extension Spoofing** | Attacker appends a static extension to an API path (e.g. `/api/admin/dump.png`) to bypass authentication matcher exclusions | Next.js matcher configuration explicitly isolates `/(api\|trpc)(.*)` ensuring API routes execute the full middleware pipeline regardless of extension. |
| **TM-03** | **IP Rate Limit Header Forgery** | Attacker rotates forged `X-Forwarded-For` or `Client-IP` headers to bypass token bucket rate limits | `getClientIp` extracts the trusted peer address provided by the platform gateway. For authenticated users, rate limit keys bind directly to `tier:userId`. |
| **TM-04** | **Cross-Site Request Forgery (CSRF)** | Malicious third-party sites trigger state-changing requests using ambient cookies | `csrfMiddleware` enforces signed HMAC Double-Submit cookies (`__Host-csrf`) on all mutating HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`). |
| **TM-05** | **Downstream Context Header Injection** | Attacker sends malicious `x-pathname` or `x-csp-nonce` headers to manipulate CSP or SSR rendering | `securityHeadersMiddleware` generates cryptographically secure nonces (`crypto.getRandomValues`) and unconditionally overwrites header values. |
| **TM-06** | **Webhook Replay & Payload Tampering** | Replaying captured webhook payloads to trigger duplicate actions | Webhook handlers verify timestamp thresholds (Svix 5-minute tolerance) and HMAC-SHA256 signatures prior to processing. |

---

## 4. Middleware Execution Order & Precedence

To maintain defense-in-depth, middleware handlers execute in strict sequential order:

1. **Rate Limiting**: Throttles volumetric attacks and abuse before expensive cryptographic operations or database checks occur.
2. **Authentication**: Identifies the actor and blocks unauthorized route access.
3. **Security Headers**: Generates request-scoped nonces and sets strict Content-Security-Policy headers.
4. **CSRF Verification**: Protects against cross-origin ambient credential exploitation on mutating endpoints.

---

## 5. Maintenance & Route Extension Guidelines

When introducing new routes to WorkSphere:
- All new API routes default to **Authenticated** unless explicitly added to `ROUTE_PERMISSIONS` with `isPublic: true`.
- Never disable CSRF for browser-invoked mutating endpoints.
- Admin endpoints must follow the `/api/admin/*` or `/admin/*` path convention to ensure automatic policy enforcement.
