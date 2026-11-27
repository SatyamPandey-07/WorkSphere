# Redis Latency Status Badge (`RedisLatencyStatusBadge`)

`src/components/admin/RedisLatencyStatusBadge.tsx` renders an accessible status indicator for Redis ping round-trip latency across admin observability views.

## Latency Thresholds

| State | Latency Condition (`pingMs`) | Visual Tone | Meaning |
| :--- | :--- | :--- | :--- |
| **Healthy** | `pingMs !== null && pingMs >= 0 && pingMs < degradedThresholdMs` (default `< 50 ms`) | Emerald / green badge | Normal low-latency Redis response within SLA |
| **Degraded** | `pingMs !== null && pingMs >= degradedThresholdMs && pingMs < offlineThresholdMs` (default `50 ms` to `< 250 ms`) | Amber / yellow badge | Elevated latency or transient congestion; monitor `PING` p95/p99 |
| **Offline** | `pingMs === null`, `pingMs < 0`, `!Number.isFinite(pingMs)`, or `pingMs >= offlineThresholdMs` (default `>= 250 ms` or unreachable) | Rose / red badge | Redis ping timed out, failed, or breached the offline latency ceiling |

## Component Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `pingMs` | `number \| null \| undefined` | `null` | Latest Redis `PING` latency in milliseconds; `null`/`undefined` or non-finite values map to `offline`. |
| `degradedThresholdMs` | `number` | `50` | Lower bound in milliseconds where latency transitions from `healthy` to `degraded`. |
| `offlineThresholdMs` | `number` | `250` | Lower bound in milliseconds where latency transitions from `degraded` to `offline`. |
| `showLatencyValue` | `boolean` | `true` | Displays numeric `pingMs` alongside the status label when available. |
| `className` | `string` | `undefined` | Optional additional CSS utility classes appended to the root badge element. |

## ARIA Status Labels

* **Role & Live Region:** Rendered with `role="status"` and `aria-live="polite"` so screen readers announce threshold transitions without interrupting focus.
* **Accessible Label (`aria-label`):** Combines the status state and measured latency (for example, `"Redis status: Healthy (14 ms)"`, `"Redis status: Degraded (92 ms)"`, or `"Redis status: Offline"`).
* **Data Attributes:** Exposes `data-status="healthy" \| "degraded" \| "offline"` for styling and test queries.

## Related Diagnostics

* See [Redis Ping Latency Diagnostics](./REDIS_PING_LATENCY_DIAGNOSTICS.md) for troubleshooting high `PING` times, connection pool saturation, and network bottlenecks.
