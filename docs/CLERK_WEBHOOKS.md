# Clerk Webhook Integration Guide

## Overview

WorkSphere uses Clerk webhooks to keep application user records synchronized with Clerk authentication events. Incoming webhook requests are verified using Svix signatures before any database operation is performed.

This document explains:

- Configuring Clerk webhooks
- How webhook events are verified and parsed
- How user records are synchronized with the database
- Handling edge cases in `user.updated` events (null, empty, or unresolvable `email_addresses`)
- Error handling and logging behavior

---

# Webhook Configuration

## Clerk Dashboard

Create a webhook endpoint in the Clerk Dashboard that points to:

```
/api/webhooks
```
*(or `/api/webhook`)*

Enable the following events:

- `user.created`
- `user.updated`
- `user.deleted`

After creating the webhook, copy the **Webhook Secret** and store it securely as an environment variable.

## Required Environment Variable

```
WEBHOOK_SECRET=<your_clerk_webhook_secret>
```

The webhook route uses this secret to verify that every incoming request was sent by Clerk before processing the payload.

---

# Event Parsing

When Clerk sends a webhook request, the application first extracts the required Svix headers:

- `svix-id`
- `svix-timestamp`
- `svix-signature`

If any required header is missing, the request is rejected with a **401 Unauthorized** / **400 Bad Request** response.

After the headers are validated, the request body is verified using the configured `WEBHOOK_SECRET` via `verifyWebhookPayload()`.

Example verification flow:

```text
Incoming Request
        │
        ▼
Read Svix Headers
        │
        ▼
Verify Signature
        │
        ▼
Parse Webhook Event
        │
        ▼
Process Supported Event
```

Only requests that pass signature verification continue to the event handling stage.

---

# Database Synchronization

After successful verification, the webhook handler (`src/app/api/webhooks/route.ts`) processes the received event and synchronizes user information with the application's database using Prisma.

## user.created

When a new Clerk account is created:

- User ID (`id`) is stored.
- Primary email address is resolved from `email_addresses`.
- First and last names are saved.
- Profile image (`image_url`) is stored, applying size optimization (`sz=150` / `width=150`) or generating an initials-based avatar fallback.
- The user is upserted into the Prisma database.

## user.updated

When user information changes in Clerk:

- The handler extracts `id`, `email_addresses`, `first_name`, `last_name`, and `image_url` from `evt.data`.
- Email resolution executes safe navigation across `email_addresses`.
- User profile data is upserted in the database with Prisma.

---

# Processing `user.updated` with Missing, Null, or Empty Email Addresses

In production, Clerk webhooks can deliver payloads where the email address list is modified, removed, or temporarily empty (for example, when a user signs up strictly via SMS/phone number, WebAuthn passkey, or when an email address is deleted during account updates).

### 1. How Email Information is Extracted

The handler in `src/app/api/webhooks/route.ts` resolves the user's email using optional chaining and array lookups:

```typescript
const email =
  email_addresses?.find(
    (email: any) => email.id === (evt.data as any).primary_email_address_id,
  )?.email_address ||
  email_addresses?.[0]?.email_address ||
  null;
```

The extraction logic executes in two stages:
1. **Primary Email Match**: Attempts to match an entry in `email_addresses` whose `id` matches `primary_email_address_id`. If found, extracts `email_address`.
2. **First Element Fallback**: If no entry matches `primary_email_address_id` (or `primary_email_address_id` is null/undefined), it falls back to `email_addresses?.[0]?.email_address`.
3. **Null Default**: If both evaluations yield `undefined`, falsy, or cannot be accessed, `email` evaluates to `null`.

### 2. Payload Edge Case Behaviors

| Payload Scenario | Evaluation Result (`email`) | Prisma `user.upsert` Impact |
| :--- | :--- | :--- |
| **`email_addresses` is `null`** | Safe navigation `email_addresses?.find(...)` short-circuits to `undefined`. Fallback `email_addresses?.[0]` evaluates to `undefined`. Final result is `null`. | The database column `email` is updated to `null`. |
| **`email_addresses` is `[]` (empty array)** | `.find()` returns `undefined`. `[0]` returns `undefined`. Final result is `null`. | The database column `email` is updated to `null`. |
| **Entries lack usable `email_address`** | For example, `[{ id: "email_1", email_address: "" }]` or `[{ id: "email_1" }]`. The `.email_address` is empty string or undefined, which evaluates as falsy in `||`. Final result is `null`. | The database column `email` is updated to `null`. |
| **`primary_email_address_id` is missing or invalid** | `.find(...)` fails to match. The fallback extracts the first available entry's `email_address` (`email_addresses?.[0]?.email_address`). If `email_addresses` is empty, results in `null`. | The database column `email` is updated to the first available email address, or `null`. |

### 3. State Preservation vs. Overwrite Behavior

> [!IMPORTANT]
> **Existing Email Values Are Not Preserved If Overwritten With Null**:
> Because the webhook handler issues a Prisma `upsert`:
> ```typescript
> await prisma.user.upsert({
>   where: { id },
>   update: {
>     email,
>     firstName: first_name || null,
>     lastName: last_name || null,
>     imageUrl,
>   },
>   create: {
>     id,
>     email,
>     firstName: first_name || null,
>     lastName: last_name || null,
>     imageUrl,
>   },
> });
> ```
> When `email` evaluates to `null`, Prisma explicitly sets the `email` field to `null` in the database. The handler **does not preserve** pre-existing email strings when incoming webhook data contains an empty or null `email_addresses` array.

### 4. Prevention of Runtime Errors

The handler avoids runtime exceptions (such as `TypeError: Cannot read properties of undefined/null`) through:
- **Optional Chaining (`?.`)**: Used on `email_addresses?.find(...)` and `email_addresses?.[0]?.email_address`. If `email_addresses` is `null` or `undefined`, execution does not throw.
- **Defensive Property Access**: `first_name?.[0]` and `last_name?.[0]` safely handle missing name strings when constructing avatar initials.

---

# Error Handling & Logging

- **Database Errors**: If the Prisma `upsert` fails (e.g., database timeout, constraint collision, or connection issues), the exception is caught in `catch (error)`:
  ```typescript
  try {
    await prisma.user.upsert({ ... });
    console.log("User updated in database:", id);
  } catch (error) {
    console.error("Error updating user:", error);
  }
  ```
- **Suppressed Exceptions for Retries**: The catch block logs the error with `console.error` but does not re-throw the error, returning HTTP `200` to Svix/Clerk. This prevents webhook retry loops for non-recoverable database updates.
- **Successful Updates**: Successfully applied updates log `"User updated in database: <id>"` to standard output.

---

# Sample `user.updated` Payloads

### Example 1: `email_addresses` is an Empty Array

When a user account has no associated email addresses:

```json
{
  "data": {
    "id": "user_2aBcDeFgHiJkLmNoPqRsTuVwXyZ",
    "first_name": "Alex",
    "last_name": "Nomad",
    "email_addresses": [],
    "primary_email_address_id": null,
    "image_url": "https://img.clerk.com/eyJhbGciOi...",
    "object": "user"
  },
  "object": "event",
  "type": "user.updated"
}
```

**Expected Handling:**
1. `email_addresses?.find(...)` returns `undefined`.
2. `email_addresses?.[0]?.email_address` returns `undefined`.
3. Variable `email` resolves to `null`.
4. Prisma updates user `user_2aBcDeFgHiJkLmNoPqRsTuVwXyZ` with `email: null`.
5. Logs: `User updated in database: user_2aBcDeFgHiJkLmNoPqRsTuVwXyZ`.
6. Handler responds with HTTP `200 OK`.

---

### Example 2: `email_addresses` is Null

```json
{
  "data": {
    "id": "user_2aBcDeFgHiJkLmNoPqRsTuVwXyZ",
    "first_name": "Morgan",
    "last_name": null,
    "email_addresses": null,
    "primary_email_address_id": null,
    "image_url": null,
    "object": "user"
  },
  "object": "event",
  "type": "user.updated"
}
```

**Expected Handling:**
1. Optional chaining prevents runtime errors.
2. `email` resolves to `null`.
3. `imageUrl` resolves to generated fallback avatar (`https://ui-avatars.com/api/?name=M&background=6366f1&color=fff`).
4. Prisma updates user with `email: null` and fallback image URL.
5. Handler responds with HTTP `200 OK`.

---

# Related Files

- `src/app/api/webhooks/route.ts` - Primary Clerk webhook endpoint.
- `docs/AUTH_GUIDE.md` - Complete guide on Clerk authentication & middleware.
- `docs/CLERK_JWT_VALIDATION.md` - Technical specification for Clerk JWT validation.
- `docs/ENV_VARS.md` - Environment variables reference including `WEBHOOK_SECRET`.
