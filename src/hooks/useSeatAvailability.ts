/**
 * Real-time seat availability (#703)
 *
 * Broadcasts/receives venue seat check-ins over a dedicated PartyKit room
 * so the map's seat-availability ring layer can update live without a page
 * refresh. This intentionally uses its own room ("seat-availability")
 * rather than the per-folder Yjs document rooms in useRealTime.tsx, since
 * seat presence isn't part of any single folder's shared document.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "partysocket/react";
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

// Mirrors the server-side default in party/server.ts — used so the UI can
// render a sensible ring for venues nobody has checked into yet.
export const DEFAULT_SEAT_CAPACITY = 8;

const SEAT_ROOM = "seat-availability";

interface SeatUpdateMessage {
  type: "seat_update";
  venueId: string;
  count: number;
  capacity: number;
  status: SeatStatus;
}

interface SeatSnapshotMessage {
  type: "seat_snapshot";
  venues: Array<Omit<SeatUpdateMessage, "type">>;
}

export function useSeatAvailability() {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [availability, setAvailability] = useState<
    Record<string, SeatAvailability>
  >({});
  const [isConnected, setIsConnected] = useState(false);
  const [checkedInVenueId, setCheckedInVenueId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Mirrors checkedInVenueId in a ref so send handlers stay stable across
  // renders without needing checkedInVenueId itself as a dependency.
  const checkedInVenueRef = useRef<string | null>(null);

  useEffect(() => {
    getToken()
      .then(setToken)
      .catch(() => setToken(null));
  }, [getToken]);

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999",
    room: isMounted ? SEAT_ROOM : "seat-availability",
    startClosed: !isMounted,
    query: token ? { token } : undefined,
    onOpen() {
      setIsConnected(true);
    },
    onClose() {
      setIsConnected(false);
    },
    onMessage(event) {
      try {
        const data = JSON.parse(event.data) as
          SeatUpdateMessage | SeatSnapshotMessage;

        if (data.type === "seat_update") {
          setAvailability((prev) => ({
            ...prev,
            [data.venueId]: {
              venueId: data.venueId,
              count: data.count,
              capacity: data.capacity,
              status: data.status,
            },
          }));
        } else if (data.type === "seat_snapshot") {
          setAvailability((prev) => {
            const next = { ...prev };
            for (const venue of data.venues) {
              next[venue.venueId] = { ...venue };
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
    (venueId: string, capacity: number = DEFAULT_SEAT_CAPACITY) => {
      checkedInVenueRef.current = venueId;
      setCheckedInVenueId(venueId);

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        queueOfflineCheckIn(venueId).catch(console.error);
        toast("You are offline. Check-in queued for sync.", "success");
      } else {
        socket?.send(
          JSON.stringify({ type: "seat_checkin", venueId, capacity }),
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
            // Also notify partykit so other users see the seat update
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

  // Best-effort checkout if the component unmounts while checked in, so we
  // don't leave a stale "occupied" seat until the socket eventually times out.
  useEffect(() => {
    return () => {
      if (checkedInVenueRef.current) {
        try {
          socket?.send(JSON.stringify({ type: "seat_checkout" }));
        } catch {
          // Socket may already be closed on unmount — nothing to do.
        }
      }
    };
  }, [socket]);

  const getAvailability = useCallback(
    (venueId: string): SeatAvailability => {
      return (
        availability[venueId] ?? {
          venueId,
          count: 0,
          capacity: DEFAULT_SEAT_CAPACITY,
          status: "green",
        }
      );
    },
    [availability],
  );

  return {
    availability,
    getAvailability,
    checkIn,
    checkOut,
    checkedInVenueId,
    isConnected: isMounted && isConnected,
  };
}
