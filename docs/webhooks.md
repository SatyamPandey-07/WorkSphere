# WorkSphere Webhooks Architecture & Delivery Guide

This document describes how WorkSphere handles outbound webhook delivery, signature generation and verification, transactional outbox processing, full-jitter exponential retry backoff, dead-letter recovery, and incoming Clerk user-synchronization webhooks.

---

## 1. Overview & Architecture

WorkSphere uses a **database-backed transactional outbox pattern** to guarantee reliable, at-least-once delivery of outbound webhook events to user-configured endpoints.

Earlier designs and conceptual specifications referenced an external Redis-backed event bus and third-party Svix dispatch service. The production architecture instead uses direct, persistent PostgreSQL/Prisma database models (`WebhookOutboxEvent` and `WebhookDeliveryLog`) and native HTTP dispatching via `NotificationHttpClient` with strict SSRF validation and circuit-breaker protection.

```mermaid
flowchart TD
    A[Workspace Action / Event] -->|Create event in DB| B[(WebhookOutboxEvent\nstate: PENDING)]
    C[Cron / Worker Trigger\n/api/webhooks/worker] -->|claimDueWebhookEvents\nCompare-and-set 90s lease| B
    C -->|state: PROCESSING| D[Worker Runner]
    D -->|deliverWebhookEvent| E[deliverToEndpoint]
    E -->|isSafeWebhookUrl\nDNS & SSRF check| F{Safe Destination?}
    F -->|No / Blocked IP| G[Status: BLOCKED\nTerminal Failure]
    F -->|Yes| H[NotificationHttpClient.fetch\nredirect: manual + SSRF revalidation]
    H -->|2xx Success| I[Status: SUCCESS\nLog Delivery]
    H -->|Transient 5xx / 429 / Timeout| J[Status: FAILED\nFull-Jitter Retry]
    H -->|Terminal 4xx / Client Error| K[Status: FAILED\nTerminal Failure]
    I --> L{All Endpoints Done?}
    L -->|Yes| M[Outbox state: DELIVERED]
    J --> N{Attempts >= 5?}
    N -->|No| O[Outbox state: PENDING\nnextAttemptAt: randomized jitter]
    N -->|Yes| P[Outbox state: DEAD_LETTER\ndeadLetteredAt: now]
    G --> P
    K --> P
```

---

## 2. Core Database Schema

Webhook persistence and delivery tracking rely on three primary Prisma models defined in `prisma/schema.prisma`:

### `WebhookEndpoint`

Represents an outbound destination configured by a user to receive events.

```prisma
model WebhookEndpoint {
  id         String             @id @default(cuid())
  userId     String
  url        String
  secret     String             // Signing secret formatted as whsec_...
  eventTypes WebhookEventType[]
  isActive   Boolean            @default(true)
  headers    Json?              // Optional custom headers (e.g. X-Custom-Header)
  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @updatedAt

  user         User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  deliveryLogs WebhookDeliveryLog[]

  @@index([userId])
}
```

### `WebhookOutboxEvent`

Implements the transactional outbox queue. Each event records the event type, JSON payload, processing state, retry attempts, leased lock timestamps, and endpoint delivery tracking.

```prisma
model WebhookOutboxEvent {
  id                          String           @id
  userId                      String
  eventType                   WebhookEventType
  data                        Json
  state                       String           @default("PENDING") // PENDING | PROCESSING | DELIVERED | DEAD_LETTER
  attempts                    Int              @default(0)
  completedEndpointIds        String[]         @default([])        // Endpoints that succeeded or had terminal failures
  permanentFailureEndpointIds String[]         @default([])        // Endpoints that permanently failed
  lastError                   String?
  nextAttemptAt               DateTime         @default(now())
  lockedUntil                 DateTime?
  deadLetteredAt              DateTime?
  createdAt                   DateTime         @default(now())
  updatedAt                   DateTime         @updatedAt

  @@index([state, nextAttemptAt])
  @@index([state, lockedUntil])
}
```

### `WebhookDeliveryLog`

Maintains an immutable historical record of every single HTTP delivery attempt sent to a specific endpoint.

```prisma
model WebhookDeliveryLog {
  id         String          @id @default(cuid())
  endpointId String
  eventType  String
  payload    Json
  status     String          // SUCCESS | FAILED | BLOCKED | CIRCUIT_OPEN | SKIPPED_OUTSIDE_WINDOW
  statusCode Int?
  createdAt  DateTime        @default(now())

  endpoint WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@index([endpointId])
  @@index([createdAt])
}
```

---

## 3. Delivery Lifecycle & State Machine

The outbox pipeline progresses through four explicit lifecycle states:

| State         | Description                                                                                                                      | Transition Trigger                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PENDING`     | Event is waiting for initial dispatch or waiting for its scheduled `nextAttemptAt` retry delay.                                  | Created by application event or rescheduled after a transient failure.                               |
| `PROCESSING`  | Event is claimed by an active worker under a 90-second lease (`lockedUntil = now + 90s`).                                        | Claimed atomically by `claimDueWebhookEvents()`.                                                     |
| `DELIVERED`   | Event was successfully received and acknowledged (`2xx`) by all matching subscriber endpoints.                                   | Final worker transition when `completedEndpointIds` covers all endpoints without remaining failures. |
| `DEAD_LETTER` | Event exhausted maximum retry attempts (5) or encountered unrecoverable terminal failures (e.g. `BLOCKED` or non-transient 4xx). | Moved to `DEAD_LETTER` with `deadLetteredAt` timestamp and aggregated `lastError`.                   |

### Worker Execution Flow (`/api/webhooks/worker`)

1. **Claiming Due Events (`claimDueWebhookEvents`):**  
   The worker polls up to 100 candidate events that are either:
   - `state: "PENDING"` with `nextAttemptAt <= now()`; or
   - `state: "PROCESSING"` with expired lease `lockedUntil <= now()` (stale worker recovery).  
     Each candidate is claimed using an atomic compare-and-set update (`updateMany` where `state` and `nextAttemptAt`/`lockedUntil` match). If two workers race, exactly one worker acquires the 90-second lease (`lockedUntil`).

2. **Deduplicated Endpoint Dispatch:**  
   The worker invokes `deliverWebhookEvent(userId, eventType, data, { eventId, excludeEndpointIds: completedEndpointIds })`.  
   Any endpoint that already succeeded on a prior attempt is excluded, preventing duplicate deliveries to healthy endpoints during retries.

3. **Result Classification:**  
   Outcomes from each endpoint are evaluated:
   - Successful endpoints (`SUCCESS`) and terminal failures are appended to `completedEndpointIds`.
   - Terminal failures are also recorded in `permanentFailureEndpointIds`.
   - Transient failures trigger an exponential retry for remaining uncompleted endpoints.

---

## 4. Retry Policy & Backoff Math

Outbound webhooks utilize a **two-tier retry strategy**: immediate low-latency retries at the HTTP client layer, and distributed full-jitter exponential backoff at the outbox database layer.

### Tier 1: HTTP Client Retries (`NotificationHttpClient`)

For each individual endpoint dispatch, `NotificationHttpClient.fetch()` executes up to 2 immediate retries (`maxRetries: 2`, 3 total attempts) with a 5000ms request timeout and short jittered delays (500ms to 5000ms). If all 3 immediate HTTP attempts fail with a retryable status code (or timeout), failure is reported back to the worker.

### Tier 2: Outbox Full-Jitter Exponential Backoff (`computeWebhookRetryDelayMs`)

When an event encounters transient failures across worker runs, the outbox schedules the next attempt using **Full-Jitter Exponential Backoff** (`src/lib/events/outbox.ts`):

- **Maximum Outbox Attempts:** `WEBHOOK_OUTBOX_MAX_ATTEMPTS = 5`
- **Base Delay:** `BASE_RETRY_DELAY_MS = 60,000` ms (1 minute)
- **Maximum Delay:** `MAX_RETRY_DELAY_MS = 86,400,000` ms (24 hours)
- **Minimum Floor:** `MIN_RETRY_DELAY_MS = 1,000` ms (1 second)

#### Algorithm & Ceiling Calculation

$$\text{ceiling} = \min\left(24\text{h},\; \text{BaseDelay} \times 2^{\text{attempt} - 1}\right)$$

$$\text{delay} = \max\left(1000\text{ms},\; \lfloor \text{random}() \times \text{ceiling} \rfloor \right)$$

| Attempt   | Exponential Ceiling                   | Approximate Sampled Delay Range           |
| --------- | ------------------------------------- | ----------------------------------------- |
| Attempt 1 | Immediate dispatch                    | `0`                                       |
| Attempt 2 | $60\text{s} \times 2^0 = 60\text{s}$  | $1\text{s} - 60\text{s}$ (uniform random) |
| Attempt 3 | $60\text{s} \times 2^1 = 120\text{s}$ | $1\text{s} - 2\text{m}$ (uniform random)  |
| Attempt 4 | $60\text{s} \times 2^2 = 240\text{s}$ | $1\text{s} - 4\text{m}$ (uniform random)  |
| Attempt 5 | $60\text{s} \times 2^3 = 480\text{s}$ | $1\text{s} - 8\text{m}$ (uniform random)  |
| Exceeded  | $\ge 5$ attempts                      | Moved to `DEAD_LETTER`                    |

> [!NOTE]
> **Why Full Jitter?**  
> If an external endpoint suffers an outage and returns HTTP 503, hundreds of queued events accumulate. When the endpoint recovers, deterministic or fixed-interval retries would trigger all requests simultaneously (the "thundering herd" problem), crashing the target server again. Full jitter spreads retries uniformly across the entire backoff window, ensuring a flat request rate.

---

## 5. Transient vs. Terminal Failures

The worker categorizes delivery outcomes into transient (retryable) and terminal (permanent) failures (`src/app/api/webhooks/worker/route.ts`):

### Transient Failures (Retried)

- **HTTP 408** (Request Timeout)
- **HTTP 425** (Too Early)
- **HTTP 429** (Too Many Requests / Rate Limited)
- **HTTP 5xx** (Internal Server Error, Bad Gateway, Service Unavailable, Gateway Timeout)
- **Network Timeouts & Connection Drops** (`statusCode === null`)
- **`CIRCUIT_OPEN`** (Host failure threshold reached; circuit breaker temporarily open)

### Terminal Failures (Not Retried)

- **`BLOCKED`**: The endpoint URL or any subsequent redirect destination resolved to a forbidden private, loopback, link-local, cloud metadata, or non-HTTP address (SSRF protection).
- **HTTP 4xx Client Errors** (except 408, 425, 429), such as:
  - `400 Bad Request`
  - `401 Unauthorized` / `403 Forbidden`
  - `404 Not Found`
  - `410 Gone`
  - `422 Unprocessable Entity`
- **Redirect Loops & Excessive Hops**: Redirect chains exceeding 3 hops or encountering cyclic redirect paths.

### Notification Window Deferrals (`SKIPPED_OUTSIDE_WINDOW`)

If a recipient has configured active notification hours (e.g. 09:00 - 18:00 local time) and an event arrives outside that window, the delivery is skipped with status `SKIPPED_OUTSIDE_WINDOW`. The worker reschedules the event for 15 minutes later without incrementing the attempt count.

---

## 6. Delivery Outcomes Summary

Every delivery attempt recorded in `WebhookDeliveryLog` receives one of these canonical status values:

| Status                   | Meaning                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUCCESS`                | Endpoint responded with HTTP `2xx`. Payload accepted.                                                                                                           |
| `FAILED`                 | Endpoint responded with HTTP 4xx/5xx or timed out after client-level retries.                                                                                   |
| `BLOCKED`                | Endpoint URL or redirect destination failed SSRF safety checks (e.g. `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`, IPv6 loopback `::1`, or non-HTTP protocols). |
| `CIRCUIT_OPEN`           | Consecutive delivery failures to the destination host exceeded threshold (5 consecutive failures). Further requests are throttled for 30 seconds.               |
| `SKIPPED_OUTSIDE_WINDOW` | The recipient is currently outside their defined notification window.                                                                                           |

---

## 7. Signature Headers & Consumer Verification

Outbound payloads include Svix-compatible headers so consumers can verify authenticity and integrity using HMAC-SHA256:

### Sent Headers

```http
webhook-id: msg_clxyz12340001abc
webhook-timestamp: 1721908800
webhook-signature: v1,base64digest==
svix-id: msg_clxyz12340001abc
svix-timestamp: 1721908800
svix-signature: v1,base64digest==
user-agent: WorkSphere-Webhooks/1.0
content-type: application/json
```

### Signature Computation

The signature is computed over `${webhookId}.${timestamp}.${rawBody}` using the secret key (stripping any `whsec_` prefix):

$$\text{digest} = \text{HMAC-SHA256}\left(\text{key}, \; \text{id} \mathbin{\Vert} \text{"."} \mathbin{\Vert} \text{timestamp} \mathbin{\Vert} \text{"."} \mathbin{\Vert} \text{rawBody}\right)$$

### Consumer Verification (Node.js Example)

```ts
import { Webhook } from "svix";

const wh = new Webhook(process.env.WEBHOOK_SECRET);

export async function handleWebhook(req: Request) {
  const payload = await req.text();
  const svixId = req.headers.get("svix-id") || req.headers.get("webhook-id");
  const svixTimestamp =
    req.headers.get("svix-timestamp") || req.headers.get("webhook-timestamp");
  const svixSignature =
    req.headers.get("svix-signature") || req.headers.get("webhook-signature");

  try {
    const event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
    // Signature verified; process event
  } catch (err) {
    return new Response("Invalid signature", { status: 400 });
  }
}
```

---

## 8. Worker Authorization & Configuration

The worker endpoint at `/api/webhooks/worker` handles `GET` and `POST` triggers. It must be called periodically (e.g. once every minute via Vercel Cron or GitHub Actions):

### Authorization Headers

Requests must include a Bearer token matching either `WORKER_SECRET` or `CRON_SECRET`:

```http
Authorization: Bearer <WORKER_SECRET_OR_CRON_SECRET>
```

### Security Policy

- In production (`NODE_ENV === "production"`), the worker **fails closed (HTTP 401)** if neither `WORKER_SECRET` nor `CRON_SECRET` is configured or if the header does not match.
- Constant-time string comparisons (`crypto.timingSafeEqual`) are used to protect secrets against timing side-channel attacks.
- Outside production (development/testing), requests are permitted without authentication if `CRON_SECRET` is unset, simplifying local test execution.

### Environment Variables

```env
# Outbox worker & cron authorization
CRON_SECRET=your_long_random_cron_secret_here
WORKER_SECRET=optional_dedicated_worker_secret_here

# Database connection
DATABASE_URL=postgresql://user:password@host:5432/worksphere

# Clerk incoming webhook secret (for /api/webhook)
WEBHOOK_SECRET=whsec_your_clerk_webhook_signing_secret
```

---

## 9. Operational Troubleshooting & Database Inspection

Because the outbox is database-backed, administrators and support engineers can inspect and manage delivery state using standard Prisma queries or SQL:

### 1. Inspect Pending and Stuck Events

```ts
// Check events waiting to be delivered
const pending = await prisma.webhookOutboxEvent.findMany({
  where: { state: "PENDING" },
  orderBy: { nextAttemptAt: "asc" },
  take: 20,
});

// Check events stuck in processing (lease expired)
const stuck = await prisma.webhookOutboxEvent.findMany({
  where: {
    state: "PROCESSING",
    lockedUntil: { lte: new Date() },
  },
});
```

### 2. Inspect Dead-Letter Events

```ts
const deadLetters = await prisma.webhookOutboxEvent.findMany({
  where: { state: "DEAD_LETTER" },
  orderBy: { deadLetteredAt: "desc" },
  select: {
    id: true,
    eventType: true,
    attempts: true,
    lastError: true,
    permanentFailureEndpointIds: true,
    deadLetteredAt: true,
  },
});
```

### 3. Replay a Dead-Lettered Event

To replay a dead-lettered event after resolving an endpoint configuration or downstream outage:

```ts
await prisma.webhookOutboxEvent.update({
  where: { id: "EVENT_ID" },
  data: {
    state: "PENDING",
    attempts: 0,
    nextAttemptAt: new Date(),
    lockedUntil: null,
    deadLetteredAt: null,
    lastError: null,
    // Optionally clear permanent failures to re-deliver to all endpoints
    permanentFailureEndpointIds: [],
    completedEndpointIds: [],
  },
});
```

### 4. Trigger Worker Manually

```bash
curl -X POST https://your-domain.com/api/webhooks/worker \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

The response returns an execution summary:

```json
{
  "success": true,
  "claimed": 5,
  "delivered": 4,
  "retried": 1,
  "deadLettered": 0
}
```

---

## 10. Related Source Files

- [`src/app/api/webhooks/worker/route.ts`](../src/app/api/webhooks/worker/route.ts) — Outbox background worker implementation.
- [`src/lib/events/outbox.ts`](../src/lib/events/outbox.ts) — Event claiming, leasing, and full-jitter backoff math.
- [`src/lib/notifications/channels/webhookChannel.ts`](../src/lib/notifications/channels/webhookChannel.ts) — Webhook dispatching and signature generation.
- [`src/lib/notifications/httpClient.ts`](../src/lib/notifications/httpClient.ts) — HTTP client with SSRF revalidation, redirect control, and circuit breakers.
- [`src/lib/ssrfValidation.ts`](../src/lib/ssrfValidation.ts) — Native IP and DNS SSRF validation engine.
- [`src/lib/cronAuth.ts`](../src/lib/cronAuth.ts) — Cron and worker authorization helper.
- [`src/app/api/webhook/route.ts`](../src/app/api/webhook/route.ts) — Incoming Clerk user synchronization webhook route.
- [`prisma/schema.prisma`](../prisma/schema.prisma) — Data models for endpoints, outbox events, and delivery logs.
