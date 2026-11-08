"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import {
  getRateLimitQuota,
  subscribeRateLimitQuota,
  type RateLimitQuota,
} from "@/lib/apiClient";

/** Whole seconds until `deadline` (epoch ms), never negative. */
function secondsUntil(deadline: number | null): number {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/**
 * Re-renders every second until `deadline` passes. The value is derived
 * from the clock, not decremented, so it stays correct when the browser
 * throttles timers in a background tab.
 */
function useSecondsUntil(deadline: number | null): number {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!deadline || deadline <= Date.now()) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  return secondsUntil(deadline);
}

function useQuota(bucket: string): RateLimitQuota | undefined {
  return useSyncExternalStore(
    subscribeRateLimitQuota,
    () => getRateLimitQuota(bucket),
    () => undefined,
  );
}

/**
 * Seconds until requests to `endpointKey` may be retried (0 when not
 * rate-limited). Driven by the "rate-limit-triggered" event that apiFetch
 * dispatches on HTTP 429, and by the quota apiFetch tracks.
 */
export function useRateLimit(endpointKey: "chat" | "book"): number {
  const [eventDeadline, setEventDeadline] = useState<number | null>(null);
  const quota = useQuota(endpointKey);

  useEffect(() => {
    const handleRateLimit = (e: Event) => {
      const detail = (e as CustomEvent<{ retryAfter: number; endpoint: string; retryAt?: number }>)
        .detail;
      if (detail && detail.endpoint === endpointKey) {
        setEventDeadline(detail.retryAt ?? Date.now() + detail.retryAfter * 1000);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("rate-limit-triggered", handleRateLimit);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("rate-limit-triggered", handleRateLimit);
      }
    };
  }, [endpointKey]);

  const deadline = Math.max(eventDeadline ?? 0, quota?.retryAt ?? 0) || null;
  return useSecondsUntil(deadline);
}

export interface RateLimitQuotaStatus {
  /** Requests allowed per window, if the server reports it. */
  limit: number | null;
  /** Requests left in the current window, if known. */
  remaining: number | null;
  /** Fraction of the quota used (0–1), when limit and remaining are known. */
  usage: number | null;
  /** Epoch ms when the window resets, if known. */
  resetAt: number | null;
  /** Seconds until requests are accepted again (0 when not limited). */
  retryAfter: number;
  isLimited: boolean;
}

/**
 * Live API quota for a bucket: "chat", "book", or a request pathname such
 * as "/api/venues". Reads the X-RateLimit-* / RateLimit-* headers that
 * apiFetch records on every response (#1732).
 */
export function useRateLimitQuota(bucket: string): RateLimitQuotaStatus {
  const quota = useQuota(bucket);
  const retryAfter = useSecondsUntil(quota?.retryAt ?? null);

  const limit = quota?.limit ?? null;
  const remaining = quota?.remaining ?? null;
  const usage =
    limit !== null && remaining !== null && limit > 0
      ? Math.min(1, Math.max(0, (limit - remaining) / limit))
      : null;

  return {
    limit,
    remaining,
    usage,
    resetAt: quota?.resetAt ?? null,
    retryAfter,
    isLimited: retryAfter > 0,
  };
}
