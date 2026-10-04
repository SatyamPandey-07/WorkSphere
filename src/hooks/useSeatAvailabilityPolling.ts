"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SeatAvailability,
  SeatStatus,
  DEFAULT_SEAT_CAPACITY,
} from "./useSeatAvailability";

export const DEFAULT_INITIAL_INTERVAL_MS = 5000; // 5 seconds
export const DEFAULT_MAX_INTERVAL_MS = 60000; // 60 seconds
export const DEFAULT_BACKOFF_FACTOR = 2;

export function computeSeatStatus(count: number, capacity: number): SeatStatus {
  if (capacity <= 0) return "red";
  const ratio = count / capacity;
  if (ratio >= 1) return "red";
  if (ratio >= 0.6) return "yellow";
  return "green";
}

export interface UseSeatAvailabilityPollingOptions {
  venueId?: string | null;
  capacity?: number;
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  backoffFactor?: number;
  enabled?: boolean;
  fetcher?: (venueId: string) => Promise<{
    count: number;
    capacity?: number;
    status?: SeatStatus;
  }>;
  onAvailabilityChange?: (availability: SeatAvailability) => void;
}

export interface UseSeatAvailabilityPollingResult {
  availability: SeatAvailability | null;
  isPolling: boolean;
  isLoading: boolean;
  error: Error | null;
  lastPolledAt: number | null;
  currentIntervalMs: number;
  refetch: () => Promise<void>;
  resetBackoff: () => void;
}

/**
 * Smart polling hook with exponential backoff for venue seat availability (#3350).
 *
 * - Starts polling at 5s, doubling up to 60s when seat occupancy is unchanged.
 * - Resets to initial interval (5s) whenever an occupancy delta is observed.
 * - Pauses polling when the browser tab is hidden (Page Visibility API) or offline.
 * - Immediately refreshes when the tab regains focus or visibility.
 */
export function useSeatAvailabilityPolling({
  venueId,
  capacity = DEFAULT_SEAT_CAPACITY,
  initialIntervalMs = DEFAULT_INITIAL_INTERVAL_MS,
  maxIntervalMs = DEFAULT_MAX_INTERVAL_MS,
  backoffFactor = DEFAULT_BACKOFF_FACTOR,
  enabled = true,
  fetcher,
  onAvailabilityChange,
}: UseSeatAvailabilityPollingOptions): UseSeatAvailabilityPollingResult {
  const [availability, setAvailability] = useState<SeatAvailability | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [currentIntervalMs, setCurrentIntervalMs] =
    useState<number>(initialIntervalMs);

  const currentIntervalRef = useRef<number>(initialIntervalMs);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const prevCountRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Keep latest callbacks/options in refs to avoid recreating handlers
  const onAvailabilityChangeRef = useRef(onAvailabilityChange);
  onAvailabilityChangeRef.current = onAvailabilityChange;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const clearPollingTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const resetBackoff = useCallback(() => {
    currentIntervalRef.current = initialIntervalMs;
    setCurrentIntervalMs(initialIntervalMs);
  }, [initialIntervalMs]);

  const defaultFetch = useCallback(
    async (
      targetVenueId: string,
      signal?: AbortSignal,
    ): Promise<{ count: number; capacity?: number; status?: SeatStatus }> => {
      const res = await fetch(`/api/venues/${targetVenueId}/check-in`, {
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch availability: ${res.statusText}`);
      }
      const data = await res.json();
      const count = typeof data.activeCount === "number" ? data.activeCount : 0;
      return { count };
    },
    [],
  );

  const executePoll = useCallback(
    async (isManualOrEventReset = false) => {
      if (!enabled || !venueId) {
        clearPollingTimer();
        return;
      }

      // Check tab visibility
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        clearPollingTimer();
        return;
      }

      // Check online status
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        clearPollingTimer();
        return;
      }

      // Cancel previous in-flight request if any
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        const fetchFn = fetcherRef.current || defaultFetch;
        const result = await fetchFn(venueId);

        if (!isMountedRef.current) return;

        const effectiveCapacity = result.capacity ?? capacity;
        const effectiveStatus =
          result.status ?? computeSeatStatus(result.count, effectiveCapacity);

        const newAvailability: SeatAvailability = {
          venueId,
          count: result.count,
          capacity: effectiveCapacity,
          status: effectiveStatus,
        };

        const hasChanged =
          prevCountRef.current !== null &&
          prevCountRef.current !== result.count;

        // If occupancy changed or manual/event reset, reset backoff to minimum interval
        if (hasChanged || isManualOrEventReset) {
          currentIntervalRef.current = initialIntervalMs;
        } else if (prevCountRef.current !== null) {
          // Unchanged occupancy: apply exponential backoff up to max interval
          currentIntervalRef.current = Math.min(
            maxIntervalMs,
            Math.round(currentIntervalRef.current * backoffFactor),
          );
        }

        prevCountRef.current = result.count;
        setAvailability(newAvailability);
        setLastPolledAt(Date.now());
        setCurrentIntervalMs(currentIntervalRef.current);

        if (hasChanged && onAvailabilityChangeRef.current) {
          onAvailabilityChangeRef.current(newAvailability);
        }
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        const pollError =
          err instanceof Error ? err : new Error(String(err));
        setError(pollError);

        // Exponential backoff on error to avoid hammering failing endpoints
        currentIntervalRef.current = Math.min(
          maxIntervalMs,
          Math.round(currentIntervalRef.current * backoffFactor),
        );
        setCurrentIntervalMs(currentIntervalRef.current);
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);

          // Schedule next poll if still visible & enabled
          if (
            enabled &&
            venueId &&
            typeof document !== "undefined" &&
            document.visibilityState !== "hidden"
          ) {
            clearPollingTimer();
            setIsPolling(true);
            timerRef.current = setTimeout(() => {
              executePoll();
            }, currentIntervalRef.current);
          }
        }
      }
    },
    [
      enabled,
      venueId,
      capacity,
      initialIntervalMs,
      maxIntervalMs,
      backoffFactor,
      defaultFetch,
      clearPollingTimer,
    ],
  );

  const refetch = useCallback(async () => {
    resetBackoff();
    clearPollingTimer();
    await executePoll(true);
  }, [resetBackoff, clearPollingTimer, executePoll]);

  useEffect(() => {
    isMountedRef.current = true;
    prevCountRef.current = null;
    resetBackoff();

    if (enabled && venueId) {
      executePoll();
    } else {
      clearPollingTimer();
      setAvailability(null);
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Tab restored to focus: immediately poll and reset backoff interval
        resetBackoff();
        executePoll(true);
      } else {
        // Tab hidden: pause polling immediately
        clearPollingTimer();
      }
    };

    const handleFocus = () => {
      resetBackoff();
      executePoll(true);
    };

    const handleOnline = () => {
      resetBackoff();
      executePoll(true);
    };

    const handleOffline = () => {
      clearPollingTimer();
    };

    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("focus", handleFocus);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }

    return () => {
      isMountedRef.current = false;
      clearPollingTimer();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (typeof window !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
        window.removeEventListener("focus", handleFocus);
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
    };
  }, [venueId, enabled, executePoll, resetBackoff, clearPollingTimer]);

  return {
    availability,
    isPolling,
    isLoading,
    error,
    lastPolledAt,
    currentIntervalMs,
    refetch,
    resetBackoff,
  };
}
