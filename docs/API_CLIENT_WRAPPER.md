# API Client Wrapper

## Overview

`apiFetch` is a lightweight wrapper around the native Fetch API used throughout WorkSphere.

Location:

```
src/lib/apiClient.ts
```

Its responsibilities include:

- Centralising HTTP requests.
- Detecting HTTP 429 (Too Many Requests).
- Parsing rate-limit metadata from server responses.
- Broadcasting rate-limit events to the frontend.
- Returning the original Fetch Response unchanged.

---

# Basic Usage

```ts
import { apiFetch } from "@/lib/apiClient";

const response = await apiFetch("/api/chat", {
  method: "POST",
  body: JSON.stringify(payload),
});
```

---

# HTTP 429 Handling

Whenever the server returns

```
429 Too Many Requests
```

the wrapper extracts retry information before returning the response.

Supported sources include:

- Retry-After header
- X-RateLimit-Reset header
- JSON response body

---

# Retry-After Header

The wrapper supports both formats.

## Seconds

```
Retry-After: 30
```

The user should wait 30 seconds.

## HTTP Date

```
Retry-After: Wed, 21 Oct 2026 07:28:00 GMT
```

The wrapper converts the date into remaining seconds.

---

# X-RateLimit-Reset

If Retry-After is unavailable, the wrapper checks

```
X-RateLimit-Reset
```

Supported values include:

- remaining seconds (delta)
- Unix timestamp in seconds
- Unix timestamp in milliseconds (values above `1e12`)

The IETF draft `RateLimit-Reset` header is accepted as well.

---

# JSON Fallback

If no headers exist, the wrapper attempts to read

```json
{
  "retryAfter": 45
}
```

It also supports

- retry_after
- resetIn

---

# Endpoint Detection

The wrapper categorises requests into:

| Endpoint | Detection (request **path** only, query string ignored) |
| -------- | ------------------------------------------------------- |
| book     | path contains `/book`, `/confirm`, or `/reservations`   |
| chat     | `/api/chat` and sub-paths                               |
| other    | everything else — tracked under its own pathname bucket (e.g. `/api/venues`) |

> Before #1732 every non-booking URL counted as `chat`, so a 429 from
> `/api/venues` disabled the chat input.

---

# Rate Limit Event

When a limit is reached, the wrapper dispatches

```
rate-limit-triggered
```

Payload

```ts
{
  retryAfter: number;            // seconds
  endpoint: "chat" | "book" | "other";
  bucket: string;                // "chat", "book" or the request pathname
  retryAt: number;               // epoch ms when requests are accepted again
  willRetry: boolean;            // apiFetch will re-send automatically
}
```

---

# Quota Tracking

Every response's `X-RateLimit-Limit` / `X-RateLimit-Remaining` /
`X-RateLimit-Reset` headers (or the IETF `RateLimit-*` equivalents) are
recorded per bucket. A 429 marks the bucket exhausted until `retryAt`; the
next non-429 response clears that block.

```ts
import { useRateLimitQuota } from "@/hooks/useRateLimit";

const { limit, remaining, usage, retryAfter, isLimited } = useRateLimitQuota("/api/venues");
// usage is 0–1 when limit and remaining are known
```

---

# Automatic Retry

Pass `retryOnRateLimit` as the third argument to wait out a 429 and re-send:

```ts
// defaults: 2 retries, wait at most 60 s per attempt
const res = await apiFetch("/api/venues?lat=1&lng=2", undefined, { retryOnRateLimit: true });

// custom limits
await apiFetch(url, init, { retryOnRateLimit: { maxRetries: 1, maxWaitSeconds: 30 } });
```

- Off by default: user-initiated mutations (bookings, chat) keep showing the
  countdown and let the user retry.
- A 429 means the server did not process the request, so re-sending is safe.
- If `Retry-After` exceeds `maxWaitSeconds`, or retries are used up, the 429
  `Response` is returned as before.
- While a bucket is known to be blocked, a retrying request waits for
  `retryAt` before hitting the server again.
- `init.signal` aborts the wait (the promise rejects with the abort reason).
- `Request` inputs are cloned per attempt so their body can be re-sent.
- The toast says "Retrying automatically in N seconds" while a retry is pending.

`EnhancedChatbot`'s venue refresh (an idempotent GET) uses this.

---

# useRateLimit Hook

Location

```
src/hooks/useRateLimit.ts
```

The hook listens for the custom event (and the tracked quota) and returns
the seconds left until requests to that endpoint are accepted.

Features:

- subscribes on mount
- unsubscribes on unmount
- updates every second, computed from a deadline — stays accurate when the
  browser throttles timers in background tabs
- stops automatically at zero

Example

```ts
const retryAfter = useRateLimit("chat");

if (retryAfter > 0) {
    return <p>Retry in {retryAfter} seconds.</p>;
}
```

---

# Event Flow

```
API Request
      │
      ▼
apiFetch()
      │
HTTP 429
      │
Parse headers
      │
Dispatch rate-limit-triggered
      │
useRateLimit()
      │
Countdown updates
      │
UI displays remaining wait time
```

---

# Example

```ts
const response = await apiFetch("/api/chat");

if (!response.ok) {
  console.error("Request failed");
}
```

---

# Notes

The wrapper does not modify successful responses.

Instead, it augments failed rate-limited responses by notifying the frontend through a browser CustomEvent while preserving the original Response object.
---

# Toast Feedback Integration

The API wrapper works together with the application's notification system to
provide feedback when users encounter rate limiting or periods of high server
traffic.

Within chat-related components, responses can surface metadata indicating
temporary congestion. Components may display a toast notification informing the
user that the request should be retried after a short delay.

Example:

```ts
if (metadata.highTraffic) {
  onShowToast?.(
    "High traffic detected. Please wait a few seconds and try searching again.",
  );
}
```

This approach keeps user feedback separate from the networking layer while
allowing components
