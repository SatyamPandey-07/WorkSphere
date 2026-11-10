"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  getWebVitalRating,
  recordWebVital,
  WebVitalMetricName,
  WebVitalEntry,
} from "@/lib/webVitalsCollector";

export interface WebVitalsReporterProps {
  /** Target telemetry ingestion endpoint (defaults to "/api/admin/vitals") */
  endpoint?: string;
  /** Whether reporting is active (defaults to true) */
  enabled?: boolean;
  /** Optional callback invoked whenever a metric is evaluated and recorded */
  onMetricReported?: (metric: WebVitalEntry) => void;
}

/**
 * Global Client Web Vitals Reporter Component
 * Listens for PerformanceObserver web vitals events (LCP, INP, CLS, FCP, TTFB)
 * and records telemetry data locally and to the server API with proper lifecycle teardown.
 */
export function WebVitalsReporter({
  endpoint = "/api/admin/vitals",
  enabled = true,
  onMetricReported,
}: WebVitalsReporterProps = {}) {
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("PerformanceObserver" in window)) {
      return;
    }

    const observers: PerformanceObserver[] = [];

    const reportMetric = (
      name: WebVitalMetricName,
      value: number,
      delta: number = value
    ) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return;
      }
      const safeDelta = typeof delta === "number" && Number.isFinite(delta) ? delta : value;
      const rating = getWebVitalRating(name, value);
      const entry = recordWebVital({
        name,
        value,
        rating,
        delta: safeDelta,
        route: pathname || "/",
      });

      onMetricReported?.(entry);

      // Post metric to server endpoint asynchronously
      try {
        const payload = JSON.stringify(entry);
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon(endpoint, blob);
        } else {
          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // Ignore network failure
      }
    };

    // 1. Observe LCP (Largest Contentful Paint)
    try {
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        if (entries.length > 0) {
          const lastEntry = entries[entries.length - 1];
          reportMetric("LCP", lastEntry.startTime);
        }
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
      observers.push(lcpObserver);
    } catch {
      // Observer type not supported in browser environment
    }

    // 2. Observe CLS (Cumulative Layout Shift)
    try {
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const layoutShiftEntry = entry as any;
          if (!layoutShiftEntry.hadRecentInput && typeof layoutShiftEntry.value === "number") {
            clsValue += layoutShiftEntry.value;
          }
        }
        reportMetric("CLS", clsValue);
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
      observers.push(clsObserver);
    } catch {}

    // 3. Observe FCP (First Contentful Paint)
    try {
      const paintObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            reportMetric("FCP", entry.startTime);
          }
        }
      });
      paintObserver.observe({ type: "paint", buffered: true });
      observers.push(paintObserver);
    } catch {}

    // 4. Observe INP (Interaction to Next Paint)
    try {
      let longestInteraction = 0;
      const inpObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const duration = (entry as any).duration || 0;
          if (duration > longestInteraction) {
            longestInteraction = duration;
            reportMetric("INP", longestInteraction);
          }
        }
      });
      inpObserver.observe({ type: "event", buffered: true, durationThreshold: 16 } as any);
      observers.push(inpObserver);
    } catch {}

    // 5. Observe TTFB (Time to First Byte)
    try {
      if (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") {
        const navEntries = performance.getEntriesByType("navigation");
        if (navEntries.length > 0) {
          const nav = navEntries[0] as PerformanceNavigationTiming;
          if (nav.responseStart) {
            reportMetric("TTFB", nav.responseStart);
          }
        }
      }
    } catch {}

    return () => {
      for (const obs of observers) {
        try {
          obs.disconnect();
        } catch {
          // Ignore observer teardown errors
        }
      }
    };
  }, [pathname, endpoint, enabled, onMetricReported]);

  return null;
}

export default WebVitalsReporter;
