# Web Vitals Metric Thresholds & Performance Telemetry Architecture

This document provides a comprehensive guide to WorkSphere's client-side performance monitoring, Core Web Vitals metric thresholds, telemetry collection engine (`src/lib/webVitalsCollector.ts`), Navigator Beacon API transmission protocols, privacy redactions, and Admin Panel Dashboard visualization (`src/components/admin/WebVitalsWidget.tsx`).

---

## Table of Contents

1. [Architectural Overview & System Goals](#1-architectural-overview--system-goals)
2. [Google Core Web Vitals & Supplemental Metric Thresholds](#2-google-core-web-vitals--supplemental-metric-thresholds)
   - [Core Web Vitals Matrix](#core-web-vitals-matrix)
   - [Supplemental Diagnostic Metrics](#supplemental-diagnostic-metrics)
3. [Client-Side Telemetry Collection Pipeline](#3-client-side-telemetry-collection-pipeline)
   - [Metric Life-Cycle & Event Attribution](#metric-life-cycle--event-attribution)
   - [Percentile Aggregation Mathematics ($p_{50}, p_{75}, p_{90}$)](#percentile-aggregation-mathematics-p_50-p_75-p_90)
4. [Beacon API Batch Transmission Protocol](#4-beacon-api-batch-transmission-protocol)
   - [Asynchronous Unload Flushes (`visibilitychange`, `pagehide`)](#asynchronous-unload-flushes-visibilitychange-pagehide)
   - [HTTP Batch Payload Schema](#http-batch-payload-schema)
5. [Privacy, Anonymization & Data Redaction Engine](#5-privacy-anonymization--data-redaction-engine)
   - [Dynamic Route Anonymization (`/venues/v_12345` $\to$ `/venues/[venueId]`)](#dynamic-route-anonymization-venuesv_12345-to-venuesvenueid)
   - [Query Parameter Stripping](#query-parameter-stripping)
   - [Zero PII & Differential Privacy Directives](#zero-pii--differential-privacy-directives)
6. [Web Vitals Validation and Clamping Architecture](#6-web-vitals-validation-and-clamping-architecture)
   - [Dual-Layer Validation Topology](#dual-layer-validation-topology)
   - [Client Validation Layer (`webVitalsReporter.ts`)](#client-validation-layer-webvitalsreporterts)
   - [Server API Route Validation Layer (`/api/telemetry/vitals`)](#server-api-route-validation-layer-apitelemetryvitals)
   - [Per-Metric Bounds and Numeric Constraints](#per-metric-bounds-and-numeric-constraints)
   - [Edge Case Handling: Non-Finite Values, Extremes, and Delta Fallback](#edge-case-handling-non-finite-values-extremes-and-delta-fallback)
   - [Clamping vs. Rejection Design Invariants](#clamping-vs-rejection-design-invariants)
   - [Validation Matrix & Concrete Input/Output Examples](#validation-matrix--concrete-inputoutput-examples)
7. [Admin System Dashboard Integration](#7-admin-system-dashboard-integration)
   - [Visual Rating Gauges & Color Tokens](#visual-rating-gauges--color-tokens)
   - [Distribution Ratios & Route Breakdowns](#distribution-ratios--route-breakdowns)
8. [Next.js App Router Setup Guide (`useReportWebVitals`)](#8-nextjs-app-router-setup-guide-usereportwebvitals)
9. [Core Web Vitals Optimization Playbook](#9-core-web-vitals-optimization-playbook)
   - [Optimizing LCP (Largest Contentful Paint)](#optimizing-lcp-largest-contentful-paint)
   - [Optimizing INP (Interaction to Next Paint)](#optimizing-inp-interaction-to-next-paint)
   - [Optimizing CLS (Cumulative Layout Shift)](#optimizing-cls-cumulative-layout-shift)

---

## 1. Architectural Overview & System Goals

Real-world user performance directly affects workspace booking conversions, interactive map search speed, and collaborative chat responsiveness. WorkSphere implements a real-user monitoring (RUM) telemetry pipeline based on Google's official Web Vitals framework.

Key Telemetry System Directives:
- **Zero UI Overhead:** Measurement hooks and Beacon API transmissions run asynchronously on background browser threads without blocking main-thread rendering.
- **Percentile-Based Evaluation:** Performance is evaluated at the $75^{\text{th}}$ percentile ($p_{75}$) across user cohorts, matching Google PageSpeed Insights and Search Console standards.
- **Privacy First:** All page paths are scrubbed of sensitive URL query strings, UUID tokens, and PII prior to payload serialization.

---

## 2. Google Core Web Vitals & Supplemental Metric Thresholds

WorkSphere categorizes real-user performance metrics into three distinct rating buckets:
- **`good` (Green):** Optimal user experience; target for $75\%$ or more of page loads.
- **`needs-improvement` (Amber):** Acceptable experience, but requires optimization.
- **`poor` (Red):** Degraded experience; triggers automated performance alerts.

### Core Web Vitals Matrix

| Metric | Metric Full Name | Unit | Good ($\le$) | Needs Improvement | Poor ($>$) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`LCP`** | Largest Contentful Paint | Milliseconds ($\text{ms}$) | **$2,500 \text{ ms}$** | $2,501 - 4,000 \text{ ms}$ | **$4,000 \text{ ms}$** |
| **`INP`** | Interaction to Next Paint | Milliseconds ($\text{ms}$) | **$200 \text{ ms}$** | $201 - 500 \text{ ms}$ | **$500 \text{ ms}$** |
| **`CLS`** | Cumulative Layout Shift | Score (Unitless) | **$0.10$** | $0.11 - 0.25$ | **$0.25$** |

### Supplemental Diagnostic Metrics

| Metric | Metric Full Name | Unit | Good ($\le$) | Needs Improvement | Poor ($>$) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`FID`** | First Input Delay *(Legacy)* | Milliseconds ($\text{ms}$) | **$100 \text{ ms}$** | $101 - 300 \text{ ms}$ | **$300 \text{ ms}$** |
| **`FCP`** | First Contentful Paint | Milliseconds ($\text{ms}$) | **$1,800 \text{ ms}$** | $1,801 - 3,000 \text{ ms}$ | **$3,000 \text{ ms}$** |
| **`TTFB`**| Time to First Byte | Milliseconds ($\text{ms}$) | **$800 \text{ ms}$** | $801 - 1,800 \text{ ms}$ | **$1,800 \text{ ms}$** |

---

## 3. Client-Side Telemetry Collection Pipeline

File: [src/lib/webVitalsCollector.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/webVitalsCollector.ts)

### Metric Life-Cycle & Event Attribution

The telemetry collector listens to browser `PerformanceObserver` events for each metric type. When a metric is finalized (e.g. `onLCP`, `onINP`, `onCLS`), it generates a `WebVitalEntry` object:

```typescript
export interface WebVitalEntry {
  id: string;                // Unique metric measurement identifier
  name: WebVitalMetricName; // "LCP" | "FID" | "INP" | "CLS" | "FCP" | "TTFB"
  value: number;            // Measured metric scalar value
  rating: WebVitalRating;   // "good" | "needs-improvement" | "poor"
  delta: number;            // Incremental change since last report
  route: string;            // Anonymized route path (e.g. "/venues/[venueId]")
  timestamp: number;        // Epoch timestamp (ms)
  navigationType?: string;  // "navigate" | "reload" | "back_forward" | "prerender"
}
```

### Percentile Aggregation Mathematics ($p_{50}, p_{75}, p_{90}$)

To prevent outlier skew from single slow network requests, metrics are sorted and aggregated into percentiles:

Given an ordered sequence of $N$ metric observations $X = [x_1, x_2, \dots, x_N]$ where $x_1 \le x_2 \le \dots \le x_N$:

$$k = \left\lceil \frac{P}{100} \times N \right\rceil - 1$$

$$p_P = x_{\max(0, \min(k, N-1))}$$

```typescript
export function calculatePercentiles(values: number[]): {
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
  count: number;
} {
  if (!values || values.length === 0) {
    return { p50: 0, p75: 0, p90: 0, min: 0, max: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;

  const getPercentile = (p: number) => {
    const idx = Math.ceil((p / 100) * count) - 1;
    return sorted[Math.max(0, Math.min(idx, count - 1))];
  };

  return {
    p50: Number(getPercentile(50).toFixed(2)),
    p75: Number(getPercentile(75).toFixed(2)),
    p90: Number(getPercentile(90).toFixed(2)),
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[count - 1].toFixed(2)),
    count,
  };
}
```

---

## 4. Beacon API Batch Transmission Protocol

### Asynchronous Unload Flushes (`visibilitychange`, `pagehide`)

Standard HTTP `fetch()` or `XMLHttpRequest` calls initiated during page unload are frequently cancelled by browser engines. WorkSphere uses `navigator.sendBeacon()` to guarantee transmission when a user navigates away or closes the browser tab.

```typescript
export function flushTelemetryBatch(metrics: WebVitalEntry[]): void {
  if (!metrics || metrics.length === 0) return;

  const payload = JSON.stringify({
    appVersion: "0.1.0",
    clientTimestamp: Date.now(),
    metrics,
  });

  const endpoint = "/api/telemetry/vitals";

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    const sent = navigator.sendBeacon(endpoint, blob);
    if (sent) return;
  }

  // Fallback to fetch with keepalive flag for environments lacking sendBeacon
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch((err) => console.error("Telemetry flush failed:", err));
}
```

### HTTP Batch Payload Schema

`POST /api/telemetry/vitals`

```json
{
  "appVersion": "0.1.0",
  "clientTimestamp": 1759687980000,
  "metrics": [
    {
      "id": "v3-1759687979102-8821940182741",
      "name": "LCP",
      "value": 1420.5,
      "rating": "good",
      "delta": 1420.5,
      "route": "/venues/[venueId]",
      "timestamp": 1759687979102,
      "navigationType": "navigate"
    },
    {
      "id": "v3-1759687979805-4410928172651",
      "name": "INP",
      "value": 85.0,
      "rating": "good",
      "delta": 85.0,
      "route": "/venues/[venueId]",
      "timestamp": 1759687979805,
      "navigationType": "navigate"
    }
  ]
}
```

---

## 5. Privacy, Anonymization & Data Redaction Engine

### Dynamic Route Anonymization (`/venues/v_12345` $\to$ `/venues/[venueId]`)

Raw window location paths contain dynamic IDs, search tokens, or sensitive parameters. The `sanitizeRoute()` function replaces concrete parameter tokens with generic route templates:

```typescript
export function sanitizeRoute(path: string): string {
  if (!path) return "/";

  // 1. Remove query string & hash fragments
  const cleanPath = path.split("?")[0].split("#")[0];

  // 2. Replace specific entity patterns
  return cleanPath
    // UUID v4 format
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    // Cuid / Prisma format (clx..., v_...)
    .replace(/\/v_[a-zA-Z0-9]+/g, "/[venueId]")
    .replace(/\/user_[a-zA-Z0-9]+/g, "/[userId]")
    .replace(/\/bk_[a-zA-Z0-9]+/g, "/[bookingId]")
    // Numeric IDs
    .replace(/\/\d+/g, "/[id]");
}
```

### Zero PII & Differential Privacy Directives

1. **No IP Recording:** Server telemetry ingestion endpoints drop client IP address headers (`X-Forwarded-For`, `Remote-Addr`).
2. **No User Authentication Association:** Telemetry logs do **not** record Clerk User IDs, session cookies, or email addresses.
3. **Client-Side Sampling:** Telemetry collection uses a $10\%$ randomized client sampling rate in high-volume production environments to minimize network bandwidth.

---

## 6. Web Vitals Validation and Clamping Architecture

Telemetry integrity is critical for calculating accurate cohort percentiles ($p_{50}, p_{75}, p_{90}$). Non-finite values, negative timings, malformed payloads, or synthetic spikes skew real-user monitoring and trigger false-positive alerts. To prevent telemetry pollution, WorkSphere enforces validation and clamping rules across two distinct layers:
1. **Client-side reporting layer:** `src/lib/telemetry/webVitalsReporter.ts` and `src/components/analytics/WebVitalsReporter.tsx`.
2. **Server-side ingestion API:** `src/app/api/telemetry/vitals/route.ts` (`/api/telemetry/vitals`).

### Dual-Layer Validation Topology

```
[Browser PerformanceObserver]
          │ (metric event: name, value, delta, id)
          ▼
┌─────────────────────────────────────────────────────────────┐
│ Client Reporter (src/lib/telemetry/webVitalsReporter.ts)     │
│ 1. typeof value === 'number'                                │
│ 2. Number.isFinite(value)                                   │
│ 3. value >= 0                                               │
│ 4. delta clamping: typeof delta === 'number' &&             │
│    Number.isFinite(delta) ? delta : value                   │
│                                                             │
│ Invalid value? ──► Dropped (returns null; no HTTP request)  │
└─────────────────────────────────────────────────────────────┘
          │ Valid metric payload
          ▼ (navigator.sendBeacon / POST /api/telemetry/vitals)
┌─────────────────────────────────────────────────────────────┐
│ Server API Route (src/app/api/telemetry/vitals/route.ts)    │
│ 1. Content-Type check (application/json)                    │
│ 2. Max Payload Size <= 2,048 bytes (HTTP 413)               │
│ 3. Rate limiting token-bucket: 120 req/min (HTTP 429)       │
│ 4. Zod strict schema parsing:                               │
│    - name: z.enum(["CLS", "INP", "LCP", "FCP", "TTFB"])     │
│    - value: z.number().finite().min(0).max(1_000_000_000)   │
│    - delta: z.number().finite().optional()                  │
│    - id: z.string().min(1).max(128)                         │
│    - route: z.string().min(1).max(512)                      │
│    - navigationType: z.string().max(64).optional()          │
│    - .strict(): Reject extra/unexpected fields              │
│                                                             │
│ Schema failure? ──► HTTP 400 Bad Request (NOT stored)       │
│ Valid?          ──► HTTP 200 { success: true } (Ingested)   │
└─────────────────────────────────────────────────────────────┘
```

### Client Validation Layer (`webVitalsReporter.ts`)

In `src/lib/telemetry/webVitalsReporter.ts`, the `createWebVitalsPayload` builder enforces pre-flight validation on raw metric inputs before constructing a network payload:

```typescript
export function createWebVitalsPayload(
  metric: Partial<WebVitalsMetricPayload>
): WebVitalsMetricPayload | null {
  const candidate = metric as WebVitalsMetricPayload;

  if (!candidate || !candidate.name || !candidate.id || !candidate.route) {
    return null;
  }

  // Value must be a valid, non-negative, finite number
  if (
    typeof candidate.value !== 'number' ||
    !Number.isFinite(candidate.value) ||
    candidate.value < 0
  ) {
    return null;
  }

  // Safe delta calculation: fallback to value if delta is missing or non-finite
  const safeDelta =
    typeof candidate.delta === 'number' && Number.isFinite(candidate.delta)
      ? candidate.delta
      : candidate.value;

  return {
    name: candidate.name,
    value: candidate.value,
    delta: safeDelta,
    id: candidate.id,
    route: candidate.route,
    navigationType: candidate.navigationType,
  };
}
```

Similarly, in `src/components/analytics/WebVitalsReporter.tsx`, `reportMetric` verifies that `value` is a finite number $\ge 0$. If invalid, execution returns immediately without allocating telemetry objects or invoking `fetch`/`sendBeacon`.

### Server API Route Validation Layer (`/api/telemetry/vitals`)

The endpoint `POST /api/telemetry/vitals` executes exhaustive request-level and field-level validation using Zod:

1. **Request Body Size Guard:**
   - Maximum allowed payload size is `2,048` bytes (`MAX_VITALS_BODY_BYTES = 2048`).
   - If the request body exceeds 2KB, the handler immediately aborts and responds with `HTTP 413 Payload Too Large` (`Payload exceeds 2KB limit`).
2. **Token Bucket Rate Limiting:**
   - 120 requests per minute per IP or identifier. Excess requests receive `HTTP 429 Too Many Requests`.
3. **Zod Strict Schema Validation:**
   ```typescript
   const WebVitalPayloadSchema = z
     .object({
       name: z.enum(["CLS", "INP", "LCP", "FCP", "TTFB"]),
       value: z.number().finite().min(0).max(1_000_000_000),
       delta: z.number().finite().optional(),
       id: z.string().min(1).max(128),
       route: z.string().min(1).max(512),
       navigationType: z.string().max(64).optional(),
     })
     .strict();
   ```
   - **`z.enum(["CLS", "INP", "LCP", "FCP", "TTFB"])`**: Only approved metric identifiers are accepted. Any other metric name (such as unsupported custom metrics or legacy `FID`) is rejected.
   - **`z.number().finite()`**: Rejects `NaN`, `+Infinity`, and `-Infinity`.
   - **`.min(0)`**: Rejects negative timing or negative layout shift values.
   - **`.max(1_000_000_000)`**: Rejects unrealistic or corrupted measurements ($> 10^9$).
   - **`.strict()`**: Disallows prototype pollution and unexpected arbitrary object properties.
   - If validation fails, the API responds with `HTTP 400 Bad Request` and body `{ error: "Invalid Web Vitals payload", details: result.error.flatten() }`. The invalid metric is **never stored or recorded**.

### Per-Metric Bounds and Numeric Constraints

WorkSphere standardizes value bounds uniformly across all supported Web Vitals at the ingestion layer, while interpreting their physical units according to each metric's specification:

| Metric | Full Metric Name | Unit | Minimum Accepted Value | Maximum Accepted Value | Valid Number Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`CLS`** | Cumulative Layout Shift | Score (Unitless) | `0.0` | `1,000,000,000` | Finite Float ($\ge 0$) |
| **`INP`** | Interaction to Next Paint | Milliseconds ($\text{ms}$) | `0.0` | `1,000,000,000` | Finite Float/Int ($\ge 0$) |
| **`LCP`** | Largest Contentful Paint | Milliseconds ($\text{ms}$) | `0.0` | `1,000,000,000` | Finite Float/Int ($\ge 0$) |
| **`FCP`** | First Contentful Paint | Milliseconds ($\text{ms}$) | `0.0` | `1,000,000,000` | Finite Float/Int ($\ge 0$) |
| **`TTFB`** | Time to First Byte | Milliseconds ($\text{ms}$) | `0.0` | `1,000,000,000` | Finite Float/Int ($\ge 0$) |

### Edge Case Handling: Non-Finite Values, Extremes, and Delta Fallback

The following rules govern edge-case inputs across client and server:

- **Negative Values (`value < 0`):**
  - *Client layer:* `createWebVitalsPayload` returns `null`. The metric is dropped client-side and never dispatched.
  - *API route:* Zod validation fails `.min(0)`. Returns `HTTP 400 Bad Request`. Value is rejected and discarded.
- **`NaN` Values:**
  - *Client layer:* `!Number.isFinite(NaN)` triggers early drop (`null`).
  - *API route:* In JSON, `NaN` is not valid JSON syntax (deserializes as parse error or fails Zod `.finite()`). Returns `HTTP 400 Bad Request`.
- **Positive & Negative Infinity (`+Infinity`, `-Infinity`):**
  - *Client layer:* `!Number.isFinite(value)` evaluates to `true`; returns `null` and is dropped.
  - *API route:* Rejected by `.finite()`. Returns `HTTP 400 Bad Request`.
- **Values Below Minimum (`value < 0`):**
  - Rejected by `.min(0)` at API layer; dropped by client.
- **Values Above Maximum (`value > 1,000,000,000`):**
  - Accepted by client reporter if finite and $\ge 0$, but **rejected** by server API with `HTTP 400 Bad Request` (`code: "too_big"`).
- **Missing or Invalid Metric Values (`undefined`, `null`, `string`, `object`):**
  - *Client layer:* `typeof value !== 'number'` check drops the metric.
  - *API route:* Rejected by Zod schema with `code: "invalid_type"`. Returns `HTTP 400 Bad Request`.
- **Delta Fallback Behavior:**
  - If `delta` is omitted, `undefined`, non-numeric, or non-finite (`NaN`, `Infinity`), the client reporter clamps/falls back `delta` to `value` (`delta = Number.isFinite(delta) ? delta : value`). On the server, `delta` is optional; if present, it must be finite.
- **Rating Fallback in Telemetry Collector (`getWebVitalRating`):**
  - In `src/lib/webVitalsCollector.ts`, if an invalid, non-finite, or negative metric value reaches `getWebVitalRating(name, value)`, the system safely defaults to `"good"` to prevent unhandled UI crashes.

### Clamping vs. Rejection Design Invariants

WorkSphere explicitly distinguishes between **clamping** and **rejection**:

1. **Rejection (Integrity Guard):**
   - Corrupt or impossible values (`value < 0`, `NaN`, `Infinity`, `value > 1,000,000,000`, unknown metric names) are **strictly rejected or dropped**, never artificially clamped to boundary minimums or maximums (e.g. negative values are **not** clamped to `0`).
   - *Rationale:* Clamping corrupt values to `0` or `1,000,000,000` would inject synthetic data points into percentile computations ($p_{75}$), skewing SLA tracking and creating false health indicators.
2. **Clamping (Fallback Safeguard):**
   - Clamping is reserved strictly for non-critical companion attributes like `delta`: if `delta` is missing or non-finite, it is safely clamped to `value` so that the primary metric measurement can still be recorded without loss of fidelity.

### Validation Matrix & Concrete Input/Output Examples

The following matrix documents real-world validation behavior across client and server layers:

| Input Metric Object | Client Layer Result (`webVitalsReporter.ts`) | Server Layer Result (`POST /api/telemetry/vitals`) | Final Ingestion Status | Reason / Explanation |
| :--- | :--- | :--- | :--- | :--- |
| `{ name: "LCP", value: 2450.5, delta: 120.0, id: "v1", route: "/venues" }` | Valid payload created | `HTTP 200 OK` `{ success: true }` | **Accepted** | Finite number within $[0, 10^9]$. |
| `{ name: "CLS", value: 0.08, id: "v2", route: "/dashboard" }` | Valid payload (delta falls back to `0.08`) | `HTTP 200 OK` `{ success: true }` | **Accepted** | CLS unitless score within bounds. Delta optional. |
| `{ name: "LCP", value: -150, id: "v3", route: "/venues" }` | Dropped (`null`, no request sent) | Direct call: `HTTP 400 Bad Request` (`too_small`) | **Rejected** | Negative timing values violate `.min(0)`. |
| `{ name: "INP", value: NaN, id: "v4", route: "/checkout" }` | Dropped (`null`, no request sent) | Direct call: `HTTP 400 Bad Request` (`invalid_type`) | **Rejected** | `NaN` fails `Number.isFinite()`. |
| `{ name: "TTFB", value: Infinity, id: "v5", route: "/api" }` | Dropped (`null`, no request sent) | Direct call: `HTTP 400 Bad Request` (`invalid_type`) | **Rejected** | Infinite timing fails `z.number().finite()`. |
| `{ name: "FCP", value: 1000000001, id: "v6", route: "/venues" }` | Payload created (sent) | `HTTP 400 Bad Request` (`too_big`) | **Rejected** | Value exceeds maximum bound of $1,000,000,000$. |
| `{ name: "FID", value: 50, id: "v7", route: "/home" }` | Dropped / Rejected | `HTTP 400 Bad Request` (`invalid_enum_value`) | **Rejected** | `FID` is excluded from server enum schema. |
| `{ name: "LCP", value: "2500", id: "v8", route: "/home" }` | Dropped (`null`, no request sent) | Direct call: `HTTP 400 Bad Request` (`invalid_type`) | **Rejected** | String representation of number is rejected without coercion. |
| `{ name: "LCP", value: 1200, delta: NaN, id: "v9", route: "/home" }` | Valid payload created (`delta` clamped to `1200`) | `HTTP 200 OK` `{ success: true }` | **Accepted** | Non-finite delta is safely replaced with metric value. |
| `{ name: "LCP", value: 1200, id: "v10", route: "/home", extra: true }` | Valid payload (without extra) | Direct call: `HTTP 400 Bad Request` (`unrecognized_keys`) | **Rejected** | Schema enforces `.strict()`, rejecting unlisted keys. |

---

## 7. Admin System Dashboard Integration

File: [src/components/admin/WebVitalsWidget.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/admin/WebVitalsWidget.tsx)

The Admin System Dashboard renders real-world Web Vitals performance distributions across routes.

### Visual Rating Gauges & Color Tokens

```typescript
function getRatingBadgeStyle(rating: WebVitalRating) {
  switch (rating) {
    case "good":
      return {
        bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        dot: "bg-emerald-400",
        label: "Good",
        color: "#10b981",
      };
    case "needs-improvement":
      return {
        bg: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        dot: "bg-amber-400",
        label: "Needs Improvement",
        color: "#f59e0b",
      };
    case "poor":
      return {
        bg: "bg-red-500/10 text-red-400 border-red-500/20",
        dot: "bg-red-400",
        label: "Poor",
        color: "#ef4444",
      };
  }
}
```

### Distribution Ratios & Route Breakdowns

For each metric, the widget displays the proportion of user samples meeting Google's thresholds:

$$\text{Good Ratio (\%)} = \left( \frac{\text{Count}(\text{rating} = \text{"good"})}{N_{\text{total}}} \right) \times 100$$

---

## 7. Next.js App Router Setup Guide (`useReportWebVitals`)

To enable automatic telemetry reporting across all Next.js routes, integrate `useReportWebVitals` inside `src/app/layout.tsx`:

```tsx
"use client";

import { useReportWebVitals } from "next/web-vitals";
import { recordWebVital, sanitizeRoute } from "@/lib/webVitalsCollector";
import { usePathname } from "next/navigation";

export function WebVitalsReporter() {
  const pathname = usePathname();

  useReportWebVitals((metric) => {
    recordWebVital({
      id: metric.id,
      name: metric.name as any,
      value: metric.value,
      rating: metric.rating as any,
      delta: metric.delta,
      route: sanitizeRoute(pathname),
      timestamp: Date.now(),
      navigationType: metric.navigationType,
    });
  });

  return null;
}
```

---

## 8. Core Web Vitals Optimization Playbook

### Optimizing LCP (Largest Contentful Paint)

- **Hero Image Preloading:** Use Next.js `<Image priority>` for above-the-fold venue photos to emit `<link rel="preload">` in HTML head.
- **Server-Side Rendering (SSR):** Ensure primary title text and hero elements are rendered in initial HTML rather than client JS hydration.
- **CDN Caching:** Serve static assets via Cloudflare / Vercel Edge Cache with `Cache-Control: public, max-age=31536000, immutable`.

### Optimizing INP (Interaction to Next Paint)

- **Main Thread Offloading:** Execute heavy tasks (such as ZKP proof generation or audio filtering) inside Web Workers (`src/workers/zkpWorker.ts`).
- **Debounced Event Handlers:** Debounce real-time venue search inputs by $150\text{ ms}$ to prevent input thread blocking.
- **React `useTransition`:** Wrap non-urgent state updates in `startTransition()` to preserve input responsiveness.

### Optimizing CLS (Cumulative Layout Shift)

- **Explicit Element Aspect Ratios:** Always define explicit `width` and `height` attributes on images, maps, and video containers.
- **Reserved Skeleton Containers:** Render skeleton loaders matching the exact dimensions of dynamically loaded venue cards to prevent layout jumps.
- **`font-display: swap`:** Load Google Web Fonts with `font-display: swap` and matching fallback font metrics to prevent Flash of Unstyled Text (FOUT).
