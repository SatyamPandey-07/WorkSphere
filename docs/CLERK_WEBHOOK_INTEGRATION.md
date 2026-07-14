# Clerk Webhook Integration Manual

This document is a complete reference for the Clerk user-sync webhook integration in WorkSphere. It covers the full lifecycle of a webhook request: from creating the endpoint in the Clerk Dashboard, through Svix signature verification, to the exact database operations performed for each event type. It also includes production setup guidance, troubleshooting steps, and common error codes.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Step 1: Create the Webhook Endpoint in Clerk](#step-1-create-the-webhook-endpoint-in-clerk)
- [Step 2: Configure the Environment Variable](#step-2-configure-the-environment-variable)
- [Step 3: How the Route Handler Works](#step-3-how-the-route-handler-works)
- [Svix Signature Verification](#svix-signature-verification)
- [Event Structure and Payload Reference](#event-structure-and-payload-reference)
- [Database Mapping](#database-mapping)
- [Image URL Normalization](#image-url-normalization)
- [Error Handling Strategy](#error-handling-strategy)
- [Middleware: Why the Webhook Route Is Public](#middleware-why-the-webhook-route-is-public)
- [Production Setup](#production-setup)
- [Local Development & Testing](#local-development--testing)
- [Troubleshooting](#troubleshooting)
- [Related Files](#related-files)

---

## Overview

WorkSphere stores a local copy of each user's profile in its own PostgreSQL database (via Prisma). Clerk is the source of truth for authentication, but many features — venue bookings, co-working sessions, folder memberships, favorites — reference the local `User` table rather than making live calls to Clerk.

Webhooks are what keep these two systems in sync. Every time Clerk creates, updates, or deletes a user account, it sends an HTTPS POST request to WorkSphere's webhook endpoint. The handler verifies the request, determines the event type, and applies the corresponding database change.

**Supported events:**

| Event          | Trigger                             | Database action           |
| -------------- | ----------------------------------- | ------------------------- |
| `user.created` | New Clerk account registered        | `prisma.user.create(...)` |
| `user.updated` | User updates their profile in Clerk | `prisma.user.update(...)` |
| `user.deleted` | Clerk account removed               | `prisma.user.delete(...)` |

---

## Architecture

```
Clerk Dashboard
     │
     │  HTTPS POST  /api/webhook
     │  Headers: svix-id, svix-timestamp, svix-signature
     │  Body: JSON event payload
     ▼
src/app/api/webhook/route.ts
     │
     ├─ 1. Read svix-* headers
     │
     ├─ 2. Verify HMAC signature using WEBHOOK_SECRET
     │        (via the `svix` npm package)
     │
     ├─ 3. Parse evt.type
     │
     ├─ user.created  ──► prisma.user.create(...)
     ├─ user.updated  ──► prisma.user.update(...)
     └─ user.deleted  ──► prisma.user.delete(...)
                               │
                               ▼
                      PostgreSQL (via Prisma)
                      User table updated
```

The route returns HTTP `200` on success. Clerk will retry failed deliveries automatically if the response is anything other than a `2xx` status.

---

## Step 1: Create the Webhook Endpoint in Clerk

1. Log in to the [Clerk Dashboard](https://dashboard.clerk.com/).
2. Select your WorkSphere application.
3. Navigate to **Webhooks** in the left-hand sidebar.
4. Click **Add Endpoint**.
5. Set the **Endpoint URL** to your deployment's webhook path:
   - Production: `https://your-domain.com/api/webhook`
   - Local dev (via tunnel): `https://your-ngrok-url.ngrok-free.app/api/webhook`
6. Under **Message Filtering**, enable these three events:
   - `user.created`
   - `user.updated`
   - `user.deleted`
7. Click **Create**.
8. On the endpoint details page, click **Reveal** next to the **Signing Secret** and copy the value. It starts with `whsec_`.

---

## Step 2: Configure the Environment Variable

Add the signing secret to your environment file:

```env
# .env.local (development) or your hosting provider's secret manager (production)
WEBHOOK_SECRET=whsec_your_signing_secret_here
```

The webhook handler will throw an error on startup if `WEBHOOK_SECRET` is not set:

```ts
if (!WEBHOOK_SECRET) {
  throw new Error("Please add WEBHOOK_SECRET from Clerk Dashboard to .env");
}
```

For a full list of all environment variables, see [`docs/ENV_VARS.md`](./ENV_VARS.md).

---

## Step 3: How the Route Handler Works

**File:** `src/app/api/webhook/route.ts`

The handler is a Next.js App Router `POST` function. Here is the execution flow step by step:

```
POST /api/webhook
     │
     ▼
1.  Read WEBHOOK_SECRET from process.env
     │  → throws if missing
     ▼
2.  Read svix headers from the incoming request
     │  svix-id, svix-timestamp, svix-signature
     │  → returns HTTP 400 if any header is absent
     ▼
3.  Serialize the request body to a string
     │  (Svix requires the raw body bytes for HMAC verification)
     ▼
4.  Create a Svix Webhook instance with WEBHOOK_SECRET
     │  const wh = new Webhook(WEBHOOK_SECRET)
     ▼
5.  Call wh.verify(body, headers)
     │  → returns HTTP 400 on signature mismatch
     ▼
6.  Read evt.type to route to the correct handler
     │
     ├─ "user.created"  → create user record in DB
     ├─ "user.updated"  → update user record in DB
     └─ "user.deleted"  → delete user record from DB
     ▼
7.  Return HTTP 200 (empty body)
```

---

## Svix Signature Verification

Clerk uses [Svix](https://www.svix.com/) to sign and deliver webhooks. Every request includes three headers that together form a verifiable HMAC-SHA256 signature:

| Header           | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `svix-id`        | Unique identifier for this specific webhook delivery               |
| `svix-timestamp` | Unix epoch seconds when the event was sent                         |
| `svix-signature` | One or more comma-separated HMAC-SHA256 signatures (`v1,<base64>`) |

### Verification code

```ts
import { Webhook } from "svix";

const wh = new Webhook(WEBHOOK_SECRET);

try {
  evt = wh.verify(body, {
    "svix-id": svix_id,
    "svix-timestamp": svix_timestamp,
    "svix-signature": svix_signature,
  }) as WebhookEvent;
} catch (err) {
  console.error("Error verifying webhook:", err);
  return new Response("Error occured", { status: 400 });
}
```

### What `wh.verify()` checks

1. **Timestamp tolerance** — Svix rejects payloads with a `svix-timestamp` more than five minutes old. This prevents replay attacks.
2. **HMAC integrity** — The library recomputes `HMAC-SHA256(svix_id + "." + svix_timestamp + "." + body)` using `WEBHOOK_SECRET` and compares it to the value in `svix-signature`. Any mismatch causes an exception.
3. **Header presence** — If `svix-id`, `svix-timestamp`, or `svix-signature` is missing from the request, the route returns `400` before even attempting verification.

### Svix error codes

| Scenario                    | HTTP response              | Log message                          |
| --------------------------- | -------------------------- | ------------------------------------ |
| Missing `svix-*` headers    | `400 Bad Request`          | `"Error occured -- no svix headers"` |
| Signature mismatch          | `400 Bad Request`          | `"Error verifying webhook: ..."`     |
| Timestamp too old (> 5 min) | `400 Bad Request`          | `"Error verifying webhook: ..."`     |
| `WEBHOOK_SECRET` not set    | Server error (throws)      | `"Please add WEBHOOK_SECRET..."`     |
| Successful verification     | Proceeds to event handling | —                                    |

---

## Event Structure and Payload Reference

Clerk sends all events as a JSON object with a consistent top-level shape:

```json
{
  "type": "user.created",
  "object": "event",
  "data": { ... }
}
```

### `user.created` payload (relevant fields)

```json
{
  "type": "user.created",
  "data": {
    "id": "user_2abc123xyz",
    "email_addresses": [
      {
        "id": "idn_abc",
        "email_address": "jane@example.com",
        "verification": { "status": "verified" }
      }
    ],
    "first_name": "Jane",
    "last_name": "Doe",
    "image_url": "https://img.clerk.com/eyJ...?sz=150",
    "created_at": 1720000000000,
    "updated_at": 1720000000000
  }
}
```

### `user.updated` payload (relevant fields)

Same shape as `user.created`. The handler uses the same fields (`id`, `email_addresses`, `first_name`, `last_name`, `image_url`) to overwrite the existing record.

### `user.deleted` payload (relevant fields)

```json
{
  "type": "user.deleted",
  "data": {
    "id": "user_2abc123xyz",
    "deleted": true
  }
}
```

Only the `id` field is used for deletion. The rest of the data payload may be sparse or absent for delete events.

---

## Database Mapping

All database operations use Prisma and target the `User` model in `prisma/schema.prisma`.

### User model (relevant fields)

```prisma
model User {
  id         String    @id            // Clerk user ID (e.g. "user_2abc...")
  email      String?   @unique        // Primary email address
  firstName  String?                  // First name
  lastName   String?                  // Last name
  imageUrl   String?                  // Normalized profile image URL
  createdAt  DateTime  @default(now())
  // ... relations omitted for brevity
}
```

### `user.created` → `prisma.user.create`

```ts
const { id, email_addresses, first_name, last_name, image_url } = evt.data;

await prisma.user.create({
  data: {
    id, // Clerk user ID becomes the primary key
    email: email_addresses[0]?.email_address, // First (primary) email address
    firstName: first_name,
    lastName: last_name,
    imageUrl, // Normalized URL (see section below)
  },
});
```

### `user.updated` → `prisma.user.update`

```ts
await prisma.user.update({
  where: { id },
  data: {
    email: email_addresses[0]?.email_address,
    firstName: first_name,
    lastName: last_name,
    imageUrl,
  },
});
```

### `user.deleted` → `prisma.user.delete`

```ts
await prisma.user.delete({
  where: { id: id! },
});
```

The `!` non-null assertion is safe here because Clerk always includes the user ID in deletion events.

### Field mapping table

| Clerk payload field                     | Prisma `User` field | Notes                                   |
| --------------------------------------- | ------------------- | --------------------------------------- |
| `data.id`                               | `id`                | Direct mapping; used as the primary key |
| `data.email_addresses[0].email_address` | `email`             | Only the first email is stored          |
| `data.first_name`                       | `firstName`         | May be `null` for social-login accounts |
| `data.last_name`                        | `lastName`          | May be `null` for social-login accounts |
| `data.image_url` (normalized)           | `imageUrl`          | See image normalization section         |

---

## Image URL Normalization

Clerk image URLs often include size parameters. The handler normalizes them to 150px and provides a fallback avatar when no image is available:

```ts
const initials =
  `${first_name?.[0] || ""}${last_name?.[0] || ""}`.toUpperCase();
const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
  initials || "WS",
)}&background=6366f1&color=fff`;

const imageUrl = image_url
  ? image_url
      .replace(/(\?|&)sz=\d+/, "$1sz=150") // normalize ?sz= parameter
      .replace(/(\?|&)width=\d+/, "$1width=150") // normalize ?width= parameter
  : fallbackUrl;
```

**Behavior summary:**

| Condition                                            | Result                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `image_url` is present                               | Resized to 150px via query parameter replacement                   |
| `image_url` is `null` or empty and name is available | Initials-based avatar from `ui-avatars.com` with indigo background |
| No name and no image                                 | Falls back to `"WS"` initials on the same avatar service           |

This normalization runs identically for both `user.created` and `user.updated` events.

---

## Error Handling Strategy

Database errors are caught and logged without re-throwing, and the route still returns `200`:

```ts
try {
  await prisma.user.create({ data: { ... } });
  console.log("User created in database:", id);
} catch (error) {
  console.error("Error creating user:", error);
  // Do NOT throw — returning 200 prevents Clerk from retrying
}
```

**Why not return a 5xx on database failure?**

Clerk automatically retries webhook deliveries that receive non-`2xx` responses. If a database error is transient (network blip, connection pool exhaustion), retrying is reasonable. However, if the error is permanent (e.g., a unique constraint violation on a duplicate `user.created` delivery), retrying would just fill the logs with repeated failures.

The current strategy logs the error for visibility and returns `200` to stop retries. For production deployments where observability matters, consider forwarding these errors to a structured logger or alerting system (see [Production Setup](#production-setup)).

---

## Middleware: Why the Webhook Route Is Public

`src/middleware.ts` protects all routes by default using `clerkMiddleware()`. The webhook endpoint is explicitly listed as a public route to bypass session-based auth:

```ts
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhook(.*)", // ← webhook must be reachable without a session cookie
  "/privacy(.*)",
  "/terms(.*)",
]);
```

This is correct and intentional. Clerk's servers do not have a user session — they authenticate themselves with the Svix HMAC signature instead. Requiring a session cookie here would block all webhook deliveries.

---

## Production Setup

### Required environment variables

```env
WEBHOOK_SECRET=whsec_your_signing_secret_from_clerk_dashboard
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
DATABASE_URL=postgresql://...
```

### Clerk Dashboard configuration checklist

- [ ] Webhook endpoint URL points to your production domain (`https://your-domain.com/api/webhook`)
- [ ] `user.created`, `user.updated`, and `user.deleted` events are enabled
- [ ] The `WEBHOOK_SECRET` in your hosting provider matches the signing secret shown in the Clerk Dashboard
- [ ] The webhook endpoint is saved and shows a green status indicator

### Deployment considerations

**Vercel**

- Add `WEBHOOK_SECRET` via the Vercel project dashboard under **Settings → Environment Variables**.
- Ensure the variable is scoped to the Production environment (and Preview if you want webhook testing on preview deployments).
- Vercel serverless functions are stateless; the handler is safe as-is.

**Docker / self-hosted**

- Inject `WEBHOOK_SECRET` via environment variables in your container runtime or secrets manager.
- Ensure the `/api/webhook` path is reachable from the public internet (not behind a VPN or firewall).

**Rate limiting**

- The webhook route does not have rate limiting applied. Clerk controls delivery frequency; no additional throttling is needed here.

### Monitoring recommendations

- Stream server logs to a log aggregator (Datadog, Axiom, Logtail) to capture `console.error` calls from failed database operations.
- Set up an alert on `"Error creating user"` / `"Error updating user"` / `"Error deleting user"` log lines to catch silent DB failures.
- In the Clerk Dashboard, periodically check the webhook delivery log under **Webhooks → your endpoint → Logs** to confirm recent deliveries are succeeding.

---

## Local Development & Testing

### Option 1: ngrok tunnel (recommended)

ngrok exposes your local Next.js dev server to the internet so Clerk can deliver real webhook events.

```bash
# Start your dev server first
npm run dev

# In a separate terminal, start an ngrok tunnel
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL from ngrok's output, then:

1. In the Clerk Dashboard, add a new webhook endpoint: `https://xxxx.ngrok-free.app/api/webhook`
2. Enable `user.created`, `user.updated`, `user.deleted`
3. Copy the signing secret to your `.env.local` as `WEBHOOK_SECRET`

Trigger events by registering a new user in your local app and watch the terminal logs.

### Option 2: Clerk CLI (svix-cli)

Svix provides a CLI for replaying past events or sending test payloads:

```bash
# Install svix CLI
npm install -g svix-cli

# Send a test user.created event
svix message send --url http://localhost:3000/api/webhook --event-type user.created --data '{"id":"user_test","email_addresses":[{"email_address":"test@example.com"}],"first_name":"Test","last_name":"User","image_url":null}'
```

### Option 3: Clerk Dashboard test events

In the Clerk Dashboard, navigate to your webhook endpoint and use **Send test event** to fire a sample payload at the configured URL. Useful for verifying production endpoints after deployment.

### Checking the result

After a `user.created` test, verify the record was written to your local database:

```bash
npx prisma studio
```

Open Prisma Studio at `http://localhost:5555`, navigate to the `User` table, and confirm the new row exists.

---

## Troubleshooting

### `400 Bad Request` — "Error occured -- no svix headers"

**Cause:** The request arrived without `svix-id`, `svix-timestamp`, or `svix-signature` headers.

**Fix:** This almost always means the request was not sent by Clerk (e.g., a manual `curl` without headers, or a misconfigured reverse proxy stripping headers). Verify the endpoint URL in the Clerk Dashboard and ensure your proxy/CDN forwards all request headers.

---

### `400 Bad Request` — "Error verifying webhook"

**Cause:** HMAC signature verification failed.

**Common reasons:**

1. `WEBHOOK_SECRET` in your environment does not match the signing secret shown in the Clerk Dashboard for this endpoint.
2. The request body was modified in transit (a middleware or proxy that re-serialized the JSON).
3. The `svix-timestamp` is more than 5 minutes old (replay protection triggered).

**Fix:**

- Copy the signing secret from the Clerk Dashboard again and replace `WEBHOOK_SECRET` in your environment.
- Restart the server after updating the variable.
- Confirm no middleware is transforming the request body before it reaches the route handler.

---

### Server throws `"Please add WEBHOOK_SECRET from Clerk Dashboard to .env"`

**Cause:** The `WEBHOOK_SECRET` environment variable is not defined at all.

**Fix:** Add `WEBHOOK_SECRET=whsec_...` to `.env.local` (development) or your hosting provider's environment config (production), then restart the server.

---

### `user.created` fires but no row appears in the database

**Cause:** The database operation failed silently (the handler caught the error and returned `200`).

**Fix:**

1. Check server logs for `"Error creating user:"` followed by a Prisma error message.
2. Common Prisma errors in this context:
   - `Unique constraint failed on the fields: (email)` — a user with that email already exists. This can happen if `ensureUserExists()` in `src/lib/auth.ts` created the row first.
   - `Can't reach database server` — check `DATABASE_URL` and network connectivity.

---

### `user.deleted` fails with `"Record to delete does not exist"`

**Cause:** The user row was already deleted, or it was never created (e.g., the `user.created` webhook failed earlier).

**Fix:** This is usually benign. The Prisma error is caught and logged without re-throwing. No action is required unless users are consistently missing from the database, in which case investigate `user.created` delivery failures.

---

### Webhook events are not being received in local development

**Cause:** Localhost is not reachable from Clerk's servers.

**Fix:** Use an ngrok tunnel (see [Local Development & Testing](#local-development--testing)) and update the webhook endpoint URL in the Clerk Dashboard to the ngrok URL.

---

### Profile image is not updating after `user.updated`

**Cause:** The image URL is being normalized with the same query parameters that were already present, so the `imageUrl` field value is unchanged.

**Fix:** This is expected behavior — the normalization only adjusts the `sz` and `width` query parameters. If Clerk returns a completely new image URL (e.g., after the user uploads a new profile photo), the update will be applied correctly on the next `user.updated` event.

---

## Related Files

| File                           | Purpose                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `src/app/api/webhook/route.ts` | Webhook handler — Svix verification and database sync                      |
| `src/middleware.ts`            | Lists `/api/webhook` as a public route bypassing session auth              |
| `src/lib/auth.ts`              | `ensureUserExists()` fallback for cases where the webhook hasn't fired yet |
| `prisma/schema.prisma`         | `User` model definition                                                    |
| `docs/CLERK_JWT_VALIDATION.md` | Session-based authentication flow (separate from webhooks)                 |
| `docs/CLERK_AUTH_SESSION.md`   | Clerk session lifecycle and middleware routing                             |
| `docs/ENV_VARS.md`             | Full environment variable reference including `WEBHOOK_SECRET`             |
