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
6. [Admin System Dashboard Integration](#6-admin-system-dashboard-integration)
   - [Visual Rating Gauges & Color Tokens](#visual-rating-gauges--color-tokens)
   - [Distribution Ratios & Route Breakdowns](#distribution-ratios--route-breakdowns)
7. [Next.js App Router Setup Guide (`useReportWebVitals`)](#7-nextjs-app-router-setup-guide-usereportwebvitals)
8. [Core Web Vitals Optimization Playbook](#8-core-web-vitals-optimization-playbook)
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

## 6. Admin System Dashboard Integration

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
