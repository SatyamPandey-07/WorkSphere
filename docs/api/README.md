# WorkSphere API Documentation

## Rate Limiting & Quotas

WorkSphere enforces per-client / per-key rate limits using Redis token buckets (`src/lib/rateLimit.ts`). When a bucket is exhausted, API endpoints respond with HTTP `429 Too Many Requests` and include standard rate-limit headers so clients can back off cleanly without hammering the server.

### HTTP Headers Returned on `429 Too Many Requests`

| Header | Type | Description |
| :--- | :--- | :--- |
| `X-RateLimit-Limit` | Integer | Maximum number of requests permitted in the active rate-limit window / bucket capacity. |
| `X-RateLimit-Remaining` | Integer | Remaining requests available in the current window (`0` when throttled with `429`). |
| `X-RateLimit-Reset` | Integer / Epoch Seconds | Unix timestamp (in seconds) when the rate-limit window or bucket refill resets. |
| `Retry-After` | Integer (seconds) or HTTP-date | Recommended wait time before retrying a `429` request—either seconds until retry or an HTTP date string (`IMF-fixdate`). |

### TypeScript / JavaScript Example: Parsing `Retry-After` & Exponential Backoff

```typescript
export interface RetryAfterOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  nowMs?: () => number;
}

export function parseRetryAfterMs(
  retryAfterHeader: string | null,
  resetHeader?: string | null,
  nowMs: () => number = () => Date.now()
): number | null {
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    if (/^\d+$/.test(trimmed)) {
      return Math.max(0, Number(trimmed) * 1000);
    }
    const parsedDateMs = Date.parse(trimmed);
    if (!Number.isNaN(parsedDateMs)) {
      return Math.max(0, parsedDateMs - nowMs());
    }
  }

  if (resetHeader && /^\d+$/.test(resetHeader.trim())) {
    const resetEpochMs = Number(resetHeader.trim()) * 1000;
    return Math.max(0, resetEpochMs - nowMs());
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRateLimitBackoff(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: RetryAfterOptions = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const nowMs = options.nowMs ?? (() => Date.now());

  let attempt = 0;

  while (true) {
    const response = await fetch(input, init);
    if (response.status !== 429 || attempt >= maxRetries) {
      return response;
    }

    const headerDelayMs = parseRetryAfterMs(
      response.headers.get('Retry-After'),
      response.headers.get('X-RateLimit-Reset'),
      nowMs
    );

    const expBackoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const jitterMs = Math.floor(Math.random() * 250);
    const delayMs = Math.min(
      maxDelayMs,
      (headerDelayMs !== null ? Math.max(headerDelayMs, expBackoffMs) : expBackoffMs) +
        jitterMs
    );

    attempt += 1;
    await sleep(delayMs);
  }
}
#!/usr/bin/env bash
set -euo pipefail

URL="[https://api.worksphere.example/v1/venues](https://api.worksphere.example/v1/venues)"
MAX_ATTEMPTS=4
attempt=1

while true; do
  hdr_file="$(mktemp)"
  body_file="$(mktemp)"

  status=$(curl -sS -D "$hdr_file" -o "$body_file" -w "\%{http_code}" "$URL")

  if [[ "$status" != "429" ]]; then
    echo "HTTP $status"
    cat "$body_file"
    rm -f "$hdr_file" "$body_file"
    break
  fi

  limit=$(grep -i '^X-RateLimit-Limit:' "$hdr_file" | awk '{print $2}' | tr -d '\r')
  remaining=$(grep -i '^X-RateLimit-Remaining:' "$hdr_file" | awk '{print $2}' | tr -d '\r')
  reset=$(grep -i '^X-RateLimit-Reset:' "$hdr_file" | awk '{print $2}' | tr -d '\r')
  retry_after=$(grep -i '^Retry-After:' "$hdr_file" | cut -d':' -f2- | xargs | tr -d '\r')

  rm -f "$hdr_file" "$body_file"

  if (( attempt >= MAX_ATTEMPTS )); then
    echo "Rate limited (429) after $attempt attempts (limit=$limit, remaining=$remaining, reset=$reset)" >&2
    exit 1
  fi

  if [[ "$retry_after" =~ ^[0-9]+$ ]]; then
    wait_sec="$retry_after"
  else
    wait_sec=$(( 2 ** (attempt - 1) ))
  fi

  echo "429 received (limit=$limit, remaining=$remaining, reset=$reset). Sleeping ${wait_sec}s before retry #$attempt..."
  sleep "$wait_sec"
  attempt=$((attempt + 1))
done

## Related Guides

- [Smart Desk Sensor Telemetry Payload Specification & Protobuf Definitions](../iot/TELEMETRY_PAYLOAD_SPEC.md) — JSON schemas, Protocol Buffers binary envelope, HMAC-SHA256 signature verification (`X-WorkSphere-Signature`), timestamp replay window, and electrical power anomaly thresholds.
- [Solana Escrow Settlement and Refund Runbook](../solana/ESCROW_SETTLEMENT_RUNBOOK.md) — escrow lifecycle, confirmation levels, refunds, and RPC failover for crypto seat deposits.
- [Seat Hold Lease Extension API](./SEAT_HOLD_LEASE_EXTENSION.md) — extend a checkout seat hold once by five minutes using the holder's fencing token; request, errors, Redis key and sequence diagram.
- [Spatial Geo-Query Guide](../search/SPATIAL_GEO_QUERY_GUIDE.md) — coordinate schema, bounding-box and radius search geometry, Haversine and PostGIS distance, and spatial index notes.
