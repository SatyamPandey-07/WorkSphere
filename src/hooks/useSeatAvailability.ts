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
  const [checkedInVenueId, setCheckedInVenueId] = useState<string | null>(
    null,
  );
  // Mirrors checkedInVenueId in a ref so send handlers stay stable across
  // renders without needing checkedInVenueId itself as a dependency.
  const checkedInVenueRef = useRef<string | null>(null);

  useEffect(() => {
    getToken()
      .then(setToken)
      .catch(() => setToken(null));
  }, [getToken]);

  const socket = usePartySocket({
    host: "127.0.0.1:1999",
    room: SEAT_ROOM,
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
          | SeatUpdateMessage
          | SeatSnapshotMessage;

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

  const checkIn = useCallback(
    (venueId: string, capacity: number = DEFAULT_SEAT_CAPACITY) => {
      checkedInVenueRef.current = venueId;
      setCheckedInVenueId(venueId);
      socket.send(JSON.stringify({ type: "seat_checkin", venueId, capacity }));
    },
    [socket],
  );

  const checkOut = useCallback(() => {
    checkedInVenueRef.current = null;
    setCheckedInVenueId(null);
    socket.send(JSON.stringify({ type: "seat_checkout" }));
  }, [socket]);

  // Best-effort checkout if the component unmounts while checked in, so we
  // don't leave a stale "occupied" seat until the socket eventually times out.
  useEffect(() => {
    return () => {
      if (checkedInVenueRef.current) {
        try {
          socket.send(JSON.stringify({ type: "seat_checkout" }));
        } catch {
          // Socket may already be closed on unmount — nothing to do.
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    isConnected,
  };
}
