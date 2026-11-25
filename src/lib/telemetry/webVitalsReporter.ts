import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

export const DEFAULT_WEB_VITALS_SAMPLE_RATE = 0.2;
export const WEB_VITALS_CONSENT_KEY = "worksphere-cookie-consent";
const SESSION_SAMPLE_KEY = "worksphere:web-vitals:sample";
const METRIC_NAMES = new Set(["CLS", "INP", "LCP", "FCP", "TTFB"]);
const RATINGS = new Set(["good", "needs-improvement", "poor"]);
const NAVIGATION_TYPES = new Set([
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
  "soft-navigation",
  "unknown",
]);

export type WebVitalsMetricName = "CLS" | "INP" | "LCP" | "FCP" | "TTFB";
export type WebVitalsRating = "good" | "needs-improvement" | "poor";
export type WebVitalsDeviceType = "mobile" | "tablet" | "desktop" | "unknown";
export type WebVitalsNavigationType =
  | "navigate"
  | "reload"
  | "back-forward"
  | "back-forward-cache"
  | "prerender"
  | "restore"
  | "soft-navigation"
  | "unknown";

export interface WebVitalsPayload {
  name: WebVitalsMetricName;
  value: number;
  rating: WebVitalsRating;
  navigationType: WebVitalsNavigationType;
  deviceType: WebVitalsDeviceType;
  metricId?: string;
  timestamp: number;
}

export interface WebVitalsReporterOptions {
  enabled?: boolean;
  endpoint?: string;
  samplingRate?: number;
  onMetricReported?: (payload: WebVitalsPayload) => void;
}

let registeredWindows = new WeakSet<Window>();
let memorySampleDecision: boolean | undefined;
let consentOverride: boolean | null = null;
let reportingEnabled = false;

export function setWebVitalsConsent(granted: boolean | null): void {
  consentOverride = granted;
}

function hasWebVitalsConsent(): boolean {
  if (consentOverride !== null) return consentOverride;
  try {
    return window.localStorage.getItem(WEB_VITALS_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

function normalizedSampleRate(sampleRate: number | undefined): number {
  if (
    sampleRate === undefined ||
    !Number.isFinite(sampleRate) ||
    sampleRate < 0 ||
    sampleRate > 1
  ) {
    return DEFAULT_WEB_VITALS_SAMPLE_RATE;
  }
  return sampleRate;
}

export function getSessionSamplingDecision(
  sampleRate = DEFAULT_WEB_VITALS_SAMPLE_RATE,
): boolean {
  if (typeof window === "undefined") return false;
  if (memorySampleDecision !== undefined) return memorySampleDecision;

  try {
    const stored = window.sessionStorage.getItem(SESSION_SAMPLE_KEY);
    if (stored === "sampled" || stored === "not-sampled") {
      memorySampleDecision = stored === "sampled";
      return memorySampleDecision;
    }
  } catch {
    // Keep the decision in memory when session storage is restricted.
  }

  const rate = normalizedSampleRate(sampleRate);
  memorySampleDecision = rate >= 1 || (rate > 0 && Math.random() < rate);

  try {
    window.sessionStorage.setItem(
      SESSION_SAMPLE_KEY,
      memorySampleDecision ? "sampled" : "not-sampled",
    );
  } catch {
    // The in-memory decision remains consistent for this page session.
  }

  return memorySampleDecision;
}

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

function getNavigationType(metricType: unknown): WebVitalsNavigationType {
  if (typeof metricType === "string" && NAVIGATION_TYPES.has(metricType)) {
    return metricType as WebVitalsNavigationType;
  }

  try {
    const entries = window.performance?.getEntriesByType("navigation");
    const entry = entries?.[0] as PerformanceNavigationTiming | undefined;
    if (entry?.type === "back_forward") return "back-forward";
    if (entry?.type && NAVIGATION_TYPES.has(entry.type)) {
      return entry.type as WebVitalsNavigationType;
    }
  } catch {
    // Unknown is an explicit, safe value when navigation timing is unavailable.
  }

  return "unknown";
}

export function createWebVitalsPayload(
  metric: unknown,
): WebVitalsPayload | null {
  if (!metric || typeof metric !== "object") return null;
  const candidate = metric as Record<string, unknown>;
  if (
    typeof candidate.name !== "string" ||
    !METRIC_NAMES.has(candidate.name) ||
    typeof candidate.value !== "number" ||
    !Number.isFinite(candidate.value) ||
    candidate.value < 0 ||
    typeof candidate.rating !== "string" ||
    !RATINGS.has(candidate.rating)
  ) {
    return null;
  }

  const metricId =
    typeof candidate.id === "string" && candidate.id.length > 0
      ? candidate.id.slice(0, 128)
      : undefined;

  return {
    name: candidate.name as WebVitalsMetricName,
    value: candidate.value,
    rating: candidate.rating as WebVitalsRating,
    navigationType: getNavigationType(candidate.navigationType),
    deviceType: getDeviceType(),
    ...(metricId ? { metricId } : {}),
    timestamp: Date.now(),
  };
}

export function sendWebVitalsPayload(
  payload: WebVitalsPayload,
  endpoint = "/api/telemetry/vitals",
): void {
  if (typeof window === "undefined") return;

  const body = JSON.stringify(payload);
  const browserNavigator = typeof navigator === "undefined" ? null : navigator;

  try {
    if (
      browserNavigator &&
      typeof browserNavigator.sendBeacon === "function" &&
      typeof Blob !== "undefined"
    ) {
      const accepted = browserNavigator.sendBeacon(
        endpoint,
        new Blob([body], { type: "application/json" }),
      );
      if (accepted) return;
    }
  } catch {
    // Fall through to fetch if beacon setup or submission fails.
  }

  try {
    if (typeof fetch !== "function") return;
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // Transport failures must not affect application behavior.
  }
}

export function startWebVitalsReporter(
  options: WebVitalsReporterOptions = {},
): boolean {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    typeof window.PerformanceObserver === "undefined" ||
    options.enabled === false ||
    !hasWebVitalsConsent() ||
    !getSessionSamplingDecision(options.samplingRate)
  ) {
    return false;
  }

  reportingEnabled = true;
  if (registeredWindows.has(window)) return false;
  registeredWindows.add(window);

  const report = (metric: Metric) => {
    if (!reportingEnabled || !hasWebVitalsConsent()) return;
    const payload = createWebVitalsPayload(metric);
    if (!payload) return;

    try {
      options.onMetricReported?.(payload);
    } catch {
      // Optional local observers must not interrupt telemetry delivery.
    }
    sendWebVitalsPayload(payload, options.endpoint);
  };

  const observers = [onCLS, onINP, onLCP, onFCP, onTTFB] as const;
  for (const register of observers) {
    try {
      register(report);
    } catch {
      // A missing or unsupported browser entry type should not break startup.
    }
  }

  return true;
}

export function stopWebVitalsReporter(): void {
  reportingEnabled = false;
}

export function resetWebVitalsReporterForTests(): void {
  registeredWindows = new WeakSet<Window>();
  memorySampleDecision = undefined;
  consentOverride = null;
  reportingEnabled = false;
}
