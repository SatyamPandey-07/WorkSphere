# Security Audit Policy

## Purpose

The purpose of this document is to establish the official security architecture baseline, validate request validation flows, verify protection controls against Common Vulnerabilities and Exposures (CVEs) such as SSRF and CSRF, and describe safe development guidelines for contributors. This policy ensures that security invariants are maintained across all modifications to the WorkSphere codebase.

---

## Security Architecture

WorkSphere enforces a multi-layered security model where security controls are implemented at the server boundaries. Client-side state representation or page redirection serves user-experience goals and does not constitute a trust boundary.

### 1. Authentication
All protected user requests are authenticated using **Clerk** identity integration. On the server side, handlers verify sessions via Clerk SDK helpers (`auth()` and `currentUser()`). For offline, sandbox, or testing environments, standard mock fallbacks can be configured via environment variables.

### 2. Authorization
Privileged actions require role-based access control (RBAC). The application inspects user metadata on Clerk sessions to verify administrator privileges. Data ownership checks verify that users can only mutate or query data associated with their own `userId`.

### 3. Trust Boundaries
- **Unverified Input Boundary**: The initial request handler parsing HTTP request payloads, headers, query parameters, and route parameters.
- **Identity Provider Boundary**: Clerk user management hooks and webhook event sources.
- **Database Boundary**: Prisma ORM, which isolates application code from raw SQL and automatically parameterizes queries.

### 4. Request Lifecycle
```text
Client Request
      │
      ▼
Next.js Middleware ──(CSRF Check & Public/Private Route Match)──┐
      │                                                        │
      ▼ (If Private)                                           │
Clerk Authentication Guard ────────────────────────────┐       │
      │                                                │       │
      ▼                                                ▼       ▼
API Route Handler ──(Zod Input Validation)──► Business Logic / Database (Prisma)
```

### 5. Security Middleware
Next.js Middleware ([middleware.ts](file:///c:/Codes/WorkSphere/src/middleware.ts)) acts as the primary gatekeeper, executing CSRF validation and Clerk route protection before request execution reaches the API handlers.

---

## Authentication Flow

WorkSphere delegates authentication to Clerk:
1. The client completes sign-in or registration through Clerk interfaces.
2. Clerk maintains session state via secure, HTTP-only, SameSite cookies.
3. API route handlers and server components extract session tokens using Clerk helpers `auth()` and `currentUser()`.
4. If authentication fails, requests return `401 Unauthorized` (or redirect to `/` for page views).
5. For user persistence, a Clerk webhook synchronizes accounts to the local PostgreSQL database. If webhook delivery is delayed, the local database synchronization helper `ensureUserExists()` ([auth.ts](file:///c:/Codes/WorkSphere/src/lib/auth.ts)) runs on demand as a fallback.

---

## Authorization Flow

Authorization follows a strict server-side evaluation strategy:
- **Administrative Access**: Admin-only routes call `getAdminUser()` ([admin.ts](file:///c:/Codes/WorkSphere/src/lib/admin.ts)), which retrieves metadata roles (`admin`, `super_admin`, or `superadmin`) from Clerk. If the role check fails, requests are rejected with `403 Forbidden` or redirected to `/`.
- **Ownership Verification**: Endpoints querying user records (e.g., bookings, favorites, or conversations) scope Prisma calls using the Clerk-resolved `userId` (e.g., `prisma.booking.findFirst({ where: { id, userId } })`). If missing or owned by another user, handlers return a generic `404 Not Found` to prevent account enumeration and resource discovery.

---

## CSRF Protection

WorkSphere implements a **Signed Double-Submit Cookie Pattern** in Next.js Middleware ([middleware.ts](file:///c:/Codes/WorkSphere/src/middleware.ts)) and helper functions ([csrf.ts](file:///c:/Codes/WorkSphere/src/lib/csrf.ts)):
1. **Cookie Generation**: The server generates a cryptographically random token value using the Web Crypto API, signs it using HMAC-SHA256 with the server-side `CSRF_SECRET` (or `CLERK_SECRET_KEY` fallback), and sets an HTTP-only, secure, SameSite=Lax cookie named `csrf_token` containing `${raw}.${signature}`.
2. **Client Submission**: The client retrieves the raw token via `GET /api/auth/csrf-token` ([route.ts](file:///c:/Codes/WorkSphere/src/app/api/auth/csrf-token/route.ts)) on app initialization and attaches it as the `x-csrf-token` request header.
3. **Middleware Verification**: On mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`), the middleware:
   - Verifies the `csrf_token` cookie signature using a constant-time comparison (`timingSafeEqual`) to prevent timing attacks.
   - Compares the `x-csrf-token` header value against the raw cookie part.
4. **Auto-Recovery**: If a mutating request fails with a CSRF error (`403`), the client-side fetch interceptor ([useCsrfToken.ts](file:///c:/Codes/WorkSphere/src/hooks/useCsrfToken.ts)) fetches a fresh token and retries the request transparently.
5. **Exemptions**: Public webhook paths (`/api/webhook(.*)`) and the CSRF token generator (`/api/auth/csrf-token`) are exempt from CSRF checks.

---

## SSRF Validation Rules

Server-Side Request Forgery (SSRF) validation is enforced on all user-controlled outbound fetches:
1. **Validation Engine**: User-supplied URLs are evaluated prior to dispatching webhook delivery tests ([actions.ts](file:///c:/Codes/WorkSphere/src/app/dashboard/webhooks/actions.ts)) or sending WhatsApp webhook payloads ([whatsapp.ts](file:///c:/Codes/WorkSphere/src/lib/whatsapp.ts)).
2. **Validation Steps**:
   - Scheme is restricted exclusively to `http:` or `https:` (WhatsApp requires `https:`).
   - The hostname is matched against denylists (e.g., rejecting `localhost`, `*.local`).
   - Hostnames are resolved to IP addresses using native DNS lookup.
   - The resolved IP is verified to ensure it does not fall into loopback, private Class A/B/C networks, link-local ranges, tailscale CGNAT ranges (`100.64.0.0/10`), or wildcard ranges (`0.0.0.0/8`).
3. **SSRF Utilities**: Implementations reside in `isSafeWebhookUrl()` ([ssrfValidation.ts](file:///c:/Codes/WorkSphere/src/lib/ssrfValidation.ts)) and `isValidWebhookUrl()` ([whatsapp.ts](file:///c:/Codes/WorkSphere/src/lib/whatsapp.ts)).

---

## Input Validation

All incoming request payloads are validated at the server boundary using **Zod** schemas ([validations.ts](file:///c:/Codes/WorkSphere/src/lib/validations.ts)):
- **Chat Messages**: Validates role types and limits text lengths to `min(1)` and `max(10000)` characters.
- **Venue and Location Inputs**: Enforces latitude/longitude range limits (\([-90, 90]\) and \([-180, 180]\)) and radius constraints.
- **Account Reset Routines**: Enforces strict password criteria (minimum 8 and maximum 128 characters, containing at least one uppercase, lowercase, and numeric character) in [reset-password/route.ts](file:///c:/Codes/WorkSphere/src/app/api/auth/reset-password/route.ts).
- **Safe Parsing**: Schemas utilize `safeParse()` to return structured errors (e.g. returning `400 Bad Request` with field validation summaries) instead of throwing unhandled runtime exceptions.

---

## Input Sanitization

WorkSphere neutralizes potential injection vectors at input and output boundaries:
- **Log Injection**: Outbound messaging handlers sanitize inputs printed to terminal log output using `sanitizeLog()` ([whatsapp.ts](file:///c:/Codes/WorkSphere/src/lib/whatsapp.ts)) to strip carriage return (`\r`) and newline (`\n`) characters.
- **Filename Sanitization**: Upload files routed to local storage fallback have their filenames sanitized ([route.ts](file:///c:/Codes/WorkSphere/src/app/api/upload/route.ts)) by replacing non-alphanumeric characters (except dots and dashes) with underscores (`[^a-zA-Z0-9.-]`), preventing path traversal.
- **Unicode Normalization**: Unicode symbol mapping is applied to currency indicators using `sanitizeCurrencyForPDF()` ([pdfUtils.ts](file:///c:/Codes/WorkSphere/src/lib/pdfUtils.ts)) to replace unsupported characters with standard abbreviations before compilation.

---

## SQL Injection Prevention

WorkSphere defends against SQL injection using the following database access practices:
1. **Prisma Client**: Application features use standard Prisma ORM queries, which are automatically parameterized.
2. **Raw Database Queries**:
   - Queries with template tags utilize `prisma.$queryRaw` or `prisma.$executeRaw` ([semanticCache.ts](file:///c:/Codes/WorkSphere/src/lib/cache/semanticCache.ts)). Variables passed inside template tags are automatically parameterized by the Prisma engine.
   - The AI memory vector search uses `prisma.$queryRawUnsafe` ([route.ts](file:///c:/Codes/WorkSphere/src/app/api/chat/route.ts)) but explicitly maps user arguments to parameters (`$1` and `$2`) instead of string interpolation, maintaining security.

---

## XSS Protection

Cross-Site Scripting (XSS) prevention is structured as follows:
- **React Escaping**: User inputs are rendered as standard JSX strings, which are escaped by React by default.
- **Inner HTML Warning**: Direct rendering of HTML using `dangerouslySetInnerHTML` is prohibited unless subjected to prior security review and sanitized using a verified HTML sanitizer library ([SECURITY_POLICIES.md](file:///c:/Codes/WorkSphere/docs/SECURITY_POLICIES.md)).

---

## File Upload Security

The venue media upload endpoint `/api/upload` ([route.ts](file:///c:/Codes/WorkSphere/src/app/api/upload/route.ts)) enforces file security:
- **Authentication Check**: Rejects requests missing a valid Clerk session.
- **Size Boundaries**: Restricts files to a maximum size of 5MB.
- **Type Restrictions**: Restricts file mime-types to `image/png`, `image/jpeg`, `image/jpg`, `image/gif`, and `image/webp`.
- **Extension Allowlist**: Restricts extensions using `path.extname` comparison to `.png`, `.jpeg`, `.jpg`, `.gif`, and `.webp`.
- **Storage Strategy**: Stream uploads bypass local directories when Cloudinary is configured. Filenames in the local fallback are sanitized to avoid traversal.

---

## Rate Limiting

Distributed rate-limiting is implemented to prevent DoS, LLM token exhaustion, and SMS/Email abuse:
- **Limiting Provider**: Implemented using `@upstash/ratelimit` connected to an Upstash Redis database, using a rolling sliding window algorithm ([rateLimit.ts](file:///c:/Codes/WorkSphere/src/lib/rateLimit.ts)).
- **Development Fallback**: Falls back to an in-memory sliding window when Redis variables are missing.
- **Identifiers**: Keyed by `userId` (for authenticated routes) or client IP (extracted from `x-forwarded-for`/`x-real-ip`).
- **Configured Thresholds**:
  - **Venue Search**: 120 requests/minute per caller ([venues/route.ts](file:///c:/Codes/WorkSphere/src/app/api/venues/route.ts)).
  - **AI Chat Message**: 20 requests/minute per caller ([chat/route.ts](file:///c:/Codes/WorkSphere/src/app/api/chat/route.ts)).
  - **Auth OTP Actions**: 3–5 requests/minute per IP address ([verify-otp/route.ts](file:///c:/Codes/WorkSphere/src/app/api/auth/verify-otp/route.ts)).

---

## Logging & Monitoring

Logging is designed to preserve application visibility while protecting user privacy:
- **Auditing**: Internal events like failed webhook verifications, rate-limiting triggers, and database exceptions write clear details to server output logs.
- **Log Injection Defense**: Carriage return and newline characters are stripped from logged parameters using `sanitizeLog()`.
- **Sensitive Data Exclusion**: Application handlers must never log full raw HTTP request bodies, JWT tokens, cookies, Clerk secret keys, webhook signing secrets, or database credentials.

---

## Secrets Management

Application keys are managed using environment variables:
- **Client Exposure**: Only client-side variables prefixed with `NEXT_PUBLIC_` are exposed in browser bundles.
- **Local Fallbacks**: Secure offline development defaults are supplied for local database, mock Clerk keys, and optional integrations in `.env.local` to enable offline execution without credentials ([ENVIRONMENT_VARIABLES.md](file:///c:/Codes/WorkSphere/docs/ENVIRONMENT_VARIABLES.md)).
- **Key Storage**: Production secrets must be managed using the hosting platform's secure key management infrastructure and never committed to source control.

---

## Secure Deployment Practices

- **Build Pipeline**: Continuous Integration (CI) processes ([ci.yml](file:///c:/Codes/WorkSphere/.github/workflows/ci.yml)) compile Next.js and run full test suites prior to deployment, verifying compatibility.
- **Containerization**: Deployments on container platforms (Azure Container Apps, GCP Cloud Run, AWS ECS) are optional strategies described in the documentation ([AZURE_CONTAINER_APPS.md](file:///c:/Codes/WorkSphere/docs/AZURE_CONTAINER_APPS.md)). There is no active container configuration in the repository root.
- **HTTPS Enforcement**: Cookies are restricted to secure configurations (`secure: true`) in production environments.

---

## Vulnerability Reporting

While there is no dedicated bug bounty contact or public security registry page in this repository, the project manages vulnerability disclosure through the following policy:
- **Reporting Contact**: Suspected vulnerabilities or security incidents must be reported privately to the maintainers ([SECURITY_POLICIES.md](file:///c:/Codes/WorkSphere/docs/SECURITY_POLICIES.md#L1029-L1049)).
- **Private Reporting**: Exploit details, proof-of-concept scripts, or credentials must never be shared in public issues or pull requests. Contributors should utilize GitHub's **Private Vulnerability Reporting** feature where supported on the repository.

---

## Security Best Practices for Contributors

Contributors modifying the codebase must adhere to the following checklist:
1. **Always Verify Identity Server-Side**: Never trust a user ID or role parameter supplied in the request body; verify credentials via Clerk server APIs.
2. **Validate Request Schemas**: Bind all request payloads to Zod schemas using `safeParse()` at route entry.
3. **Parameterize Database Input**: Use Prisma methods or parameterize raw queries using tagged templates. Do not construct query strings using concatenation.
4. **Enforce Ownership Scope**: Restrict queries for private records by matching the authenticated `userId`.
5. **Escape User-Generated Output**: Render user input within standard JSX tags. Avoid bypasses like `dangerouslySetInnerHTML`.
6. **Secure Local Fallbacks**: Maintain the sandbox dev environment's stability; ensure code continues to compile and execute when optional keys are absent.

---

## Known Security Limitations

The following items are identified in the current codebase:
- **No Built-In Malware Scanning**: Upload API files are checked for sizes and extensions but do not pass through malware scanners before storage.
- **Missing Global CSP Configuration**: The application does not specify CSP rules or security headers in `next.config.ts`.
- **Optional local fallback image persistence**: Sandbox file uploads are saved temporarily in the `public/uploads` local directory, meaning files will not persist across redeployments or server restarts.

---

## Future Recommendations

To address the gaps discovered during this audit, developers should prioritize:
1. **Configuring CSP Headers**: Define Content Security Policy directives in `next.config.ts` to limit script injection vectors.
2. **Configuring Default Security Headers**: Enable standard protections like HSTS, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff` in Next.js config.
3. **Malware Checking**: Integrate a file scanning routine (e.g., ClamAV API or third-party validation webhook) before writing uploaded images to permanent cloud storage.
4. **Idempotent Webhook Verification**: Implement a ledger system matching Svix message IDs to prevent double-processing of duplicate webhook retries.
