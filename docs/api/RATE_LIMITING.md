# API Rate Limiting

This page documents the limits currently present in WorkSphere's code. It distinguishes the token-bucket middleware used on matched API routes from the separate tiered sliding-window configuration exposed by the shared rate-limit library. These are not interchangeable quotas.

## 1. Limits enforced by the API middleware

The middleware calls `matchRateTier(pathname, method)` and applies the corresponding token bucket. The configured route tiers are:

| Route class | Matching rule | Limit | Window |
|---|---|---:|---:|
| Public venue/map/search/location reads | `/api/venues*`, `/api/map*`, `/api/search*`, `/api/location*` | 60 | 1 minute |
| Authentication and CSRF issuance | `/api/auth*`, `/api/csrf`, PartyKit auth, student verification | 30 | 1 minute |
| Mutating booking and review requests | POST/PUT/PATCH/DELETE under booking or review paths | 10 | 1 minute |
| Telemetry ingestion | telemetry, noise-metrics and Wi-Fi telemetry path segments | 120 | 1 minute |

The middleware does not rate-limit OPTIONS preflight requests. It also explicitly excludes webhook, cron and health-check paths from this matcher. In particular, the `webhooks` tier below is a library configuration, not a quota currently applied by `matchRateTier`.

For a matched tier, the middleware builds an identity from the tier name and authenticated Clerk user ID, falling back to the client IP. Requests to different routes in the same tier can therefore share a caller's tier bucket.

## 2. Additional tiered sliding-window configuration

The shared rate-limit library also exports the following `TIER_CONFIGS` for callers that use `checkTieredRateLimit`:

| Tier | Limit | Window | Intended identity |
|---|---:|---:|---|
| Anonymous | 10 | 15 minutes | Client IP |
| Authenticated | 60 | 15 minutes | Clerk user ID |
| Public | 60 | 1 minute | Caller-defined |
| Admin | 120 | 1 minute | Caller-defined |
| Webhooks | 1,000 | 1 minute | Caller-defined |

These configurations do not automatically override or replace the middleware's `RATE_TIERS`. A route should only be documented as using one of these limits after it explicitly calls the tiered API.

## 3. Rate-limit response headers

A rejected middleware request returns HTTP `429 Too Many Requests` with a JSON error body and these headers:

| Header | Meaning |
|---|---|
| `Retry-After` | Seconds to wait before retrying |
| `RateLimit-Limit` | Configured request allowance |
| `RateLimit-Remaining` | Remaining requests (zero on a rejection) |
| `RateLimit-Reset` | Seconds until reset |
| `X-RateLimit-Limit` | Configured request allowance |
| `X-RateLimit-Remaining` | Remaining requests (zero on a rejection) |
| `X-RateLimit-Reset` | Reset time as a Unix timestamp in seconds |

Successful responses from the middleware also receive the `RateLimit-*` and `X-RateLimit-*` headers. The `RateLimit-Reset` value is a countdown in seconds; `X-RateLimit-Reset` is an epoch timestamp. A `Retry-After` header is sent when the request is rejected.

Clients should treat `Retry-After` as authoritative when it is present. Do not retry a failed request immediately or run an unbounded retry loop.

## 4. TypeScript retry example

This helper retries only 429 responses, honors either seconds or an HTTP-date in `Retry-After`, and uses capped exponential backoff with jitter when the header is absent.

```typescript
function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function fetchWithRateLimitRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries = 4,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(input, init);
    if (response.status !== 429 || attempt >= maxRetries) return response;

    const headerDelay = retryAfterMs(response.headers.get("Retry-After"));
    const exponentialDelay = Math.min(500 * 2 ** attempt, 8_000);
    const jitter = Math.floor(Math.random() * 250);
    await new Promise((resolve) =>
      setTimeout(resolve, (headerDelay ?? exponentialDelay) + jitter),
    );
  }
}
```

## 5. Python retry example

```python
import email.utils
import random
import time
from datetime import datetime, timezone

import requests


def retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            retry_at = email.utils.parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


def request_with_rate_limit_retry(
    session: requests.Session, method: str, url: str, *,
    max_retries: int = 4, **kwargs
) -> requests.Response:
    for attempt in range(max_retries + 1):
        response = session.request(method, url, **kwargs)
        if response.status_code != 429 or attempt == max_retries:
            return response

        delay = retry_after_seconds(response.headers.get("Retry-After"))
        if delay is None:
            delay = min(0.5 * (2 ** attempt), 8.0)
        time.sleep(delay + random.uniform(0.0, 0.25))
    raise RuntimeError("unreachable")
```

For non-429 responses, callers should follow their normal HTTP error handling. Retry only operations that are safe to repeat; use an idempotency key for retried state-changing requests.

## 6. Implementation references

- `src/lib/rateLimit/config.ts`: middleware route matching and token-bucket limits.
- `src/lib/rateLimit/index.ts`: shared rate-limit APIs and tiered sliding-window configuration.
- `src/lib/rateLimit/limiters/tokenBucketLimiter.ts`: token-bucket behavior.
- `src/lib/rateLimit/limiters/slidingWindowLimiter.ts`: sliding-window behavior.
- `src/lib/middleware/handlers/rateLimitHandler.ts`: identity selection and response headers.
- `docs/RATE_LIMITING.md` and `docs/RATE_LIMITING_CONFIG.md`: existing setup and configuration guides.

When a quota changes, update the source configuration and this page together. Verify the effective matcher before publishing a new route limit.
