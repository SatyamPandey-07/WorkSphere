"use client";

import { TelemetryRecord } from "./telemetryQueue";

const STORAGE_KEY = "worksphere:telemetry:unsent";

export function enqueueClientTelemetry(record: TelemetryRecord) {
  flushToServer(record);
}

function persistFailed(record: TelemetryRecord) {
  if (typeof window === "undefined") return;
  try {
    const existingStr = localStorage.getItem(STORAGE_KEY);
    const existing: TelemetryRecord[] = existingStr
      ? JSON.parse(existingStr)
      : [];
    existing.push(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch (err) {
    console.error("[clientTelemetry] Failed to persist", err);
  }
}

export function retryFailedTelemetry() {
  if (typeof window === "undefined") return;
  try {
    const existingStr = localStorage.getItem(STORAGE_KEY);
    if (!existingStr) return;
    localStorage.removeItem(STORAGE_KEY);
    const records = JSON.parse(existingStr) as TelemetryRecord[];
    records.forEach(flushToServer);
  } catch (err) {
    console.error("[clientTelemetry] Failed to retry", err);
  }
}

function flushToServer(record: TelemetryRecord) {
  const url = `/api/venues/${encodeURIComponent(record.venueId)}/telemetry`;

  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    // Page is unloading or backgrounded, use sendBeacon
    const blob = new Blob([JSON.stringify(record)], {
      type: "application/json",
    });
    const success = navigator.sendBeacon(url, blob);
    if (!success) {
      persistFailed(record);
    }
  } else {
    // Normal runtime, use fetch
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(record),
      keepalive: true,
    }).catch(() => {
      persistFailed(record);
    });
  }
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      retryFailedTelemetry();
    }
  });

  // Retry on startup
  window.addEventListener("load", () => {
    retryFailedTelemetry();
  });
}
