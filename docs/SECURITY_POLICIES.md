# WorkSphere Security Policies and Audit Guidelines

This document defines the minimum security controls for WorkSphere API routes,
Clerk authentication, webhook processing, input validation, CORS, secret
handling, logging, and pull-request security review.

> Primary technologies:
>
> - Next.js App Router
> - Clerk authentication
> - Prisma ORM
> - PostgreSQL
> - Zod validation
> - Svix-signed Clerk webhooks

---

## 1. Security objectives

WorkSphere security controls should ensure that:

1. only authenticated users can access protected resources;
2. users can access only their own private data;
3. webhook events are accepted only after signature verification;
4. external input is validated before use;
5. database access uses Prisma or parameterized SQL;
6. secrets never reach browser bundles or source control;
7. errors do not expose tokens, secrets, stack traces, or personal data;
8. CORS permits only explicitly trusted origins where cross-origin access is
   required;
9. security-sensitive changes are reviewed and tested before merge.

Authentication proves identity. Authorization decides what that identity may
do. Every protected route must enforce both when applicable.

---

## 2. Clerk environment variables

The following variables are sensitive configuration:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
```

### Classification

| Variable | Browser exposure | Repository |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Allowed | Never hard-code |
| `CLERK_SECRET_KEY` | Never | Never commit |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Never | Never commit |

The publishable key is intentionally available to the Clerk frontend SDK.
The secret key and webhook signing secret must remain server-only.

### Local development

Store local values in:

```text
.env.local
```

Confirm `.env.local` is ignored:

```bash
git check-ignore .env.local
```

Never paste real secrets into:

- issues;
- pull requests;
- screenshots;
- logs;
- test fixtures;
- client-side components;
- variables prefixed with `NEXT_PUBLIC_`.

Rotate a key immediately if it is exposed.

---

## 3. Route classification

Every API route should be classified before implementation.

| Route type | Example | Required control |
|---|---|---|
| Public read | Public venue discovery | Validation, rate limiting, bounded output |
| Authenticated read | User bookings | Clerk auth plus ownership check |
| Authenticated write | Submit rating | Clerk auth, validation, authorization |
| Admin-only | Admin analytics | Clerk auth plus admin role check |
| Webhook | Clerk user synchronization | Public route plus signature verification |
| Internal task | Scheduled cleanup | Strong shared secret or platform identity |

A route is not protected merely because its page is protected. API routes must
perform their own server-side checks.

---

## 4. Clerk authentication in API routes

For a protected Next.js Route Handler:

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  return NextResponse.json({ userId });
}
```

### Required rules

- Call Clerk authentication on the server.
- Do not accept `userId` from the request body as proof of identity.
- Use the authenticated Clerk `userId` for user-owned records.
- Return `401` when authentication is missing or invalid.
- Return `403` when the user is authenticated but lacks permission.
- Do not expose the Clerk secret key to route clients.

---

## 5. Ownership authorization

Authentication alone is insufficient.

Unsafe:

```ts
const booking = await prisma.booking.findUnique({
  where: { id: bookingId },
});
```

An authenticated user could request another user's booking if the route does
not verify ownership.

Safer:

```ts
const booking = await prisma.booking.findFirst({
  where: {
    id: bookingId,
    userId,
  },
});
```

If no row is found, return a generic `404`:

```ts
if (!booking) {
  return NextResponse.json(
    { error: "Booking not found" },
    { status: 404 },
  );
}
```

Using a generic response avoids confirming that a private resource exists for
another user.

Apply this pattern to:

- favorites;
- conversations;
- messages;
- bookings;
- user memories;
- private coworking sessions;
- moderation records;
- administrative resources.

---

## 6. Admin authorization

Admin access must be verified server-side.

Example metadata-based check:

```ts
import { currentUser } from "@clerk/nextjs/server";

export async function requireAdmin() {
  const user = await currentUser();

  if (!user) {
    return { ok: false as const, status: 401 };
  }

  const publicRole =
    typeof user.publicMetadata?.role === "string"
      ? user.publicMetadata.role
      : "";

  const privateRole =
    typeof user.privateMetadata?.role === "string"
      ? user.privateMetadata.role
      : "";

  const role = (privateRole || publicRole).toLowerCase();

  if (!["admin", "super_admin"].includes(role)) {
    return { ok: false as const, status: 403 };
  }

  return { ok: true as const, user };
}
```

Do not trust a role sent by the browser.

Prefer private metadata for authorization data unless the client genuinely
needs to read the role. If public metadata is used, authorization must still be
performed from the trusted server-side Clerk user/session data.

---

## 7. JWT and bearer-token validation

WorkSphere normally relies on Clerk's server helpers for session validation.
Do not manually decode a JWT and treat the decoded payload as trusted.

Unsafe:

```ts
const payload = JSON.parse(
  Buffer.from(token.split(".")[1], "base64").toString(),
);
```

Decoding does not verify:

- the signature;
- expiration;
- issuer;
- audience;
- authorized party;
- token type.

For ordinary Next.js API routes, use:

```ts
const { userId, sessionId } = await auth();
```

For a backend endpoint that receives a bearer token from another client, use
Clerk's authenticated request or token-verification utilities according to the
current Clerk SDK.

Typical extraction:

```ts
const authorization = request.headers.get("authorization");

if (!authorization?.startsWith("Bearer ")) {
  return NextResponse.json(
    { error: "Missing bearer token" },
    { status: 401 },
  );
}

const token = authorization.slice("Bearer ".length);
```

The token must then be cryptographically verified with Clerk. Never use token
contents before verification.

### Validation checklist

A verified token should satisfy:

- valid signature;
- accepted Clerk issuer;
- unexpired `exp`;
- valid `nbf` when present;
- expected audience when the application uses one;
- expected authorized party/origin where configured;
- active session where required.

Do not log full JWTs.

---

## 8. Clerk webhook security

Clerk webhook routes are deliberately public because webhook requests are sent
by Clerk, not by a signed-in browser user. Public does not mean unverified.

The route must verify the webhook before processing any event.

Recommended current Clerk pattern:

```ts
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const event = await verifyWebhook(request);

    switch (event.type) {
      case "user.created":
      case "user.updated":
      case "user.deleted":
        // Process verified event.
        break;
      default:
        // Ignore unsupported verified events.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Clerk Webhook] Verification failed");

    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 },
    );
  }
}
```

`verifyWebhook()` verifies the Svix signature using the request body, headers,
and Clerk webhook signing secret.

### Required Svix headers

A Clerk/Svix webhook request includes signature metadata such as:

```text
svix-id
svix-timestamp
svix-signature
```

All required headers must be present.

When using the lower-level Svix package:

```ts
import { Webhook } from "svix";

const svixId = request.headers.get("svix-id");
const svixTimestamp = request.headers.get("svix-timestamp");
const svixSignature = request.headers.get("svix-signature");

if (!svixId || !svixTimestamp || !svixSignature) {
  return new Response("Missing Svix headers", { status: 400 });
}

const rawBody = await request.text();

const webhook = new Webhook(
  process.env.CLERK_WEBHOOK_SIGNING_SECRET!,
);

const event = webhook.verify(rawBody, {
  "svix-id": svixId,
  "svix-timestamp": svixTimestamp,
  "svix-signature": svixSignature,
});
```

### Critical webhook rules

- Read the raw request body for verification.
- Do not parse JSON before low-level signature verification.
- Do not trust the event until verification succeeds.
- Do not protect the webhook with user-session middleware.
- Limit the route to `POST`.
- Return `2xx` only after the event has been safely accepted.
- Return `4xx` for invalid signatures.
- Return `5xx` for retriable internal processing failures.
- Do not log signing secrets or full webhook payloads in production.

---

## 9. Replay and duplicate protection

Webhook providers may retry delivery. A correctly signed event may be delivered
more than once.

Use the Svix event/message ID as an idempotency key.

Conceptual table:

```prisma
model WebhookEvent {
  id          String   @id
  eventType   String
  processedAt DateTime @default(now())
}
```

Processing flow:

```ts
await prisma.$transaction(async (tx) => {
  const existing = await tx.webhookEvent.findUnique({
    where: { id: eventId },
  });

  if (existing) {
    return;
  }

  // Apply event changes using create/update/upsert.

  await tx.webhookEvent.create({
    data: {
      id: eventId,
      eventType: event.type,
    },
  });
});
```

Where possible, synchronize users with `upsert` rather than
"find-then-create."

Webhook signature verification includes timestamp checks, but idempotency is
still required to prevent duplicate processing.

---

## 10. Clerk user synchronization policy

For a verified `user.created` or `user.updated` event:

```ts
await prisma.user.upsert({
  where: { id: event.data.id },
  update: {
    email: event.data.email_addresses[0]?.email_address ?? null,
    firstName: event.data.first_name ?? null,
    lastName: event.data.last_name ?? null,
  },
  create: {
    id: event.data.id,
    email: event.data.email_addresses[0]?.email_address ?? null,
    firstName: event.data.first_name ?? null,
    lastName: event.data.last_name ?? null,
  },
});
```

For `user.deleted`, follow the project's approved retention policy.

Do not automatically cascade-delete bookings or audit records without an
explicit data-retention decision. User deletion may require:

- hard deletion;
- anonymization;
- soft deletion;
- delayed deletion;
- retention of legally or operationally required booking records.

---

## 11. CORS policy

Same-origin browser requests do not require permissive CORS headers.

Do not add:

```text
Access-Control-Allow-Origin: *
```

to authenticated or sensitive routes.

A wildcard origin combined with sensitive data increases exposure. Credentials
cannot safely be shared with an unrestricted origin.

### Allowlist policy

```ts
const allowedOrigins = new Set([
  "http://localhost:3000",
  "https://worksphere.example.com",
]);

function corsHeaders(origin: string | null) {
  if (!origin || !allowedOrigins.has(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}
```

### Preflight handling

```ts
export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin || !allowedOrigins.has(origin)) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
```

### CORS requirements

- Use an exact allowlist.
- Include `Vary: Origin`.
- Permit only required methods.
- Permit only required headers.
- Do not reflect arbitrary origins.
- Do not treat CORS as authentication.
- Keep webhook routes independent of browser CORS assumptions.
- Review preview-deployment origins before adding them.

CORS controls which browsers may read responses. It does not stop direct HTTP
requests from attackers.

---

## 12. Input validation policy

All untrusted input must be validated at the server boundary.

Sources include:

- JSON request bodies;
- query parameters;
- dynamic route parameters;
- form data;
- webhook payload fields after signature verification;
- third-party API responses;
- uploaded file metadata;
- cookies and headers.

Use Zod schemas from a shared validation module.

Example venue submission schema:

```ts
import { z } from "zod";

export const venueSubmissionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  category: z.enum(["cafe", "coworking", "library"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  website: z.string().url().max(500).optional().nullable(),
  comment: z.string().trim().max(1000).optional(),
});
```

Route usage:

```ts
const body = await request.json();
const result = venueSubmissionSchema.safeParse(body);

if (!result.success) {
  return NextResponse.json(
    {
      error: "Invalid venue submission",
      fields: result.error.flatten().fieldErrors,
    },
    { status: 400 },
  );
}

const data = result.data;
```

### Validation principles

- Reject unknown structure when appropriate with `.strict()`.
- Apply length limits.
- Validate enums instead of arbitrary strings.
- Validate numeric range.
- Normalize whitespace.
- Validate URLs.
- Reject impossible dates and time ranges.
- Bound arrays.
- Do not rely only on client-side validation.
- Store normalized values.

---

## 13. Sanitization and output safety

Validation and sanitization solve different problems.

- **Validation** checks whether data is allowed.
- **Normalization** converts valid data to a consistent form.
- **Sanitization** removes or neutralizes unsafe content.
- **Output encoding** prevents data from being interpreted as executable code.

React escapes ordinary text output by default:

```tsx
<p>{venue.comment}</p>
```

Avoid:

```tsx
<div dangerouslySetInnerHTML={{ __html: venue.comment }} />
```

If HTML input is a real product requirement, sanitize it with an established
HTML sanitizer and a strict allowlist before rendering.

Do not attempt to create a homemade sanitizer with regular expressions.

### Venue and review modal policy

For venue submissions and reviews:

- accept plain text by default;
- trim input;
- enforce maximum lengths;
- reject control characters where appropriate;
- do not render submitted text as HTML;
- validate external URLs;
- prevent `javascript:` and unsupported URL schemes;
- normalize category and enum fields;
- derive `userId` from Clerk;
- use Prisma for persistence.

---

## 14. SQL and Prisma policy

Prefer Prisma query methods:

```ts
await prisma.venue.findMany({
  where: {
    category,
  },
});
```

Prisma parameterizes values.

When raw SQL is required, use tagged parameterized queries:

```ts
await prisma.$queryRaw`
  SELECT id, content
  FROM "UserMemory"
  WHERE "userId" = ${userId}
  LIMIT ${limit}
`;
```

Do not concatenate input:

```ts
// Unsafe
await prisma.$queryRawUnsafe(
  `SELECT * FROM "User" WHERE email = '${email}'`,
);
```

Additional controls:

- apply `take` to public list queries;
- use transactions for multi-step writes;
- use unique constraints for duplicate prevention;
- scope user-owned queries with `userId`;
- avoid exposing internal database errors.

---

## 15. Request body and resource limits

Limit server work before expensive operations.

Recommended limits:

| Input | Suggested maximum |
|---|---:|
| Venue name | 120 characters |
| Address | 300 characters |
| Review/comment | 1,000 characters |
| Search query | 500 characters |
| Session title | 100 characters |
| Session description | 500 characters |
| Array of amenities | 20 entries |
| Public list page size | 50 records |

For file uploads, additionally validate:

- file size;
- MIME type;
- file signature when necessary;
- image dimensions;
- storage path;
- authorization;
- malware-processing requirements.

---

## 16. Rate limiting and abuse protection

High-risk endpoints should be rate limited:

- AI search;
- venue submissions;
- rating/review submissions;
- booking creation;
- login-related custom endpoints;
- webhook route abuse;
- public geocoding/routing proxies.

Rate-limit keys may include:

- authenticated user ID;
- IP address;
- route;
- organization ID;
- combination of user and route.

A rate limit is not a replacement for authorization or validation.

Return:

```text
429 Too Many Requests
```

with a retry period where supported.

---

## 17. Error handling

Public API errors should be predictable and minimal.

```ts
try {
  // operation
} catch (error) {
  console.error("[Venue Submission]", {
    message: error instanceof Error ? error.message : "Unknown error",
  });

  return NextResponse.json(
    { error: "Unable to submit venue" },
    { status: 500 },
  );
}
```

Do not return:

- full stack traces;
- Prisma error objects;
- environment variables;
- tokens;
- SQL;
- webhook payloads;
- private user metadata.

Recommended status codes:

| Status | Meaning |
|---:|---|
| `400` | Invalid input or signature |
| `401` | Authentication missing or invalid |
| `403` | Authenticated but not permitted |
| `404` | Resource unavailable or not owned |
| `409` | Conflict or duplicate state |
| `422` | Semantically invalid request when used |
| `429` | Rate limit exceeded |
| `500` | Internal failure |

---

## 18. Security logging

Log security-relevant events without logging secrets.

Useful events:

- failed webhook verification;
- repeated authorization failures;
- rejected admin access;
- rate-limit activation;
- validation failure counts;
- suspicious booking conflicts;
- unusual API error spikes;
- secret scanning alerts.

Recommended fields:

```text
timestamp
requestId
route
method
userId (when available)
eventType
result
statusCode
```

Avoid logging:

```text
Authorization header
session token
JWT
Clerk secret key
webhook signing secret
database URL
full request body
personal contact details
```

---

## 19. Security headers

The deployment should provide appropriate headers, for example:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: microphone=(self), geolocation=(self)
```

A Content Security Policy should be tested against required Clerk, map, image,
and analytics domains before enforcement.

Do not deploy a copied CSP without testing. Clerk scripts, map tiles, image
providers, and API connections may require explicit directives.

When the ambient-noise feature is enabled, microphone access should remain
restricted to the same trusted application origin.

---

## 20. CSRF considerations

Clerk session authentication and same-site cookie behavior provide part of the
defense, but sensitive state-changing routes should still follow these rules:

- use non-GET methods for mutations;
- validate `Origin` or trusted same-origin behavior where applicable;
- do not enable arbitrary credentialed CORS;
- require Clerk authentication;
- avoid mutation through query strings;
- use idempotency keys for sensitive repeated operations.

Webhook routes are not CSRF-protected browser routes; they are protected with
cryptographic signatures.

---

## 21. Dependency and secret auditing

Run before release:

```bash
npm audit
```

Review findings rather than applying breaking upgrades blindly.

Additional repository checks:

```bash
git grep -n "CLERK_SECRET_KEY"
git grep -n "CLERK_WEBHOOK_SIGNING_SECRET"
git grep -n "DATABASE_URL"
git grep -n "dangerouslySetInnerHTML"
git grep -n "\$queryRawUnsafe"
git grep -n "Access-Control-Allow-Origin"
```

The expected result is that secrets appear only as environment-variable names
or documentation placeholders, never as real values.

Use GitHub secret scanning and dependency alerts where available.

---

## 22. Pull-request security checklist

### Authentication and authorization

- [ ] Protected routes call Clerk authentication server-side.
- [ ] User-owned resources are scoped by authenticated `userId`.
- [ ] Admin routes verify an admin role server-side.
- [ ] The client cannot assign its own identity or role.

### Webhooks

- [ ] Clerk webhook signature verification occurs before processing.
- [ ] Required Svix headers are validated.
- [ ] The webhook route is public to Clerk but accepts only verified events.
- [ ] Event processing is idempotent.
- [ ] Unsupported event types are safely ignored.
- [ ] Secrets and full payloads are not logged.

### Validation and output

- [ ] Request bodies use a server-side Zod schema.
- [ ] Length and range limits exist.
- [ ] URLs are validated.
- [ ] User content is rendered as text, not unsafe HTML.
- [ ] Prisma or parameterized SQL is used.

### CORS and network policy

- [ ] No sensitive route uses wildcard credentialed CORS.
- [ ] Allowed origins are explicit.
- [ ] Preflight methods and headers are minimal.
- [ ] `Vary: Origin` is present for dynamic origin responses.

### Secrets and logging

- [ ] No secrets are committed.
- [ ] No JWTs or authorization headers are logged.
- [ ] Errors returned to clients are generic.
- [ ] Security-relevant failures are logged safely.

### Testing

- [ ] Unauthenticated request returns `401`.
- [ ] Unauthorized authenticated request returns `403` or safe `404`.
- [ ] Invalid input returns `400`.
- [ ] Invalid webhook signature is rejected.
- [ ] Duplicate webhook delivery is idempotent.
- [ ] Valid webhook event updates the expected record.
- [ ] Cross-origin request from an unapproved origin is rejected.
- [ ] Existing tests and build pass.

---

## 23. Suggested security test cases

### Protected route

```ts
it("rejects unauthenticated requests", async () => {
  const response = await requestProtectedRoute();
  expect(response.status).toBe(401);
});
```

### Ownership

```ts
it("does not return another user's booking", async () => {
  const response = await requestBookingAsDifferentUser();
  expect([403, 404]).toContain(response.status);
});
```

### Validation

```ts
it("rejects an invalid venue latitude", async () => {
  const response = await submitVenue({
    latitude: 500,
  });

  expect(response.status).toBe(400);
});
```

### Webhook signature

```ts
it("rejects a webhook with an invalid signature", async () => {
  const response = await postWebhook({
    headers: {
      "svix-id": "invalid",
      "svix-timestamp": "0",
      "svix-signature": "invalid",
    },
  });

  expect(response.status).toBe(400);
});
```

### Idempotency

```ts
it("processes the same webhook event once", async () => {
  await sendVerifiedEventTwice();
  expect(await countAppliedChanges()).toBe(1);
});
```

---

## 24. Incident response

If a security incident is suspected:

1. preserve relevant logs;
2. stop active exposure;
3. rotate affected secrets;
4. revoke compromised sessions where applicable;
5. identify affected routes and data;
6. notify maintainers privately;
7. avoid publishing exploit details before mitigation;
8. prepare a tested fix;
9. document the timeline and root cause;
10. add regression tests.

Do not place vulnerability details or live secrets in a public issue.

Use GitHub's private vulnerability reporting or the maintainer's designated
security contact where available.

---

## 25. Security audit cadence

Recommended review cadence:

| Activity | Frequency |
|---|---|
| Dependency review | Every pull request / automated |
| Secret scanning | Continuous |
| Authentication route review | Every auth-related PR |
| Webhook verification test | Every webhook change |
| Manual access-control audit | Before major release |
| CORS review | Before adding a new frontend origin |
| Data-retention review | Before deletion/cascade changes |
| Full security review | Quarterly or before production launch |

---

## 26. Summary

The minimum WorkSphere security baseline is:

- Clerk identity verification on protected routes;
- explicit authorization and ownership checks;
- verified Clerk/Svix webhooks;
- idempotent webhook processing;
- strict server-side validation;
- safe rendering of user input;
- Prisma or parameterized SQL;
- explicit CORS allowlists;
- protected secrets;
- privacy-aware logging;
- security-focused pull-request tests.

Security controls must be enforced at server boundaries. Client-side hiding,
disabled buttons, and page redirects are user-experience features, not security
boundaries.
