/**
 * Real-time seat availability with unified polling fallback (#703, #3350)
 *
 * Broadcasts/receives venue seat check-ins over a dedicated PartyKit room
 * so the map's seat-availability ring layer and venue cards update live.
 *
 * When the WebSocket connection is disconnected or unavailable, this hook
 * automatically transitions to smart polling with exponential backoff,
 * pausing when the tab is hidden or offline, and seamlessly resuming socket
 * updates once reconnected.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "@/hooks/usePartySocketReconnect";
import { useToast } from "@/components/ui/Toast";
import {
  queueOfflineCheckIn,
  getQueuedCheckIns,
  dequeueOfflineCheckIn,
  incrementCheckInRetryCount,
} from "@/lib/offlineStore";

export type SeatStatus = "green" | "yellow" | "red";

export interface SeatAvailability {
  venueId: string;
  count: number;
  capacity: number;
  status: SeatStatus;
}

// Mirrors server-side defaults
export const DEFAULT_SEAT_CAPACITY = 8;
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

const SEAT_ROOM = "seat-availability";

interface SeatUpdateMessage {
  type: "seat_update";
  venueId: string;
  count: number;
  capacity: number;
  status: SeatStatus;
  epoch?: number;
  sequenceId?: number;
}

interface SeatSnapshotMessage {
  type: "seat_snapshot";
  venues: Array<Omit<SeatUpdateMessage, "type" | "epoch" | "sequenceId">>;
  epoch?: number;
  sequenceId?: number;
}

export interface UseSeatAvailabilityOptions {
  venueId?: string | null;
  capacity?: number;
  fallbackPolling?: boolean;
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

export interface UseSeatAvailabilityResult {
  availability: Record<string, SeatAvailability>;
  venueAvailability: SeatAvailability | null;
  getAvailability: (venueId: string) => SeatAvailability;
  checkIn: (venueId: string, capacity?: number) => void;
  checkOut: () => void;
  checkedInVenueId: string | null;
  isConnected: boolean;
  isPolling: boolean;
  connectionMode: "socket" | "polling" | "disconnected";
  currentIntervalMs: number;
  refetch: () => Promise<void>;
  resetBackoff: () => void;
}

export function useSeatAvailability(
  options?: UseSeatAvailabilityOptions,
): UseSeatAvailabilityResult {
  const {
    venueId,
    capacity = DEFAULT_SEAT_CAPACITY,
    fallbackPolling = true,
    initialIntervalMs = DEFAULT_INITIAL_INTERVAL_MS,
    maxIntervalMs = DEFAULT_MAX_INTERVAL_MS,
    backoffFactor = DEFAULT_BACKOFF_FACTOR,
    enabled = true,
    fetcher,
    onAvailabilityChange,
  } = options ?? {};

  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [availability, setAvailability] = useState<
    Record<string, SeatAvailability>
  >({});
  const [isConnected, setIsConnected] = useState(false);
  const [checkedInVenueId, setCheckedInVenueId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  // Polling fallback state
  const [isPolling, setIsPolling] = useState(false);
  const [currentIntervalMs, setCurrentIntervalMs] =
    useState<number>(initialIntervalMs);

  const epochRef = useRef<number>(0);
  const sequenceRef = useRef<number>(0);
  const checkedInVenueRef = useRef<string | null>(null);

  const currentIntervalRef = useRef<number>(initialIntervalMs);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const prevCountRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const onAvailabilityChangeRef = useRef(onAvailabilityChange);
  onAvailabilityChangeRef.current = onAvailabilityChange;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (typeof getToken === "function") {
      getToken()
        .then(setToken)
        .catch(() => setToken(null));
    }
  }, [getToken]);

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

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999",
    room: isMounted ? SEAT_ROOM : "seat-availability",
    startClosed: !isMounted,
    query: token ? { token } : undefined,
    onOpen() {
      setIsConnected(true);
      clearPollingTimer();
    },
    onClose() {
      setIsConnected(false);
    },
    onMessage(event) {
      try {
        const data = JSON.parse(event.data) as
          | SeatUpdateMessage
          | SeatSnapshotMessage;

        if (data.type !== "seat_update" && data.type !== "seat_snapshot") {
          return;
        }

        const msgEpoch = data.epoch ?? 0;
        const msgSeq = data.sequenceId ?? 0;

        if (msgEpoch < epochRef.current) return;
        if (msgEpoch === epochRef.current && msgSeq <= sequenceRef.current) {
          return;
        }

        epochRef.current = msgEpoch;
        sequenceRef.current = msgSeq;

        if (data.type === "seat_update") {
          setAvailability((prev) => {
            const updated = {
              ...prev,
              [data.venueId]: {
                venueId: data.venueId,
                count: data.count,
                capacity: data.capacity,
                status: data.status,
              },
            };
            if (
              onAvailabilityChangeRef.current &&
              venueId &&
              data.venueId === venueId
            ) {
              onAvailabilityChangeRef.current(updated[data.venueId]);
            }
            return updated;
          });
        } else if (data.type === "seat_snapshot") {
          setAvailability((prev) => {
            const next = { ...prev };
            for (const v of data.venues) {
              next[v.venueId] = { ...v };
            }
            return next;
          });
        }
      } catch {
        // Not a seat-availability message (or malformed) — ignore.
      }
    },
  });

  const { toast } = useToast();

  const checkIn = useCallback(
    (targetId: string, seatCapacity: number = DEFAULT_SEAT_CAPACITY) => {
      checkedInVenueRef.current = targetId;
      setCheckedInVenueId(targetId);

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        queueOfflineCheckIn(targetId).catch(console.error);
        toast("You are offline. Check-in queued for sync.", "success");
      } else {
        socket?.send(
          JSON.stringify({
            type: "seat_checkin",
            venueId: targetId,
            capacity: seatCapacity,
          }),
        );
      }
    },
    [socket, toast],
  );

  useEffect(() => {
    let isSyncing = false;

    const handleOnline = async () => {
      if (isSyncing) return;

      const checkIns = await getQueuedCheckIns();
      if (!checkIns || checkIns.length === 0) return;

      isSyncing = true;
      toast("Sync started", "success");

      let hasFailures = false;

      for (const item of checkIns) {
        try {
          const response = await fetch("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checkIns: [item] }),
          });

          if (response.ok) {
            await dequeueOfflineCheckIn(item.id!);
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  type: "seat_checkin",
                  venueId: item.venueId,
                  capacity: DEFAULT_SEAT_CAPACITY,
                }),
              );
            }
          } else {
            hasFailures = true;
            await incrementCheckInRetryCount(item.id!);
          }
        } catch {
          hasFailures = true;
          await incrementCheckInRetryCount(item.id!);
        }
      }

      if (hasFailures) {
        toast("Sync failed", "error");
      } else {
        toast("Sync completed", "success");
      }

      isSyncing = false;
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
      }
    };
  }, [toast, socket]);

  const checkOut = useCallback(() => {
    checkedInVenueRef.current = null;
    setCheckedInVenueId(null);
    socket?.send(JSON.stringify({ type: "seat_checkout" }));
  }, [socket]);

  useEffect(() => {
    return () => {
      if (checkedInVenueRef.current) {
        try {
          socket?.send(JSON.stringify({ type: "seat_checkout" }));
        } catch {
          // Socket may already be closed on unmount
        }
      }
    };
  }, [socket]);

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

  const targetPollingVenueId = venueId || checkedInVenueId;
  const shouldPoll = Boolean(
    enabled &&
      fallbackPolling &&
      targetPollingVenueId &&
      !isConnected &&
      isMounted,
  );

  const executePoll = useCallback(
    async (isManualOrEventReset = false) => {
      if (!shouldPoll || !targetPollingVenueId) {
        clearPollingTimer();
        return;
      }

      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        clearPollingTimer();
        return;
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        clearPollingTimer();
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const fetchFn = fetcherRef.current || defaultFetch;
        const result = await fetchFn(targetPollingVenueId);

        const effectiveCapacity = result.capacity ?? capacity;
        const effectiveStatus =
          result.status ?? computeSeatStatus(result.count, effectiveCapacity);

        const newAvailability: SeatAvailability = {
          venueId: targetPollingVenueId,
          count: result.count,
          capacity: effectiveCapacity,
          status: effectiveStatus,
        };

        const hasChanged =
          prevCountRef.current !== null &&
          prevCountRef.current !== result.count;

        if (hasChanged || isManualOrEventReset) {
          currentIntervalRef.current = initialIntervalMs;
        } else if (prevCountRef.current !== null) {
          currentIntervalRef.current = Math.min(
            maxIntervalMs,
            Math.round(currentIntervalRef.current * backoffFactor),
          );
        }

        prevCountRef.current = result.count;
        setAvailability((prev) => ({
          ...prev,
          [targetPollingVenueId]: newAvailability,
        }));
        setCurrentIntervalMs(currentIntervalRef.current);

        if (hasChanged && onAvailabilityChangeRef.current) {
          onAvailabilityChangeRef.current(newAvailability);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        currentIntervalRef.current = Math.min(
          maxIntervalMs,
          Math.round(currentIntervalRef.current * backoffFactor),
        );
        setCurrentIntervalMs(currentIntervalRef.current);
      } finally {
        if (
          shouldPoll &&
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
    },
    [
      shouldPoll,
      targetPollingVenueId,
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
    if (shouldPoll) {
      executePoll();
    } else {
      clearPollingTimer();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && shouldPoll) {
        resetBackoff();
        executePoll(true);
      } else {
        clearPollingTimer();
      }
    };

    const handleFocus = () => {
      if (shouldPoll) {
        resetBackoff();
        executePoll(true);
      }
    };

    const handleOnlineEvent = () => {
      if (shouldPoll) {
        resetBackoff();
        executePoll(true);
      }
    };

    const handleOfflineEvent = () => {
      clearPollingTimer();
    };

    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("focus", handleFocus);
      window.addEventListener("online", handleOnlineEvent);
      window.addEventListener("offline", handleOfflineEvent);
    }

    return () => {
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
        window.removeEventListener("online", handleOnlineEvent);
        window.removeEventListener("offline", handleOfflineEvent);
      }
    };
  }, [shouldPoll, executePoll, resetBackoff, clearPollingTimer]);

  const getAvailability = useCallback(
    (id: string): SeatAvailability => {
      return (
        availability[id] ?? {
          venueId: id,
          count: 0,
          capacity: DEFAULT_SEAT_CAPACITY,
          status: "green",
        }
      );
    },
    [availability],
  );

  const venueAvailability = venueId ? availability[venueId] ?? null : null;

  const connectionMode: "socket" | "polling" | "disconnected" = isConnected
    ? "socket"
    : isPolling
      ? "polling"
      : "disconnected";

  return {
    availability,
    venueAvailability,
    getAvailability,
    checkIn,
    checkOut,
    checkedInVenueId,
    isConnected: isMounted && isConnected,
    isPolling,
    connectionMode,
    currentIntervalMs,
    refetch,
    resetBackoff,
  };
}

export default useSeatAvailability;
