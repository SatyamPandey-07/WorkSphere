"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

export interface UseDeskReservationCountdownOptions {
  venueId: string;
  deskId?: string | null;
  initialExpiresAt?: number;
  totalDurationSeconds?: number;
  warningThresholdSeconds?: number;
  onExpire?: (deskId: string) => void;
  onWarning?: (remainingSeconds: number) => void;
  onExtended?: (newExpiresAt: number) => void;
}

export interface UseDeskReservationCountdownReturn {
  remainingSeconds: number;
  formattedTime: string;
  progressPercentage: number;
  isExpiringSoon: boolean;
  isExpired: boolean;
  isActive: boolean;
  isLiveSyncActive: boolean;
  expiresAt: number | null;
  extendCountdown: (additionalSeconds?: number) => Promise<boolean>;
  releaseCountdown: () => Promise<boolean>;
  syncWithServer: () => Promise<void>;
}

const DESK_COUNTDOWN_CHANNEL = "worksphere:desk-countdown-sync";

export function useDeskReservationCountdown({
  venueId,
  deskId,
  initialExpiresAt,
  totalDurationSeconds = 300,
  warningThresholdSeconds = 60,
  onExpire,
  onWarning,
  onExtended,
}: UseDeskReservationCountdownOptions): UseDeskReservationCountdownReturn {
  const [expiresAt, setExpiresAt] = useState<number | null>(
    initialExpiresAt || null,
  );
  const [totalDuration, setTotalDuration] = useState<number>(totalDurationSeconds);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    if (!initialExpiresAt) return 0;
    return Math.max(0, Math.ceil((initialExpiresAt - Date.now()) / 1000));
  });
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const [isLiveSyncActive, setIsLiveSyncActive] = useState<boolean>(false);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const warningFiredRef = useRef<boolean>(false);
  const onExpireRef = useRef(onExpire);
  const onWarningRef = useRef(onWarning);
  const onExtendedRef = useRef(onExtended);

  useEffect(() => {
    onExpireRef.current = onExpire;
    onWarningRef.current = onWarning;
    onExtendedRef.current = onExtended;
  });

  // Synchronize initialExpiresAt if prop updates
  useEffect(() => {
    if (initialExpiresAt) {
      setExpiresAt(initialExpiresAt);
      const remaining = Math.max(0, Math.ceil((initialExpiresAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      setIsExpired(remaining <= 0);
      warningFiredRef.current = false;
    } else if (!deskId) {
      setExpiresAt(null);
      setRemainingSeconds(0);
      setIsExpired(false);
    }
  }, [initialExpiresAt, deskId]);

  // Cross-tab broadcast channel synchronization
  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

    try {
      const channel = new BroadcastChannel(DESK_COUNTDOWN_CHANNEL);
      channelRef.current = channel;

      channel.onmessage = (event) => {
        const data = event.data;
        if (!data || data.venueId !== venueId || data.deskId !== deskId) return;

        if (data.type === "COUNTDOWN_EXTENDED" && data.expiresAt) {
          setExpiresAt(data.expiresAt);
          if (typeof data.newDuration === "number") {
            setTotalDuration(data.newDuration);
          }
          setIsExpired(false);
          warningFiredRef.current = false;
          onExtendedRef.current?.(data.expiresAt);
        } else if (data.type === "COUNTDOWN_RELEASED" || data.type === "COUNTDOWN_EXPIRED") {
          setIsExpired(true);
          setRemainingSeconds(0);
          setExpiresAt(null);
          if (data.type === "COUNTDOWN_EXPIRED" && deskId) {
            onExpireRef.current?.(deskId);
          }
        }
      };

      return () => {
        channel.close();
      };
    } catch {
      // BroadcastChannel unavailable
    }
  }, [venueId, deskId]);

  // Connect to SSE for real-time Redis Keyspace expiration notifications
  useEffect(() => {
    if (!venueId || !deskId) return;

    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource(
        `/api/reservations/events?venueId=${encodeURIComponent(venueId)}`,
      );

      eventSource.onopen = () => {
        setIsLiveSyncActive(true);
      };

      const handleExpirationNotification = (payloadRaw: string) => {
        try {
          const payload = JSON.parse(payloadRaw);
          if (
            (payload.type === "DESK_HOLD_EXPIRED" || payload.type === "SEAT_HOLD_EXPIRED") &&
            (payload.deskId === deskId || payload.seatId === deskId)
          ) {
            setIsExpired(true);
            setRemainingSeconds(0);
            setExpiresAt(null);
            onExpireRef.current?.(deskId);

            // Broadcast to other tabs
            try {
              channelRef.current?.postMessage({
                type: "COUNTDOWN_EXPIRED",
                venueId,
                deskId,
              });
            } catch {}
          }
        } catch {
          // Ignore invalid frames
        }
      };

      eventSource.addEventListener("desk_expired", (e: MessageEvent) => {
        handleExpirationNotification(e.data);
      });

      eventSource.addEventListener("availability", (e: MessageEvent) => {
        handleExpirationNotification(e.data);
      });

      eventSource.onerror = () => {
        setIsLiveSyncActive(false);
      };
    } catch {
      setIsLiveSyncActive(false);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      setIsLiveSyncActive(false);
    };
  }, [venueId, deskId]);

  // High-precision clock ticker: recalculates remaining time each second
  useEffect(() => {
    if (!expiresAt || isExpired) return;

    const tick = () => {
      const now = Date.now();
      const secLeft = Math.max(0, Math.ceil((expiresAt - now) / 1000));

      setRemainingSeconds(secLeft);

      if (secLeft <= warningThresholdSeconds && !warningFiredRef.current && secLeft > 0) {
        warningFiredRef.current = true;
        onWarningRef.current?.(secLeft);
      }

      if (secLeft <= 0) {
        setIsExpired(true);
        setExpiresAt(null);
        if (deskId) {
          onExpireRef.current?.(deskId);
        }
        try {
          channelRef.current?.postMessage({
            type: "COUNTDOWN_EXPIRED",
            venueId,
            deskId,
          });
        } catch {}
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, isExpired, warningThresholdSeconds, deskId, venueId]);

  // Formatted MM:SS
  const formattedTime = useMemo(() => {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, [remainingSeconds]);

  // Progress percentage (0% = expired, 100% = fresh)
  const progressPercentage = useMemo(() => {
    if (totalDuration <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((remainingSeconds / totalDuration) * 100)));
  }, [remainingSeconds, totalDuration]);

  const isExpiringSoon = remainingSeconds > 0 && remainingSeconds <= warningThresholdSeconds;
  const isActive = !!deskId && !!expiresAt && remainingSeconds > 0 && !isExpired;

  /**
   * Extends the countdown timer atomically on Redis.
   */
  const extendCountdown = useCallback(
    async (additionalSeconds: number = 120): Promise<boolean> => {
      if (!deskId || !venueId) return false;

      try {
        const res = await fetch(`/api/venues/${venueId}/seats/${deskId}/countdown`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "extend", additionalSeconds }),
        });

        if (!res.ok) return false;

        const data = await res.json();
        if (data.success && data.expiresAt) {
          setExpiresAt(data.expiresAt);
          const newRemaining = Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 1000));
          setRemainingSeconds(newRemaining);
          setTotalDuration((prev) => Math.max(prev, newRemaining));
          setIsExpired(false);
          warningFiredRef.current = false;
          onExtendedRef.current?.(data.expiresAt);

          try {
            channelRef.current?.postMessage({
              type: "COUNTDOWN_EXTENDED",
              venueId,
              deskId,
              expiresAt: data.expiresAt,
              newDuration: Math.max(totalDuration, newRemaining),
            });
          } catch {}

          return true;
        }
      } catch {
        return false;
      }
      return false;
    },
    [deskId, venueId, totalDuration],
  );

  /**
   * Releases the countdown timer atomically on Redis.
   */
  const releaseCountdown = useCallback(async (): Promise<boolean> => {
    if (!deskId || !venueId) return false;

    try {
      const res = await fetch(`/api/venues/${venueId}/seats/${deskId}/countdown`, {
        method: "DELETE",
      });

      setExpiresAt(null);
      setRemainingSeconds(0);
      setIsExpired(true);

      try {
        channelRef.current?.postMessage({
          type: "COUNTDOWN_RELEASED",
          venueId,
          deskId,
        });
      } catch {}

      return res.ok;
    } catch {
      return false;
    }
  }, [deskId, venueId]);

  /**
   * Resynchronizes countdown timer status with exact millisecond PTTL from Redis.
   */
  const syncWithServer = useCallback(async () => {
    if (!deskId || !venueId) return;

    try {
      const res = await fetch(`/api/venues/${venueId}/seats/${deskId}/countdown`);
      if (res.ok) {
        const data = await res.json();
        if (data.isLocked && data.expiresAt) {
          setExpiresAt(data.expiresAt);
          setRemainingSeconds(data.remainingSeconds || Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 1000)));
          setIsExpired(false);
        } else {
          setIsExpired(true);
          setRemainingSeconds(0);
          setExpiresAt(null);
        }
      }
    } catch {
      // Ignore network blips during polling
    }
  }, [deskId, venueId]);

  return {
    remainingSeconds,
    formattedTime,
    progressPercentage,
    isExpiringSoon,
    isExpired,
    isActive,
    isLiveSyncActive,
    expiresAt,
    extendCountdown,
    releaseCountdown,
    syncWithServer,
  };
}
