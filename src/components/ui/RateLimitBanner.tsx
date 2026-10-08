"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Clock, AlertTriangle, X, RefreshCw, Zap } from "lucide-react";
import type { RateLimitEventDetail, RateLimitEndpoint } from "@/lib/apiClient";

export interface RateLimitBannerProps {
  className?: string;
  showDismiss?: boolean;
  onCountdownComplete?: () => void;
}

interface ActiveRateLimitState {
  initialSeconds: number;
  remainingSeconds: number;
  endpoint: RateLimitEndpoint | string;
  bucket: string;
  retryAt: number;
  willRetry: boolean;
}

function formatEndpointName(endpoint: string): string {
  if (endpoint === "chat") return "AI Assistant";
  if (endpoint === "book") return "Reservations";
  if (endpoint.startsWith("/api/")) {
    return endpoint.replace("/api/", "").replace(/\//g, " ");
  }
  return endpoint;
}

export function RateLimitBanner({
  className = "",
  showDismiss = true,
  onCountdownComplete,
}: RateLimitBannerProps) {
  const [rateLimitState, setRateLimitState] = useState<ActiveRateLimitState | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleRateLimit = useCallback((e: Event) => {
    const customEvent = e as CustomEvent<RateLimitEventDetail>;
    const detail = customEvent.detail;
    if (!detail) return;

    const retrySeconds = Math.max(1, Math.ceil(detail.retryAfter || 60));
    const targetRetryAt = detail.retryAt || Date.now() + retrySeconds * 1000;

    setIsDismissed(false);
    setRateLimitState({
      initialSeconds: retrySeconds,
      remainingSeconds: Math.max(1, Math.ceil((targetRetryAt - Date.now()) / 1000)),
      endpoint: detail.endpoint || "general",
      bucket: detail.bucket || "api",
      retryAt: targetRetryAt,
      willRetry: Boolean(detail.willRetry),
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.addEventListener("rate-limit-triggered", handleRateLimit);
    return () => {
      window.removeEventListener("rate-limit-triggered", handleRateLimit);
    };
  }, [handleRateLimit]);

  useEffect(() => {
    if (!rateLimitState) {
      clearTimer();
      return;
    }

    clearTimer();

    timerRef.current = setInterval(() => {
      const now = Date.now();
      const diff = Math.ceil((rateLimitState.retryAt - now) / 1000);

      if (diff <= 0) {
        clearTimer();
        setRateLimitState(null);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("rate-limit-cleared", {
              detail: { bucket: rateLimitState.bucket, endpoint: rateLimitState.endpoint },
            }),
          );
        }
        onCountdownComplete?.();
      } else {
        setRateLimitState((prev) => (prev ? { ...prev, remainingSeconds: diff } : null));
      }
    }, 1000);

    return () => {
      clearTimer();
    };
  }, [rateLimitState?.retryAt, clearTimer, onCountdownComplete]);

  if (!rateLimitState || isDismissed || rateLimitState.remainingSeconds <= 0) {
    return null;
  }

  const { initialSeconds, remainingSeconds, endpoint, willRetry } = rateLimitState;
  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round(((initialSeconds - remainingSeconds) / initialSeconds) * 100)),
  );
  const endpointName = formatEndpointName(endpoint);

  return (
    <aside
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      data-testid="rate-limit-banner"
      className={`sticky top-0 z-50 w-full border-b border-rose-500/30 bg-rose-50/95 dark:bg-rose-950/95 text-rose-950 dark:text-rose-100 px-4 py-2.5 shadow-md backdrop-blur-md transition-all duration-300 ${className}`}
    >
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm font-medium">
        {/* Left section: icon and descriptive message */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span
            data-testid="rate-limit-icon"
            className="flex items-center justify-center p-1.5 rounded-lg bg-rose-500/20 text-rose-600 dark:text-rose-400 shrink-0"
          >
            <Clock className="w-4 h-4 animate-pulse" />
          </span>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-rose-950 dark:text-rose-50">
              Rate Limit Reached
            </span>
            <span
              data-testid="rate-limit-endpoint-badge"
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-200/80 dark:bg-rose-900/80 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-800"
            >
              {endpointName}
            </span>
            <span data-testid="rate-limit-message" className="text-rose-800 dark:text-rose-200/90">
              {willRetry
                ? `Too many requests. Retrying automatically in `
                : `Quota exceeded. Actions temporarily paused for `}
              <strong
                data-testid="rate-limit-countdown"
                className="font-bold underline text-rose-950 dark:text-white"
              >
                {remainingSeconds}s
              </strong>
              .
            </span>
          </div>
        </div>

        {/* Right section: progress indicator & dismiss */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          {/* Visual Countdown Progress Bar */}
          <div className="flex items-center gap-2 flex-1 sm:w-32">
            <div
              data-testid="rate-limit-progress"
              className="h-2 w-full sm:w-28 bg-rose-200 dark:bg-rose-900 rounded-full overflow-hidden"
              aria-hidden="true"
            >
              <div
                className="h-full bg-rose-500 dark:bg-rose-400 transition-all duration-1000 ease-linear rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-rose-700 dark:text-rose-300 shrink-0">
              {remainingSeconds}s
            </span>
          </div>

          {showDismiss && (
            <button
              onClick={() => setIsDismissed(true)}
              data-testid="rate-limit-dismiss"
              aria-label="Dismiss rate limit notice"
              className="p-1 rounded-md text-rose-700 dark:text-rose-300 hover:bg-rose-200/50 dark:hover:bg-rose-900/50 hover:text-rose-900 dark:hover:text-rose-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

export default RateLimitBanner;
