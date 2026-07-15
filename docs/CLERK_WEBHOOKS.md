# Clerk Webhook Integration Guide

## Overview

WorkSphere uses Clerk webhooks to keep application user records synchronized with Clerk authentication events. Incoming webhook requests are verified using Svix signatures before any database operation is performed.

This document explains:

- Configuring Clerk webhooks
- How webhook events are verified and parsed
- How user records are synchronized with the database

---

# Webhook Configuration

## Clerk Dashboard

Create a webhook endpoint in the Clerk Dashboard that points to:

```
/api/webhook
```

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

If any required header is missing, the request is rejected with a **400 Bad Request** response.

After the headers are validated, the request body is verified using the configured `WEBHOOK_SECRET`.

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

After successful verification, the webhook handler processes the received event and synchronizes user information with the application's database using Prisma.

## user.created

When a new Clerk account is created:

- User ID is stored.
- Email address is extracted.
- First and last names are saved.
- Profile image is stored.
- A fallback avatar is generated when no profile image exists.

## user.updated

When user information changes in Clerk:

- Email address is updated.
- Profile information is refreshed.
- Updated profile image replaces the previous value.

## user.deleted

When a Clerk account is removed:

- The matching database record is deleted using the Clerk user ID.

This synchronization keeps application data consistent with Clerk authentication records.

---

# Error Handling

If webhook verification fails, the request is rejected immediately and no database operation is performed.

If a database operation fails after successful verification, the error is logged without throwing an additional exception. This prevents unnecessary webhook retries while still recording the failure for debugging.

---

# Related Files

- `src/app/api/webhook/route.ts`
- `docs/CLERK_JWT_VALIDATION.md`
- `docs/ENV_VARS.md`

The webhook route contains the implementation responsible for request verification and user synchronization, while the related documentation explains authentication and environment configuration in more detail.