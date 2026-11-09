"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import usePartySocket from "@/hooks/usePartySocketReconnect";
import {
  useSeatAvailability,
  type SeatAvailability,
  type SeatStatus,
} from "@/hooks/useSeatAvailability";
import { throttle } from "@/lib/utils";

export interface MapCursor {
  lat: number;
  lng: number;
  name: string;
  avatar: string;
}

export interface UseMapRealtimeSyncOptions {
  roomId?: string | null;
  isMounted?: boolean;
  token?: string | null;
  user?: any;
  initialLocation?: { latitude: number; longitude: number };
  enableGeolocationWatch?: boolean;
  throttleIntervalMs?: number;
}

export interface UseMapRealtimeSyncReturn {
  // PartyKit cursor state & broadcaster
  mapCursors: Record<string, MapCursor>;
  throttledBroadcast: (latlng: L.LatLng) => void;
  socket: any;

  // Seat availability presence state & operations
  getAvailability: (venueId: string) => SeatAvailability;
  checkIn: (venueId: string) => void;
  checkOut: () => void;
  checkedInVenueId: string | null;
  isSeatSocketConnected: boolean;
  availability: Record<string, SeatAvailability>;

  // Geolocation tracking state
  currentLocation: { latitude: number; longitude: number } | null;
  locationError: string | null;
  isTrackingLocation: boolean;
}

/**
 * Hook encapsulating real-time map synchronization:
 * - Multi-user PartyKit cursor tracking and broadcast
 * - Live seat occupancy updates and check-in / check-out
 * - Device geolocation watching and position updates
 */
export function useMapRealtimeSync({
  roomId,
  isMounted = true,
  token = null,
  user = null,
  initialLocation,
  enableGeolocationWatch = false,
  throttleIntervalMs = 50,
}: UseMapRealtimeSyncOptions): UseMapRealtimeSyncReturn {
  // --- 1. PartyKit Cursor Presence Tracking ---
  const [mapCursors, setMapCursors] = useState<Record<string, MapCursor>>({});
  const cursorLastSeen = useRef<Record<string, number>>({});

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMapCursors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [userId, lastSeen] of Object.entries(cursorLastSeen.current)) {
          if (now - lastSeen > 3000) {
            delete next[userId];
            delete cursorLastSeen.current[userId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const socket = usePartySocket({
    host: "127.0.0.1:1999",
    room: isMounted && roomId ? roomId : "placeholder",
    startClosed: !isMounted,
    query: token ? { token } : undefined,
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "map-cursor") {
          const userId = data.userId || data.name;
          cursorLastSeen.current[userId] = Date.now();
          setMapCursors((prev) => ({
            ...prev,
            [userId]: {
              lat: data.lat,
              lng: data.lng,
              name: data.name,
              avatar: data.avatar,
            },
          }));
        } else if (data.type === "map-cursor-offline") {
          const userId = data.userId || data.name;
          delete cursorLastSeen.current[userId];
          setMapCursors((prev) => {
            if (!(userId in prev)) return prev;
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }
      } catch {
        // Ignore JSON parse errors
      }
    },
  });

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const throttledBroadcastRef = useRef<((latlng: L.LatLng) => void) | null>(null);

  useEffect(() => {
    throttledBroadcastRef.current = throttle((latlng: L.LatLng) => {
      if (socket && socket.readyState === 1) {
        const currentUser = userRef.current?.user ?? userRef.current;
        socket.send(
          JSON.stringify({
            type: "map-cursor",
            lat: latlng.lat,
            lng: latlng.lng,
            name: currentUser?.firstName || "Anonymous",
            avatar: currentUser?.imageUrl || "default",
            userId: currentUser?.id || "anonymous",
          }),
        );
      }
    }, throttleIntervalMs);
  }, [socket, throttleIntervalMs]);

  const throttledBroadcast = useCallback((latlng: L.LatLng) => {
    if (throttledBroadcastRef.current) {
      throttledBroadcastRef.current(latlng);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (socket && socket.readyState === 1) {
        const currentUser = userRef.current?.user ?? userRef.current;
        try {
          socket.send(
            JSON.stringify({
              type: "map-cursor-offline",
              name: currentUser?.firstName || "Anonymous",
              userId: currentUser?.id || "anonymous",
            }),
          );
        } catch {
          // Ignore send errors on unmount
        }
      }
    };
  }, [socket]);

  // --- 2. Real-Time Seat Availability Subscription ---
  const {
    getAvailability,
    checkIn,
    checkOut,
    checkedInVenueId,
    isConnected: isSeatSocketConnected,
    availability,
  } = useSeatAvailability();

  // --- 3. Geolocation Tracking ---
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(initialLocation ?? null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isTrackingLocation, setIsTrackingLocation] = useState<boolean>(false);

  useEffect(() => {
    if (!enableGeolocationWatch || typeof window === "undefined" || !navigator?.geolocation) {
      return;
    }

    setIsTrackingLocation(true);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setCurrentLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setLocationError(null);
      },
      (err) => {
        setLocationError(err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      setIsTrackingLocation(false);
    };
  }, [enableGeolocationWatch]);

  return {
    mapCursors,
    throttledBroadcast,
    socket,
    getAvailability,
    checkIn,
    checkOut,
    checkedInVenueId,
    isSeatSocketConnected,
    availability,
    currentLocation,
    locationError,
    isTrackingLocation,
  };
}

export default useMapRealtimeSync;
export type { SeatAvailability, SeatStatus };
