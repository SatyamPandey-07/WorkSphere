# WorkSphere Webhooks API Reference

This document describes how WorkSphere delivers webhook payloads, how signatures are verified, how retries behave, and what happens when delivery ultimately fails.

It covers the webhook delivery flow used by the dashboard at `/dashboard/webhooks`, the worker route at `/api/webhooks/worker`, and the Clerk user-sync endpoint at `/api/webhook`.

## Overview

WorkSphere supports two webhook-related flows:

1. **Incoming Clerk webhooks** keep local user records in sync with Clerk.
2. **Outgoing workspace webhooks** notify user-configured endpoints when workspace events occur.

Outgoing endpoints are stored in Prisma as `WebhookEndpoint` records and each delivery attempt is logged in `WebhookDeliveryLog`.

### Core database tables

```prisma
model WebhookEndpoint {
  id         String
  userId     String
  url        String
  secret     String
  eventTypes WebhookEventType[]
  isActive   Boolean
}

model WebhookDeliveryLog {
  id         String
  endpointId String
  eventType  String
  payload    Json
  status     String
  statusCode Int?
}
```

## Delivery flow

When a workspace event is emitted, WorkSphere queues it through the Redis-backed event bus. The worker then looks up all active endpoints that subscribed to the event type and dispatches the payload.

```mermaid
flowchart LR
  A[Workspace event] --> B[Redis queue]
  B --> C[/api/webhooks/worker]
  C --> D[Find active endpoints]
  D --> E[Send signed payload]
  E --> F[Write delivery log]
```

The worker currently records these delivery states:

- `DISPATCHED_TO_SVIX` when the payload is handed off to Svix successfully.
- `FAILED` when dispatching fails.
- `SKIPPED_OUTSIDE_WINDOW` when a user-level notification window blocks delivery.

## Retry policy

Webhooks use an exponential backoff policy for transient failures.

### Retry schedule

The retry policy is intentionally front-loaded so short outages recover quickly:

```text
Attempt 1: immediate
Attempt 2: after 1 minute
Attempt 3: after 5 minutes
Attempt 4: after 15 minutes
Attempt 5: after 1 hour
Attempt 6: after 6 hours
Final attempts: continue until the configured max attempt count is reached
```

### What gets retried

Retry only transient failures:

- HTTP `5xx` responses
- Network timeouts
- Connection resets
- Temporary provider outages

Do not retry permanent client failures:

- HTTP `4xx` responses caused by invalid payloads
- Missing or invalid authentication
- Unsupported webhook configuration
- Validation errors that will not succeed on replay

### Consumer response contract

Webhook consumers should return:

- `2xx` to acknowledge success.
- `4xx` to reject a payload permanently.
- `5xx` to request a retry.

If a consumer needs to intentionally stop future retries for a malformed event, it should return a non-retriable `4xx` response rather than repeatedly failing with `5xx`.

## Signature headers and payload verification

WorkSphere uses Svix-compatible signature headers for webhook verification.

### Headers

```http
svix-id: msg_123
svix-timestamp: 1234567890
svix-signature: v1,base64-signature-value
```

The verification helper expects all three headers to be present. If any are missing, the payload is rejected before signature verification begins.

### Verification algorithm

The runtime verifies the raw request body with the webhook secret using HMAC-SHA256 semantics through the `svix` package.

```ts
import { Webhook } from "svix";

const wh = new Webhook(secret);
const evt = wh.verify(rawBody, {
  "svix-id": svixId,
  "svix-timestamp": svixTimestamp,
  "svix-signature": svixSignature,
});
```

### Secret format

Webhook secrets are stored as `whsec_...` values in the `WebhookEndpoint.secret` field or in `WEBHOOK_SECRET` for the Clerk sync route.

### Verification payload example

```json
{
  "type": "REVIEW_SUBMITTED",
  "userId": "user_123",
  "timestamp": "2026-07-25T12:00:00.000Z",
  "data": {
    "venueId": "venue_abc",
    "rating": 5,
    "comment": "Great Wi-Fi and plenty of outlets"
  }
}
```

The signature is computed over the exact raw request body. Any transformation of the JSON before verification will cause the signature check to fail.

## Clerk incoming webhook route

The route at `/api/webhook` synchronizes Clerk user events into Prisma.

### Required environment variable

```env
WEBHOOK_SECRET=whsec_your_clerk_signing_secret
```

### Supported Clerk events

- `user.created`
- `user.updated`
- `user.deleted`

### Clerk verification headers

```http
svix-id: msg_123
svix-timestamp: 123456789
svix-signature: sig_123
```

### Clerk handler behavior

- `user.created` and `user.updated` are written with `prisma.user.upsert(...)`.
- `user.deleted` is removed with `prisma.user.deleteMany(...)`.
- Invalid signatures return `401 Unauthorized`.
- Missing signature headers are rejected before processing.

## Dead-letter queue handling

WorkSphere does not currently use a separate physical DLQ table or queue service.

Instead, failed delivery attempts are recorded in `WebhookDeliveryLog`, and the Redis processing queue is used to recover stale in-flight events.

### Operational DLQ behavior

When a delivery cannot be completed after retries are exhausted:

1. The failure remains visible in `WebhookDeliveryLog` with `status = FAILED`.
2. The original payload remains available in the `payload` column.
3. Operators can inspect the endpoint, status code, and event type from the dashboard.
4. The event can be replayed by re-sending the payload after correcting the endpoint or consumer bug.

### How to inspect failures

Open `/dashboard/webhooks` and review the delivery log table. The UI shows:

- Event type
- Delivery status
- HTTP status code
- Delivery time

### How to replay dropped events

Use the stored payload from `WebhookDeliveryLog.payload` and resend it after the endpoint is fixed.

For local testing, `test-webhook.js` demonstrates the worker flow and can be adapted to trigger a fresh delivery run against a configured endpoint.

## Example endpoint configuration

```env
DATABASE_URL="postgresql://username:password@localhost:5432/worksphere"
WEBHOOK_SECRET="whsec_your_secret"
```

```ts
const endpoint = {
  url: "https://example.com/webhooks/worksphere",
  secret: "whsec_abcdefghijklmnopqrstuvwxyz",
  eventTypes: ["REVIEW_SUBMITTED", "VENUE_CREATED"],
  isActive: true,
};
```

## Troubleshooting

### Signature verification fails

Check these first:

- The raw request body must be preserved until verification completes.
- `svix-id`, `svix-timestamp`, and `svix-signature` must all be present.
- The secret must match the endpoint that sent the request.
- The request must not be reformatted or re-serialized before verification.

### Delivery is accepted but nothing is logged

Confirm that:

- The endpoint is active.
- The endpoint subscribed to the event type.
- The worker route ran successfully.
- The Redis queue was reachable.

### Endpoint appears stuck

If a payload keeps failing, inspect the delivery log and fix the consumer first. Once the consumer returns `2xx`, the next replay should succeed.

## Related files

- [`src/app/api/webhook/route.ts`](../src/app/api/webhook/route.ts)
- [`src/app/api/webhooks/worker/route.ts`](../src/app/api/webhooks/worker/route.ts)
- [`src/app/dashboard/webhooks/actions.ts`](../src/app/dashboard/webhooks/actions.ts)
- [`src/components/webhooks/DeliveryLogs.tsx`](../src/components/webhooks/DeliveryLogs.tsx)
- [`src/lib/webhook/verify.ts`](../src/lib/webhook/verify.ts)
- [`prisma/schema.prisma`](../prisma/schema.prisma)
