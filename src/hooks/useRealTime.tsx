/**
 * Real-time Updates using Server-Sent Events (SSE)
 * Provides live updates for venue ratings and availability
 */

// Client-side hook for real-time updates
"use client";

import { useEffect, useState, useCallback } from "react";

interface VenueUpdate {
  type: "rating" | "availability" | "new_review";
  venueId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface UseRealTimeUpdatesOptions {
  venueIds?: string[];
  enabled?: boolean;
}

/**
 * Hook for subscribing to real-time venue updates
 */
export function useRealTimeUpdates(options: UseRealTimeUpdatesOptions = {}) {
  const { venueIds = [], enabled = true } = options;
  const [updates, setUpdates] = useState<VenueUpdate[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearUpdates = useCallback(() => {
    setUpdates([]);
  }, []);

  useEffect(() => {
    if (!enabled || venueIds.length === 0) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      const params = new URLSearchParams();
      venueIds.forEach((id) => params.append("venueId", id));

      eventSource = new EventSource(`/api/venues/updates?${params.toString()}`);

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        console.log("[RealTime] Connected to updates stream");
      };

      eventSource.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data) as VenueUpdate;
          setUpdates((prev) => [...prev.slice(-49), update]); // Keep last 50 updates
        } catch (e) {
          console.error("[RealTime] Failed to parse update:", e);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        setError("Connection lost. Reconnecting...");
        eventSource?.close();

        // Reconnect after 5 seconds
        reconnectTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      eventSource?.close();
      clearTimeout(reconnectTimeout);
    };
  }, [venueIds, enabled]);

  return { updates, isConnected, error, clearUpdates };
}

/**
 * Hook for optimistic updates with rollback
 */
export function useOptimisticUpdate<T>(
  initialValue: T,
  updateFn: (value: T) => Promise<T>
) {
  const [value, setValue] = useState(initialValue);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (newValue: T) => {
      const previousValue = value;
      setValue(newValue); // Optimistic update
      setIsPending(true);
      setError(null);

      try {
        const confirmedValue = await updateFn(newValue);
        setValue(confirmedValue);
      } catch (e) {
        setValue(previousValue); // Rollback
        setError(e instanceof Error ? e.message : "Update failed");
      } finally {
        setIsPending(false);
      }
    },
    [value, updateFn]
  );

  return { value, update, isPending, error };
}

/**
 * Polling-based updates for simpler real-time needs
 */
export function usePollingUpdates<T>(
  fetchFn: () => Promise<T>,
  interval: number = 30000,
  enabled: boolean = true
) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchFn();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    if (!enabled) return;

    refresh(); // Initial fetch

    const intervalId = setInterval(refresh, interval);

    return () => clearInterval(intervalId);
  }, [enabled, interval, refresh]);

  return { data, isLoading, error, refresh };
}

/**
 * Connection status indicator component
 */
export function ConnectionStatus({ isConnected }: { isConnected: boolean }) {
  if (isConnected) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        Live
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <span className="w-2 h-2 bg-amber-500 rounded-full" />
      Reconnecting...
    </div>
  );
}
