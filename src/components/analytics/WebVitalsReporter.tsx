"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  getWebVitalRating,
  recordWebVital,
  WebVitalMetricName,
} from "@/lib/webVitalsCollector";

/**
 * Global Client Web Vitals Reporter Component
 * Listens for PerformanceObserver web vitals events (LCP, INP, CLS, FCP, TTFB)
 * and records telemetry data locally and to the server API.
 */
export function WebVitalsReporter() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || !("PerformanceObserver" in window)) {
      return;
    }

    const reportMetric = (
      name: WebVitalMetricName,
      value: number,
      delta: number = value
    ) => {
      const rating = getWebVitalRating(name, value);
      const entry = recordWebVital({
        name,
        value,
        rating,
        delta,
        route: pathname || "/",
      });

      // Post metric to server endpoint asynchronously
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/admin/vitals", JSON.stringify(entry));
        } else {
          fetch("/api/admin/vitals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
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
    } catch {
      // Observer type not supported in browser environment
    }

    // 2. Observe CLS (Cumulative Layout Shift)
    try {
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const layoutShiftEntry = entry as any;
          if (!layoutShiftEntry.hadRecentInput) {
            clsValue += layoutShiftEntry.value;
          }
        }
        reportMetric("CLS", clsValue);
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
    } catch {}

    // 3. Observe FCP & TTFB
    try {
      const paintObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            reportMetric("FCP", entry.startTime);
          }
        }
      });
      paintObserver.observe({ type: "paint", buffered: true });
    } catch {}

    try {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0) {
        const nav = navEntries[0] as PerformanceNavigationTiming;
        if (nav.responseStart) {
          reportMetric("TTFB", nav.responseStart);
        }
      }
    } catch {}
  }, [pathname]);

  return null;
}

export default WebVitalsReporter;
