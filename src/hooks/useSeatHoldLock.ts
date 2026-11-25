"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import usePartySocket from "@/hooks/usePartySocketReconnect";
import { useAuth, useUser } from "@clerk/nextjs";
import { useToast } from "@/components/ui/Toast";

/** Fallback length of the "Extend Hold" prompt when the server omits graceMs (#7943). */
const DEFAULT_LOCK_RECOVERY_GRACE_MS = 30_000;

export interface SeatHoldInfo {
  seatId: string;
  venueId: string;
  heldBy: string;
  heldByName?: string;
  expiresAt: number;
  isSelf: boolean;
  remainingSeconds: number;
}

export interface UseSeatHoldLockOptions {
  venueId: string;
  userId?: string;
  userName?: string;
  room?: string;
  autoRenewHeartbeat?: boolean;
  heartbeatIntervalMs?: number;
  onHoldAcquired?: (seatId: string, expiresAt: number) => void;
  onHoldRejected?: (
    seatId: string,
    reason: string,
    heldBy?: string,
    heldByName?: string,
  ) => void;
  onHoldExpired?: (seatId: string) => void;
  onSeatLocked?: (seatId: string, heldBy: string, heldByName?: string) => void;
  onSeatUnlocked?: (seatId: string, reason: string) => void;
  onHoldRenewed?: (seatId: string, expiresAt: number) => void;
  /** Fired when the server reports that this user's hold hit its TTL (#7943). */
  onLockExpired?: (seatId: string, graceMs: number) => void;
  /** Fired after the user successfully re-acquires a seat from the recovery toast (#7943). */
  onHoldExtended?: (seatId: string, expiresAt: number) => void;
  /** Show the interactive "Extend Hold" toast on expiry. Defaults to true. */
  showLockRecoveryToast?: boolean;
}

export function useSeatHoldLock({
  venueId,
  userId: propUserId,
  userName: propUserName,
  room,
  autoRenewHeartbeat = true,
  heartbeatIntervalMs,
  onHoldAcquired,
  onHoldRejected,
  onHoldExpired,
  onSeatLocked,
  onSeatUnlocked,
  onHoldRenewed,
  onLockExpired,
  onHoldExtended,
  showLockRecoveryToast = true,
}: UseSeatHoldLockOptions) {
  const { toast } = useToast();
  const { userId: authUserId, getToken, isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const effectiveUserId = authUserId || propUserId || "guest_viewer";
  const effectiveUserName =
    propUserName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    "User";
  const [socketAuth, setSocketAuth] = useState<{
    userId: string;
    token: string;
  } | null>(null);

  const authToken = socketAuth?.userId === authUserId ? socketAuth.token : null;

  const isAuthReady = isLoaded && (!isSignedIn || Boolean(authToken));

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded || !isSignedIn || !authUserId) {
      setSocketAuth(null);
      return () => {
        cancelled = true;
      };
    }

    setSocketAuth(null);

    getToken()
      .then((token) => {
        if (!cancelled && token) {
          setSocketAuth({ userId: authUserId, token });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSocketAuth(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, authUserId]);

  const [activeHolds, setActiveHolds] = useState<Record<string, SeatHoldInfo>>(
    {},
  );
  const [myHeldSeatId, setMyHeldSeatId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const myHeldSeatIdRef = useRef<string | null>(null);
  myHeldSeatIdRef.current = myHeldSeatId;

  // Latest holds for the 1s ticker, which must not raise toasts from inside a
  // state updater. The announce ref lets the socket handler (created before
  // the callbacks below) call the current implementation.
  const activeHoldsRef = useRef<Record<string, SeatHoldInfo>>({});
  activeHoldsRef.current = activeHolds;
  const announceLockExpiredRef = useRef<
    (seatId: string, graceMs?: number) => void
  >(() => {});
  const announcedAtRef = useRef<Map<string, number>>(new Map());

  // References for pending promises to resolve acquireHold requests
  const pendingRequests = useRef<
    Map<
      string,
      {
        resolve: (acquired: boolean) => void;
        reject: (err: unknown) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >
  >(new Map());

  const targetRoom = room || `floorplan-${venueId}`;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999",
    room: isMounted ? targetRoom : `floorplan-${venueId}`,
    startClosed: !isMounted || !isAuthReady,
    query: authToken ? { token: authToken } : undefined,
    onOpen() {
      setIsConnected(true);
      // Request active seat holds snapshot upon connection
      socket.send(
        JSON.stringify({
          type: "request_seat_holds",
          venueId,
        }),
      );
    },
    onClose() {
      setIsConnected(false);
    },
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);

        // 1. Initial snapshot of active holds
        if (data.type === "seat_holds_snapshot" && Array.isArray(data.holds)) {
          const now = Date.now();
          const snapshotMap: Record<string, SeatHoldInfo> = {};
          let selfSeat: string | null = null;

          for (const hold of data.holds) {
            if (hold.venueId === venueId && now < hold.expiresAt) {
              const isSelf = hold.heldBy === effectiveUserId;
              const remainingSeconds = Math.max(
                0,
                Math.ceil((hold.expiresAt - now) / 1000),
              );
              snapshotMap[hold.seatId] = {
                seatId: hold.seatId,
                venueId: hold.venueId,
                heldBy: hold.heldBy,
                heldByName: hold.heldByName,
                expiresAt: hold.expiresAt,
                isSelf,
                remainingSeconds,
              };
              if (isSelf) {
                selfSeat = hold.seatId;
              }
            }
          }

          setActiveHolds(snapshotMap);
          if (selfSeat) setMyHeldSeatId(selfSeat);
          return;
        }

        // 2. Lock confirmed for requester
        if (data.type === "seat_hold_acquired" && data.seatId) {
          const expiresAt = data.expiresAt || Date.now() + 300_000;
          const remainingSeconds = Math.max(
            0,
            Math.ceil((expiresAt - Date.now()) / 1000),
          );

          setActiveHolds((prev) => ({
            ...prev,
            [data.seatId]: {
              seatId: data.seatId,
              venueId: data.venueId || venueId,
              heldBy: effectiveUserId,
              heldByName: effectiveUserName,
              expiresAt,
              isSelf: true,
              remainingSeconds,
            },
          }));

          setMyHeldSeatId(data.seatId);
          onHoldAcquired?.(data.seatId, expiresAt);

          const pending = pendingRequests.current.get(data.seatId);
          if (pending) {
            clearTimeout(pending.timer);
            pending.resolve(true);
            pendingRequests.current.delete(data.seatId);
          }
          return;
        }

        // 3. Lock rejected (already held by someone else)
        if (data.type === "seat_hold_rejected" && data.seatId) {
          if (data.heldBy && data.expiresAt) {
            const remainingSeconds = Math.max(
              0,
              Math.ceil((data.expiresAt - Date.now()) / 1000),
            );
            setActiveHolds((prev) => ({
              ...prev,
              [data.seatId]: {
                seatId: data.seatId,
                venueId: data.venueId || venueId,
                heldBy: data.heldBy,
                heldByName: data.heldByName,
                expiresAt: data.expiresAt,
                isSelf: data.heldBy === effectiveUserId,
                remainingSeconds,
              },
            }));
          }

          onHoldRejected?.(
            data.seatId,
            data.reason || "ALREADY_HELD",
            data.heldBy,
            data.heldByName,
          );

          const pending = pendingRequests.current.get(data.seatId);
          if (pending) {
            clearTimeout(pending.timer);
            pending.resolve(false);
            pendingRequests.current.delete(data.seatId);
          }
          return;
        }

        // 4. Real-time broadcast: Seat locked by any user in room
        if (data.type === "seat_locked" && data.seatId) {
          if (data.venueId && data.venueId !== venueId) return;

          const isSelf = data.heldBy === effectiveUserId;
          const expiresAt = data.expiresAt || Date.now() + 300_000;
          const remainingSeconds = Math.max(
            0,
            Math.ceil((expiresAt - Date.now()) / 1000),
          );

          setActiveHolds((prev) => ({
            ...prev,
            [data.seatId]: {
              seatId: data.seatId,
              venueId: data.venueId || venueId,
              heldBy: data.heldBy,
              heldByName: data.heldByName,
              expiresAt,
              isSelf,
              remainingSeconds,
            },
          }));

          if (isSelf) {
            setMyHeldSeatId(data.seatId);
          } else {
            onSeatLocked?.(data.seatId, data.heldBy, data.heldByName);
          }
          return;
        }

        // 5. Real-time broadcast: Seat unlocked (released, expired, or checkout complete)
        if (data.type === "seat_unlocked" && data.seatId) {
          if (data.venueId && data.venueId !== venueId) return;

          setActiveHolds((prev) => {
            if (!prev[data.seatId]) return prev;
            const updated = { ...prev };
            delete updated[data.seatId];
            return updated;
          });

          setMyHeldSeatId((prev) => (prev === data.seatId ? null : prev));

          if (data.reason === "EXPIRED") {
            onHoldExpired?.(data.seatId);
          }
          onSeatUnlocked?.(data.seatId, data.reason || "UNLOCKED");
          return;
        }

        // 6. Direct notice that this user's own hold reached its TTL (#7943)
        if (data.type === "lock_expired" && data.seatId) {
          if (data.venueId && data.venueId !== venueId) return;

          // Ignore a late notice if the hold has since been renewed.
          const current = activeHoldsRef.current[data.seatId];
          if (current?.isSelf && current.expiresAt > Date.now()) return;

          const graceMs =
            typeof data.graceMs === "number" && data.graceMs > 0
              ? data.graceMs
              : DEFAULT_LOCK_RECOVERY_GRACE_MS;

          setActiveHolds((prev) => {
            if (!prev[data.seatId]) return prev;
            const updated = { ...prev };
            delete updated[data.seatId];
            return updated;
          });
          setMyHeldSeatId((prev) => (prev === data.seatId ? null : prev));

          onLockExpired?.(data.seatId, graceMs);
          announceLockExpiredRef.current(data.seatId, graceMs);
          return;
        }
      } catch {
        // Ignore unparseable frames
      }
    },
  });

  // Prevent stale lock leakage on page unmount, tab close, or navigation
  useEffect(() => {
    const handleReleaseOnUnload = () => {
      const heldSeat = myHeldSeatIdRef.current;
      if (!heldSeat) return;

      if (socket && isConnected) {
        try {
          socket.send(
            JSON.stringify({
              type: "seat_release_request",
              seatId: heldSeat,
              venueId,
              userId: effectiveUserId,
            }),
          );
        } catch {
          // ignore
        }
      }

      try {
        fetch(`/api/venues/${venueId}/seats/${heldSeat}/lock`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
      } catch {
        // ignore
      }
    };

    window.addEventListener("pagehide", handleReleaseOnUnload);
    window.addEventListener("beforeunload", handleReleaseOnUnload);

    return () => {
      window.removeEventListener("pagehide", handleReleaseOnUnload);
      window.removeEventListener("beforeunload", handleReleaseOnUnload);
      handleReleaseOnUnload();
    };
  }, [venueId, effectiveUserId, socket, isConnected]);

  // Client-side 1-second countdown ticker & auto-release expired locks without page reload
  useEffect(() => {
    const interval = setInterval(() => {
      // Prompt immediately at local expiry instead of waiting for the server
      // sweep to send lock_expired. Deduplicated per seat by the announcer.
      const tickNow = Date.now();
      for (const hold of Object.values(activeHoldsRef.current)) {
        if (hold.isSelf && tickNow >= hold.expiresAt) {
          announceLockExpiredRef.current(hold.seatId);
        }
      }

      setActiveHolds((prev) => {
        let hasChanges = false;
        const now = Date.now();
        const next: Record<string, SeatHoldInfo> = {};

        for (const [seatId, hold] of Object.entries(prev)) {
          if (now >= hold.expiresAt) {
            hasChanges = true;
            if (hold.isSelf) {
              setMyHeldSeatId((current) =>
                current === seatId ? null : current,
              );
              onHoldExpired?.(seatId);
            }
            continue; // Dropped automatically upon TTL expiration
          }

          const newRemaining = Math.max(
            0,
            Math.ceil((hold.expiresAt - now) / 1000),
          );
          if (newRemaining !== hold.remainingSeconds) {
            hasChanges = true;
            next[seatId] = {
              ...hold,
              remainingSeconds: newRemaining,
            };
          } else {
            next[seatId] = hold;
          }
        }

        return hasChanges ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [onHoldExpired]);

  // Automatic lock renewal heartbeat while user holds a seat
  useEffect(() => {
    if (!myHeldSeatId || autoRenewHeartbeat === false) return;

    const intervalMs = heartbeatIntervalMs || 60_000; // default 60s
    const timer = setInterval(() => {
      if (isConnected && socket) {
        socket.send(
          JSON.stringify({
            type: "seat_hold_request",
            seatId: myHeldSeatId,
            venueId,
            userId: effectiveUserId,
            userName: effectiveUserName,
            ttlMs: 300_000,
          }),
        );
      } else {
        acquireViaHttp(venueId, myHeldSeatId, 300_000).catch(() => {});
      }
      const existing = activeHolds[myHeldSeatId];
      if (existing) {
        onHoldRenewed?.(myHeldSeatId, Date.now() + 300_000);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [
    myHeldSeatId,
    autoRenewHeartbeat,
    heartbeatIntervalMs,
    isConnected,
    socket,
    venueId,
    effectiveUserId,
    effectiveUserName,
    activeHolds,
    onHoldRenewed,
  ]);

  /**
   * Acquire an exclusive 5-minute hold on a seat.
   * Sends WebSocket frame, with HTTP fallback if offline.
   */
  const acquireHold = useCallback(
    async (seatId: string, ttlMs: number = 300_000): Promise<boolean> => {
      // If already holding this exact seat, consider acquired
      if (myHeldSeatId === seatId) return true;

      // Optimistic check: if someone else holds it and it hasn't expired
      const existing = activeHolds[seatId];
      if (existing && !existing.isSelf && existing.remainingSeconds > 0) {
        onHoldRejected?.(
          seatId,
          "ALREADY_HELD",
          existing.heldBy,
          existing.heldByName,
        );
        return false;
      }

      // If connected to PartyKit, use instant WebSocket event
      if (isConnected && socket) {
        return new Promise<boolean>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingRequests.current.delete(seatId);
            // Fallback to HTTP on WebSocket timeout
            acquireViaHttp(venueId, seatId, ttlMs).then(resolve).catch(reject);
          }, 3000);

          pendingRequests.current.set(seatId, { resolve, reject, timer });

          socket.send(
            JSON.stringify({
              type: "seat_hold_request",
              seatId,
              venueId,
              userId: effectiveUserId,
              userName: effectiveUserName,
              ttlMs,
            }),
          );
        });
      }

      // Fallback: HTTP API
      return acquireViaHttp(venueId, seatId, ttlMs);
    },
    [
      venueId,
      myHeldSeatId,
      activeHolds,
      isConnected,
      socket,
      effectiveUserId,
      effectiveUserName,
      onHoldRejected,
    ],
  );

  /**
   * Re-acquire a seat whose hold expired. Uses the same atomic server-side
   * acquire as a fresh hold, so it only succeeds while the seat is unreserved.
   */
  const extendHold = useCallback(
    async (seatId: string): Promise<boolean> => {
      let acquired = false;
      try {
        acquired = await acquireHold(seatId);
      } catch {
        acquired = false;
      }
      announcedAtRef.current.delete(seatId);

      if (acquired) {
        toast("Seat hold extended. You have 5 more minutes.", "success", {
          key: `seat-lock-extended:${seatId}`,
        });
        onHoldExtended?.(seatId, Date.now() + 300_000);
      } else {
        toast(
          "Couldn't extend your hold. The seat may have been taken.",
          "error",
          { key: `seat-lock-extended:${seatId}` },
        );
      }
      return acquired;
    },
    [acquireHold, toast, onHoldExtended],
  );

  const announceLockExpired = useCallback(
    (seatId: string, graceMs: number = DEFAULT_LOCK_RECOVERY_GRACE_MS) => {
      if (!showLockRecoveryToast) return;

      const now = Date.now();
      const lastAnnounced = announcedAtRef.current.get(seatId);
      if (lastAnnounced !== undefined && now - lastAnnounced < graceMs) return;
      announcedAtRef.current.set(seatId, now);

      toast(
        "Your seat hold expired. Extend it within {countdown} seconds if the seat is still free.",
        "warning",
        {
          key: `seat-lock-expired:${seatId}`,
          countdown: Math.max(1, Math.ceil(graceMs / 1000)),
          action: {
            label: "Extend Hold",
            onClick: () => {
              void extendHold(seatId);
            },
          },
        },
      );
    },
    [showLockRecoveryToast, toast, extendHold],
  );
  announceLockExpiredRef.current = announceLockExpired;

  /**
   * Release hold on a seat.
   */
  const releaseHold = useCallback(
    async (seatId: string) => {
      if (socket && isConnected) {
        socket.send(
          JSON.stringify({
            type: "seat_release_request",
            seatId,
            venueId,
            userId: effectiveUserId,
          }),
        );
      }

      // Optimistic client update
      setActiveHolds((prev) => {
        if (!prev[seatId]) return prev;
        const updated = { ...prev };
        delete updated[seatId];
        return updated;
      });

      if (myHeldSeatId === seatId) {
        setMyHeldSeatId(null);
      }

      // Trigger HTTP release in background with keepalive
      try {
        await fetch(`/api/venues/${venueId}/seats/${seatId}/lock`, {
          method: "DELETE",
          keepalive: true,
        });
      } catch {
        // Best effort
      }
    },
    [venueId, isConnected, socket, effectiveUserId, myHeldSeatId],
  );

  /**
   * Complete checkout and permanently unlock seat to confirmed booking.
   */
  const confirmCheckout = useCallback(
    async (seatId: string) => {
      if (socket && isConnected) {
        try {
          socket.send(
            JSON.stringify({
              type: "seat_checkout_complete",
              seatId,
              venueId,
              userId: effectiveUserId,
            }),
          );
        } catch {
          // ignore
        }
      }

      setActiveHolds((prev) => {
        if (!prev[seatId]) return prev;
        const updated = { ...prev };
        delete updated[seatId];
        return updated;
      });

      if (myHeldSeatId === seatId) {
        setMyHeldSeatId(null);
      }

      // Explicitly trigger HTTP release with keepalive
      try {
        await fetch(`/api/venues/${venueId}/seats/${seatId}/lock`, {
          method: "DELETE",
          keepalive: true,
        });
      } catch {
        // Best effort
      }
    },
    [venueId, isConnected, socket, effectiveUserId, myHeldSeatId],
  );

  const isSeatHeldByOther = useCallback(
    (seatId: string): boolean => {
      const hold = activeHolds[seatId];
      return !!hold && !hold.isSelf && hold.remainingSeconds > 0;
    },
    [activeHolds],
  );

  const isSeatHeldByMe = useCallback(
    (seatId: string): boolean => {
      const hold = activeHolds[seatId];
      return !!hold && hold.isSelf && hold.remainingSeconds > 0;
    },
    [activeHolds],
  );

  const getSeatHold = useCallback(
    (seatId: string): SeatHoldInfo | null => {
      return activeHolds[seatId] || null;
    },
    [activeHolds],
  );

  const myHeldSeat = myHeldSeatId ? activeHolds[myHeldSeatId] : null;
  const remainingSeconds = myHeldSeat?.remainingSeconds ?? 0;

  return {
    activeHolds,
    myHeldSeatId,
    remainingSeconds,
    isConnected,
    acquireHold,
    extendHold,
    releaseHold,
    confirmCheckout,
    isSeatHeldByOther,
    isSeatHeldByMe,
    getSeatHold,
  };
}

async function acquireViaHttp(
  venueId: string,
  seatId: string,
  ttlMs: number,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/venues/${venueId}/seats/${seatId}/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlSeconds: Math.ceil(ttlMs / 1000) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
