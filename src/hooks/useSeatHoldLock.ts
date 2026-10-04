"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import usePartySocket from "@/hooks/usePartySocketReconnect";
import { useAuth, useUser } from "@clerk/nextjs";

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
}

export function useSeatHoldLock({
  venueId,
  userId: propUserId,
  userName: propUserName,
  room,
  onHoldAcquired,
  onHoldRejected,
  onHoldExpired,
  onSeatLocked,
  onSeatUnlocked,
}: UseSeatHoldLockOptions) {
  const { userId: authUserId } = useAuth();
  const { user } = useUser();
  const effectiveUserId = propUserId || authUserId || "guest_viewer";
  const effectiveUserName =
    propUserName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    "User";

  const [activeHolds, setActiveHolds] = useState<Record<string, SeatHoldInfo>>(
    {},
  );
  const [myHeldSeatId, setMyHeldSeatId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

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
    startClosed: !isMounted,
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
      } catch {
        // Ignore unparseable frames
      }
    },
  });

  // Client-side 1-second countdown ticker & auto-release expired locks without page reload
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveHolds((prev) => {
        let hasChanges = false;
        const now = Date.now();
        const next: Record<string, SeatHoldInfo> = {};

        for (const [seatId, hold] of Object.entries(prev)) {
          if (now >= hold.expiresAt) {
            hasChanges = true;
            if (hold.isSelf) {
              setMyHeldSeatId((current) => (current === seatId ? null : current));
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

      // Trigger HTTP release in background
      try {
        await fetch(`/api/venues/${venueId}/seats/${seatId}/lock`, {
          method: "DELETE",
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
        socket.send(
          JSON.stringify({
            type: "seat_checkout_complete",
            seatId,
            venueId,
            userId: effectiveUserId,
          }),
        );
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
