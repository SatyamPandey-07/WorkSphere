# Client-Side Core Web Vitals Token-Bucket Reporting Specification

This specification documents WorkSphere's client-side Core Web Vitals and diagnostic performance telemetry collection, cookie consent requirements, deterministic session sampling, device categorization, payload schema, and server-side token-bucket rate limiting.

---

## 1. Overview and Data Flow

WorkSphere collects real-world user performance telemetry directly from production client browsers to monitor user experience, detect layout shifts, identify interaction bottlenecks, and prioritize performance optimizations across venues and collaborative features.

### Architecture & Pipeline Overview

```
[ User Browser / Web App ]
          │
          ▼
[ web-vitals Library ] ──(onCLS, onINP, onLCP, onFCP, onTTFB)──┐
          │                                                    │
          ▼                                                    ▼
[ Cookie Consent Check ]                           [ PerformanceObserver ]
  - Storage: localStorage                                      │
  - Key: "worksphere-cookie-consent"                           │
  - Required Value: "granted"                                  │
          │                                                    │
          ▼ (Granted)                                          │
[ Session Sampling ]                                           │
  - Key: "worksphere:web-vitals:sample"                        │
  - Rate: 20% (DEFAULT_WEB_VITALS_SAMPLE_RATE = 0.2)           │
          │                                                    │
          ▼ (Sampled)                                          │
[ WebVitalsPayload Construction ] ◄────────────────────────────┘
  - name: CLS | INP | LCP | FCP | TTFB
  - value, rating, navigationType, deviceType
  - Max Body Size: 2,048 bytes
          │
          ▼
[ Transport Dispatcher ]
  - Primary: navigator.sendBeacon (application/json Blob)
  - Fallback: fetch(..., { method: "POST", keepalive: true, credentials: "omit" })
          │
          ▼
[ Ingestion Endpoint: POST /api/telemetry/vitals ]
          │
          ├──► [ Rate Limiter: Token Bucket ]
          │      - Tier: RATE_TIERS.telemetry (120 req/min)
          │      - Refill: 2 tokens/sec (120 tokens / 60,000 ms)
          │      - Identity: Client IP (X-Real-IP -> CF-Connecting-IP -> X-Forwarded-For)
          │      - Exceeded: 429 Too Many Requests + Retry-After
          │
          ├──► [ Content-Type & Size Validation ]
          │      - Content-Type: application/json (415 if mismatched)
          │      - Max Body: 2,048 bytes (413 Payload Too Large)
          │
          ├──► [ Zod Schema Validation ]
          │      - Strict schema (rejects arbitrary properties) -> 400 Bad Request
          │
          ▼ (Accepted)
[ Response: HTTP 202 Accepted { accepted: true } ]
          │
          ▼
[ Analytics Sink: trackEvent("web_vital_reported", metric) ]
```

### Component Roles & Locations

| Component | Source Path | Role | Execution Environment |
| :--- | :--- | :--- | :--- |
| **`webVitalsReporter`** | `src/lib/telemetry/webVitalsReporter.ts` | Listens to browser performance observers via `web-vitals`, checks consent, enforces session sampling, constructs sanitized payloads, and dispatches via beacon/fetch. | Client Browser |
| **`WebVitalsReporter` (React Component)** | `src/components/analytics/WebVitalsReporter.tsx` | Next.js root layout wrapper (`src/app/layout.tsx`) that mounts and unmounts the reporter lifecycle. | React Client Component |
| **Telemetry Ingestion Route** | `src/app/api/telemetry/vitals/route.ts` | Next.js API route that validates payload schema, enforces token-bucket rate limiting (120 req/min), bounds payload memory to 2,048 bytes, and logs events. | Serverless / Node.js Runtime |
| **Token Bucket Engine** | `src/lib/rateLimit/limiters/tokenBucketLimiter.ts` | Multi-tier token-bucket rate limiter backed by Upstash Redis with atomic Lua scripts or an in-memory sliding-window fallback. | Server / Distributed Redis |

---

## 2. Metric Definitions and Thresholds

WorkSphere captures five performance metrics. Three are official **Core Web Vitals** (measuring loading, interactivity, and visual stability), while two are **Diagnostic Metrics** that assist in root-cause analysis.

### Performance Metrics Comparison Matrix

| Metric | Full Name | Metric Classification | What It Measures | Good Threshold | Needs Improvement | Poor Threshold | Unit | Collection Event |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **LCP** | Largest Contentful Paint | **Core Web Vital** | Main content perceived loading speed | $\le 2,500\,\text{ms}$ | $2,500\text{–}4,000\,\text{ms}$ | $> 4,000\,\text{ms}$ | Milliseconds (ms) | Dispatched once the largest content element renders or page unloads |
| **INP** | Interaction to Next Paint | **Core Web Vital** | Overall page responsiveness to user interactions | $\le 200\,\text{ms}$ | $200\text{–}500\,\text{ms}$ | $> 500\,\text{ms}$ | Milliseconds (ms) | Dispatched on page visibility change or unload (worst-case latency) |
| **CLS** | Cumulative Layout Shift | **Core Web Vital** | Visual stability and unexpected layout displacement | $\le 0.1$ | $0.1\text{–}0.25$ | $> 0.25$ | Unitless score | Calculated continuously across session lifespan, reported on unload |
| **FCP** | First Contentful Paint | *Diagnostic Metric* | Time until the browser renders the first DOM text or image | $\le 1,800\,\text{ms}$ | $1,800\text{–}3,000\,\text{ms}$ | $> 3,000\,\text{ms}$ | Milliseconds (ms) | Dispatched upon first DOM paint |
| **TTFB** | Time to First Byte | *Diagnostic Metric* | Server and network response latency | $\le 800\,\text{ms}$ | $800\text{–}1,800\,\text{ms}$ | $> 1,800\,\text{ms}$ | Milliseconds (ms) | Dispatched when response headers arrive |

> **Important Standard Distinction**: FCP and TTFB provide diagnostic context for network and render pipeline debugging. They are **not** Core Web Vitals under Google's official Web Vitals specification.

---

## 3. Reporting Intervals, Triggers, and Sampling

### Reporting Cadence and Lifecycle Triggers

- **Immediate Dispatch**: Unlike periodic aggregations that emit metrics on a fixed timer, WorkSphere's client reporter dispatches each metric as soon as the underlying `PerformanceObserver` observer produces an authoritative reading.
- **Event-Driven Reporting**:
  - `FCP` and `TTFB` fire early in the page lifecycle immediately upon availability.
  - `LCP`, `INP`, and `CLS` fire when final values stabilize or during page visibility transitions (`visibilitychange` / `pagehide`).
- **No Client-Side Batching**: Each metric produces an individual JSON payload dispatched via `sendWebVitalsPayload()`.

### Session Sampling Mechanism

To prevent telemetry traffic from overwhelming database sinks while maintaining statistical representativeness across user segments, WorkSphere utilizes **deterministic session sampling**:

```typescript
export const DEFAULT_WEB_VITALS_SAMPLE_RATE = 0.2; // 20% default sampling
const SESSION_SAMPLE_KEY = "worksphere:web-vitals:sample";
```

1. **Session Persistence**:
   The client checks `sessionStorage.getItem("worksphere:web-vitals:sample")`.
2. **Deterministic Session Decision**:
   - If previously marked `"sampled"`, all metrics in the current tab/session are collected and sent.
   - If marked `"not-sampled"`, all metric listeners are bypassed (`startWebVitalsReporter() returns false`).
   - If absent, `Math.random() < sampleRate` is rolled once, and the decision (`"sampled"` or `"not-sampled"`) is saved to `sessionStorage`.
3. **In-Memory Fallback**:
   If `sessionStorage` is blocked or unavailable (e.g., strict privacy sandbox), the decision is retained in memory (`memorySampleDecision`) to guarantee that all metrics within a single page view are treated uniformly.
4. **Suppression Conditions**:
   Telemetry submission is skipped if:
   - `options.enabled === false`
   - `PerformanceObserver` is unsupported by the browser
   - User cookie consent is denied or absent
   - The session was assigned to the un-sampled population

---

## 4. Cookie Consent Requirements

WorkSphere enforces strict privacy compliance before activating performance listeners.

### Consent Key and Storage

- **Storage Target**: Browser `localStorage`
- **Consent Key**: `worksphere-cookie-consent`
- **Permitted Consent Value**: `"granted"`

```typescript
export const WEB_VITALS_CONSENT_KEY = "worksphere:cookie-consent";

function hasWebVitalsConsent(): boolean {
  if (consentOverride !== null) return consentOverride;
  try {
    return window.localStorage.getItem(WEB_VITALS_CONSENT_KEY) === "granted";
  } catch {
    return false; // Fails closed if storage is restricted
  }
}
```

### Consent Enforcement Points

1. **Before Observer Registration**: `startWebVitalsReporter()` verifies `hasWebVitalsConsent()`. If consent is `"denied"` or missing, observers are never attached.
2. **At Event Callback Time**: When an observer fires, the `report()` callback re-verifies `hasWebVitalsConsent()`. If the user revoked consent mid-session, reporting terminates immediately.
3. **Fail-Closed Design**: If `localStorage` throws an exception (e.g. security policy blocking third-party storage), consent defaults to `false`.

---

## 5. Device Categorization

WorkSphere categorizes client hardware without reading or transmitting raw `User-Agent` strings or fingerprinting hardware components.

### Viewport Detection Rules

Device classification is evaluated dynamically using `window.innerWidth`:

```typescript
function getDeviceType(): WebVitalsDeviceType {
  try {
    const width = window.innerWidth;
    if (!Number.isFinite(width) || width <= 0) return "unknown";
    if (width < 768) return "mobile";
    if (width < 1024) return "tablet";
    return "desktop";
  } catch {
    return "unknown";
  }
}
```

| Device Category | Viewport Breakpoint Range | Description |
| :--- | :--- | :--- |
| **`mobile`** | `width < 768px` | Mobile smartphones and small compact viewports |
| **`tablet`** | `768px <= width < 1024px` | Tablets, foldables, and medium portrait screens |
| **`desktop`** | `width >= 1024px` | Laptops, desktops, and wide external displays |
| **`unknown`** | Non-finite, $\le 0$, or inaccessible | Headless browsers, restricted iframes, or non-DOM engines |

---

## 6. Token-Bucket Rate Limiting

The ingestion route (`POST /api/telemetry/vitals`) is protected by WorkSphere's token-bucket rate limiter (`src/lib/rateLimit/config.ts`).

### Rate Tier Configuration

```typescript
export const RATE_TIERS: Record<RateTierType, RateTier> = {
  telemetry: {
    name: "telemetry",
    limit: 120,          // 120 requests
    windowMs: 60_000,    // 60,000 ms (1 minute)
    interval: "1 m",
  },
};
```

### Bucket Parameters & Mathematical Refill Model

The token bucket operates with continuous refill based on elapsed time:

$$\text{Refill Rate} = \frac{\text{Limit}}{\text{Window}} = \frac{120 \text{ tokens}}{60\,\text{seconds}} = 2.0 \text{ tokens/second}$$

$$\text{Tokens}_{\text{now}} = \min\left(\text{Limit}, \; \text{Tokens}_{\text{last}} + \frac{t_{\text{now}} - t_{\text{last}}}{\text{Window}} \times \text{Limit}\right)$$

| Parameter | Implemented Value | Description |
| :--- | :--- | :--- |
| **Bucket Capacity (`limit`)** | `120 tokens` | Maximum burst capacity accommodated |
| **Window Length (`windowMs`)** | `60,000 ms` | Rolling interval duration (1 minute) |
| **Refill Rate** | `2.0 tokens/second` | Continuous refill velocity ($120 / 60\,\text{s}$) |
| **Initial Tokens** | `120 tokens` | Fresh buckets start fully saturated |
| **Consumption Cost** | `1 token / request` | Each incoming metric consumes exactly 1 token |
| **Clock Skew Protection** | `now < bucket.lastRefill` check | Resets `lastRefill` to `now` if system clock jumps backward |

### Client IP Extraction and Proxy Handling

Rate limiting is keyed on client IP via `getClientIp(request)`. To prevent IP spoofing, WorkSphere inspects headers in strict priority order:
1. Direct platform property: `request.ip`
2. Trusted reverse proxy header: `x-real-ip`
3. Cloudflare edge header: `cf-connecting-ip`
4. Standard proxy chain header: First entry of `x-forwarded-for`
5. Fallback: `"127.0.0.1"`

### Enforcement and 429 Response

When a client depletes its token balance (`Tokens < 1`):
1. **HTTP Status**: Returns `429 Too Many Requests`.
2. **Payload**: `{"error": "Too many telemetry requests"}`.
3. **Header**: Returns `Retry-After: <seconds>` indicating the number of seconds until at least 1 token is refilled:
   $$\text{Retry-After} = \max\left(1, \; \left\lceil \frac{1 - \text{Tokens}_{\text{current}}}{120} \times 60 \right\rceil\right)$$

---

## 7. Telemetry Payload Schema

### Request Transport Constraints

- **HTTP Method**: `POST`
- **Content-Type**: `application/json` (strictly enforced; non-JSON receives `415 Unsupported Media Type`)
- **Maximum Body Size**: `2,048 bytes` (`MAX_VITALS_BODY_BYTES = 2048`). Requests exceeding this limit receive `413 Payload Too Large`.
- **Stream Guard**: Streamed bodies are truncated and rejected if they stream beyond 2,048 bytes.

### Zod Validation Schema

The server validates requests using `webVitalsPayloadSchema.strict()`:

```typescript
export const webVitalsPayloadSchema = z
  .object({
    name: z.enum(["CLS", "INP", "LCP", "FCP", "TTFB"]),
    value: z.number().finite().min(0).max(1_000_000_000),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    navigationType: z.enum([
      "navigate",
      "reload",
      "back-forward",
      "back-forward-cache",
      "prerender",
      "restore",
      "soft-navigation",
      "unknown",
    ]),
    deviceType: z.enum(["mobile", "tablet", "desktop", "unknown"]),
    metricId: z.string().min(1).max(128).optional(),
    timestamp: z.number().int().positive(),
  })
  .strict();
```

### Representative Payload Example

```json
{
  "name": "LCP",
  "value": 1830.45,
  "rating": "good",
  "navigationType": "navigate",
  "deviceType": "desktop",
  "metricId": "v5-1711234567890-987654321",
  "timestamp": 1711234567890
}
```

### Schema Field Specification

| Field | Type | Required? | Constraints / Allowed Values | Description |
| :--- | :--- | :---: | :--- | :--- |
| **`name`** | `string` | **Yes** | `"CLS" \| "INP" \| "LCP" \| "FCP" \| "TTFB"` | Metric identifier |
| **`value`** | `number` | **Yes** | Finite number $\ge 0$ and $\le 10^9$ | Metric value (ms for LCP/INP/FCP/TTFB, unitless score for CLS) |
| **`rating`** | `string` | **Yes** | `"good" \| "needs-improvement" \| "poor"` | Library-evaluated qualitative score |
| **`navigationType`** | `string` | **Yes** | `"navigate" \| "reload" \| "back-forward" \| "back-forward-cache" \| "prerender" \| "restore" \| "soft-navigation" \| "unknown"` | Navigation context |
| **`deviceType`** | `string` | **Yes** | `"mobile" \| "tablet" \| "desktop" \| "unknown"` | Viewport-derived device form-factor |
| **`metricId`** | `string` | No | String length $1\text{–}128$ characters | Unique metric emission ID for deduplication |
| **`timestamp`** | `number` | **Yes** | Positive integer (Unix epoch ms) | Emission timestamp |

> **Strict Parsing (`.strict()`)**: Any extra fields (e.g. `userEmail`, `sessionId`, `token`) cause immediate schema validation rejection (`HTTP 400 Bad Request`), preventing accidental logging of PII or injection attacks.

---

## 8. Operational Guidance and Checklist

Developers configuring or troubleshooting Web Vitals telemetry should follow this verification checklist:

- [ ] **Verify Consent State**: Ensure `worksphere-cookie-consent` is set to `"granted"` in `localStorage`. In testing environments, use `setWebVitalsConsent(true)`.
- [ ] **Verify Session Sampling**: Check `sessionStorage["worksphere:web-vitals:sample"]`. For testing, set the value to `"sampled"` to force 100% telemetry capture.
- [ ] **Inspect Payload Shape**: Confirm that payloads do not include arbitrary extra properties; the server strictly enforces `.strict()`.
- [ ] **Verify Content-Type**: Ensure client requests transmit `Content-Type: application/json`.
- [ ] **Monitor 429 Statuses**: When conducting load testing, ensure clients respect `Retry-After` headers and recognize the 120 req/min limit.
- [ ] **Zero PII Guarantee**: Never attach user IDs, account credentials, or geolocation coordinates to Web Vitals payloads.
- [ ] **Monitor Server Logs**: Check Next.js console logs for `[telemetry/vitals] Request processing failed` errors.
