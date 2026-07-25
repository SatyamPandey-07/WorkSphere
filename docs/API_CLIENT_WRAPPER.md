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

- remaining seconds
- Unix timestamp

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

| Endpoint | Detection                                               |
| -------- | ------------------------------------------------------- |
| chat     | default                                                 |
| book     | URLs containing `/book`, `/confirm`, or `/reservations` |

---

# Rate Limit Event

When a limit is reached, the wrapper dispatches

```
rate-limit-triggered
```

Payload

```ts
{
  retryAfter: number;
  endpoint: "chat" | "book";
}
```

---

# useRateLimit Hook

Location

```
src/hooks/useRateLimit.ts
```

The hook listens for the custom event and stores the countdown.

Features:

- subscribes on mount
- unsubscribes on unmount
- updates every second
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
