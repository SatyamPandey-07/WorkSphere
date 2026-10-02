# CSRF Token Rotation & Double-Submit Cookie Architecture

> **Related:** [`CSRF_PROTECTION.md`](./CSRF_PROTECTION.md) — overview of the double-submit pattern  
> **Source files:** `src/middleware.ts`, `src/lib/apiClient.ts`, `src/lib/csrf.ts`

---

## 1. Token Issuance

CSRF tokens are issued by `GET /api/auth/csrf-token` and set in two places simultaneously:

1. **Signed cookie** (`csrf_token`) — HTTP-only, Secure, SameSite=Strict. The cookie value is HMAC-signed with `CSRF_SECRET` so it cannot be forged.
2. **JSON response body** (`{ csrfToken: "<raw>" }`) — the raw (unsigned) token returned to the client for use as an HTTP header value.

```
Client → GET /api/auth/csrf-token
Server → Set-Cookie: csrf_token=<signed>; HttpOnly; Secure; SameSite=Strict
         { csrfToken: "<raw>" }
```

The `raw` and `signed` values are related: `signed = HMAC-SHA256(raw, CSRF_SECRET)`. The middleware verifies the raw header against the signed cookie.

---

## 2. Request Validation (Middleware)

`src/middleware.ts` intercepts all non-GET/HEAD/OPTIONS requests to state-changing API routes:

```
Incoming mutation request
  │
  ├─ Read x-csrf-token header (raw value)
  ├─ Read csrf_token cookie (signed value)
  ├─ HMAC-verify: sign(raw) === signed?
  │     ├─ YES → forward to route handler
  │     └─ NO  → return 403 Forbidden
```

---

## 3. Token Rotation Rules

CSRF tokens are **single-use by design** — each successful mutation rotates the token:

| Trigger | Action |
|---------|--------|
| Successful state-changing request | Server issues new `Set-Cookie: csrf_token=<new-signed>` and returns new raw token in response headers |
| Token expiry (24 h) | Next mutation returns `403 { code: "CSRF_INVALID" }` — client auto-refreshes (see §4) |
| Explicit logout | Cookie cleared; next request must re-fetch |

The `CSRF-Token` response header (not the cookie) carries the new raw token after each mutation. Clients should update their in-memory token store on every successful response.

---

## 4. Client Auto-Refresh on Expiry

`src/lib/apiClient.ts` implements automatic token refresh for long-lived sessions where the 24 h cookie expires:

```typescript
// On 403 response with CSRF_INVALID code:
if (response.status === 403) {
  const data = await response.clone().json();
  if (data?.code === "CSRF_INVALID" || data?.error?.toLowerCase().includes("csrf")) {
    // Fetch fresh token from /api/auth/csrf-token
    const freshToken = await fetchCsrfToken();
    if (freshToken) {
      // Retry the original request once with the new header
      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set("x-csrf-token", freshToken);
      return fetch(input, { ...init, headers: retryHeaders });
    }
  }
}
```

---

## 5. Handling Mutation Requests in Components

```typescript
import { apiFetch } from "@/lib/apiClient";

// The token is automatically managed by apiFetch — no manual header needed.
// On session start, pre-populate the cached token:
import { fetchCsrfToken } from "@/lib/apiClient";
await fetchCsrfToken(); // caches the token in _csrfToken module variable

// Mutations use apiFetch which reads the cached token:
const response = await apiFetch("/api/venues", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "New Venue" }),
});
```

If a session is resumed after the token has expired, `apiFetch` automatically fetches a fresh token and retries the failed request — the user never sees the error.

---

## 6. Security Properties

| Property | Mechanism |
|----------|-----------|
| Forgery prevention | Cookie is HMAC-signed; raw value alone cannot produce a valid signed cookie |
| Cross-origin isolation | `SameSite=Strict` prevents the cookie from being sent in cross-origin requests |
| Replay prevention | Tokens rotate after each mutation (short-lived window) |
| XSS resilience | The HTTP-only cookie cannot be read by JavaScript; the raw token has a 24 h TTL |
