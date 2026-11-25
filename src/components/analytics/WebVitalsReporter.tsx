"use client";

import { useEffect, useRef } from "react";
import {
  DEFAULT_WEB_VITALS_SAMPLE_RATE,
  setWebVitalsConsent,
  startWebVitalsReporter,
  stopWebVitalsReporter,
  WEB_VITALS_CONSENT_KEY,
  type WebVitalsPayload,
} from "@/lib/telemetry/webVitalsReporter";
import { recordWebVital, type WebVitalEntry } from "@/lib/webVitalsCollector";

export interface WebVitalsReporterProps {
  endpoint?: string;
  enabled?: boolean;
  samplingRate?: number;
  onMetricReported?: (metric: WebVitalEntry) => void;
}

const CONSENT_EVENT = "worksphere:cookie-consent";

function getConfiguredSamplingRate(): number {
  const configured = process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE;
  if (configured === undefined || configured.trim() === "") {
    return DEFAULT_WEB_VITALS_SAMPLE_RATE;
  }

  const rate = Number(configured);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1
    ? rate
    : DEFAULT_WEB_VITALS_SAMPLE_RATE;
}

function readConsent(): boolean | null {
  try {
    const choice = window.localStorage.getItem(WEB_VITALS_CONSENT_KEY);
    if (choice === "granted") return true;
    if (choice === "declined") return false;
  } catch {
    return null;
  }
  return null;
}

export function WebVitalsReporter({
  endpoint = "/api/telemetry/vitals",
  enabled = process.env.NEXT_PUBLIC_WEB_VITALS_ENABLED !== "false",
  samplingRate = getConfiguredSamplingRate(),
  onMetricReported,
}: WebVitalsReporterProps = {}) {
  const callbackRef = useRef(onMetricReported);
  callbackRef.current = onMetricReported;

  useEffect(() => {
    const initialize = (consent: boolean | null) => {
      setWebVitalsConsent(consent);
      if (!consent) return;

      startWebVitalsReporter({
        endpoint,
        enabled,
        samplingRate,
        onMetricReported: (payload: WebVitalsPayload) => {
          const entry = recordWebVital({
            name: payload.name,
            value: payload.value,
            rating: payload.rating,
            delta: payload.value,
            route: window.location.pathname || "/",
          });
          callbackRef.current?.(entry);
        },
      });
    };

    initialize(readConsent());

    const handleConsentEvent = (event: Event) => {
      const choice = (event as CustomEvent<unknown>).detail;
      if (choice === "granted") initialize(true);
      if (choice === "declined") initialize(false);
    };
    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key === WEB_VITALS_CONSENT_KEY || event.key === null) {
        initialize(readConsent());
      }
    };

    window.addEventListener(CONSENT_EVENT, handleConsentEvent);
    window.addEventListener("storage", handleStorageEvent);
    return () => {
      window.removeEventListener(CONSENT_EVENT, handleConsentEvent);
      window.removeEventListener("storage", handleStorageEvent);
      stopWebVitalsReporter();
    };
  }, [enabled, endpoint, samplingRate]);

  return null;
}

export default WebVitalsReporter;
