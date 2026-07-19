
# Rate Limiting Configuration Reference

This document lists the exact rate-limit parameters configured for every rate-limited
public API route in WorkSphere, explains the sliding-window algorithm used, and
describes how the in-memory fallback behaves when Upstash Redis is not configured.

It complements `docs/RATE_LIMITING.md` (the general guide) by acting as a quick
lookup table you can check whenever you need the current numbers.

---

## 1. Route Limits (per minute)

All limits below are **requests per 60-second window, per identifier**. The
identifier is the signed-in user's Clerk `userId` when available, otherwise the
caller's IP address (read from the `x-forwarded-for` header, falling back to
`x-real-ip`).

| Route                              | Method | Limit / min | Identifier key format      |
| :---------------------------------- | :----: | :---------: | :-------------------------- |
| `/api/chat`                         | POST   | 20          | `<userId or IP>` (no prefix)|
| `/api/auth/forgot-password`         | POST   | 3           | `forgot-password:<ip>`      |
| `/api/auth/resend-otp`              | POST   | 3           | `resend-otp:<ip>`           |
| `/api/auth/reset-password`          | POST   | 5           | `reset-password:<ip>`       |
| `/api/auth/verify-otp`              | POST   | 5           | `verify-otp:<ip>`           |
| `/api/venues`                       | GET    | 120         | `venues-search:<userId or ip>` |

> **Note on `/api/venues`:** its limit is much higher than the others because
> search/autocomplete fires on nearly every keystroke. The 120/min ceiling is
> defined as a named constant (`VENUE_SEARCH_RATE_LIMIT`) at the top of
> `src/app/api/venues/route.ts`, rather than a raw number, so it's easy to find
> and adjust.

> **Note on `/api/chat`:** unlike the other routes, its identifier is **not**
> prefixed with a route name — it's just the raw `userId` or IP. Keep this in
> mind if you ever add another route that reuses the same identifier value, since
> they would currently share the same rate-limit bucket.

---

## 2. Sliding Window Algorithm

Every route above is enforced by the same shared helper: `rateLimit()` in
`src/lib/rateLimit.ts`. It behaves differently depending on whether Upstash is
configured:

- **With Upstash configured:** uses Upstash's built-in
  `Ratelimit.slidingWindow(limitPerMinute, "1 m")` algorithm. This smooths out
  bursts over a rolling 60-second window rather than resetting sharply every
  minute (e.g. it prevents someone from firing all their requests at 0:59 and
  again at 1:00 to effectively double their quota).
- **Without Upstash configured (in-memory fallback):** uses a simpler
  **fixed window** counter, not a true sliding window. It tracks a `count` and a
  `resetTime` per identifier in a `Map`. The first request in a window sets
  `resetTime = now + 60_000ms`; every request after that increments `count`
  until `resetTime` passes, at which point the window resets to 1. A background
  timer (`cleanupExpiredEntries`) sweeps expired entries every 60 seconds so the
  in-memory `Map` doesn't grow forever.

So in production (Upstash configured) you get true sliding-window smoothing; in
local development (no Upstash env vars) you get a simpler fixed-window
approximation — both enforce the same numeric limits, but the in-memory version
is slightly more permissive around window boundaries.

---

## 3. Upstash Environment Keys

Two environment variables control whether Upstash Redis is used at all. Both
must be set, or the app silently falls back to in-memory limiting:

```env
UPSTASH_REDIS_REST_URL="https://your-database-endpoint.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your_upstash_rest_token_here"
```

- These are read directly in `getUpstashRatelimit()` in `src/lib/rateLimit.ts`.
- If either variable is missing or empty, `getUpstashRatelimit()` returns `null`
  immediately and every call to `rateLimit()` uses the in-memory path instead.
- The Upstash client/limiter objects are created lazily (only on the first
  request that needs them) and then cached per-limit-value in the
  `upstashLimiters` map, so the Redis connection isn't re-created on every
  request.
- All Upstash keys are stored under the Redis key prefix `worksphere:ratelimit`,
  keeping them isolated from any other data in the same Redis database.

---

## 4. In-Memory Fallback Behavior — Summary

Use this fallback for **local development only**. It is not shared across
serverless instances, so on platforms like Vercel where each request can hit a
different instance, the in-memory counts will not stay consistent — this is why
Upstash is required for production.

Key characteristics:

- Stored in two in-process `Map`s: `memStore` (count + resetTime) and
  `rateLimitInfoStore` (used for building `Retry-After` responses).
- Window length is fixed at `WINDOW_MS = 60_000` (60 seconds).
- Cleared automatically by a background interval every 60 seconds, so memory
  usage doesn't grow with traffic.
- Can be manually cleared in tests via `resetRateLimit(identifier)` (clears one
  key) or `resetRateLimit()` with no argument (clears everything).