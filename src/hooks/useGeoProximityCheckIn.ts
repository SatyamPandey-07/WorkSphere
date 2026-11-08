"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getDistanceInMeters } from "@/hooks/useArrivalDetection";
import type { BookingSummary } from "@/components/bookings/BookingList";

export interface GeoProximityOptions {
  proximityRadiusMeters?: number; // Distance in meters to consider "arrived/inside venue" (default: 100m)
  checkInWindowMinutesBefore?: number; // How early before booking time reminder can trigger (default: 45m)
  enableAutoCheckIn?: boolean;
}

export interface GeoProximityState {
  targetBooking: BookingSummary | null;
  distanceMeters: number | null;
  isNearby: boolean;
  isTimeEligible: boolean;
  shouldShowReminder: boolean;
  isCheckedIn: boolean;
  isCheckingIn: boolean;
  autoCheckInEnabled: boolean;
  error: string | null;
  checkInSuccess: boolean;
  setAutoCheckInEnabled: (enabled: boolean) => void;
  triggerCheckIn: () => Promise<boolean>;
  dismissReminder: () => void;
  requestNotificationPermission: () => Promise<NotificationPermission>;
}

export function useGeoProximityCheckIn(
  bookings: BookingSummary[],
  options: GeoProximityOptions = {},
): GeoProximityState {
  const {
    proximityRadiusMeters = 100,
    checkInWindowMinutesBefore = 45,
    enableAutoCheckIn = false,
  } = options;

  const [currentCoords, setCurrentCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [isNearby, setIsNearby] = useState(false);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [checkInSuccess, setCheckInSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedBookingIds, setDismissedBookingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [autoCheckInEnabled, setAutoCheckInEnabled] = useState(enableAutoCheckIn);

  const notifiedBookingRef = useRef<Set<string>>(new Set());
  const autoCheckedInRef = useRef<Set<string>>(new Set());

  // 1. Identify the most immediate active or upcoming booking for today
  const targetBooking = (() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    for (const b of bookings) {
      if (b.status === "CANCELLED") continue;
      if (dismissedBookingIds.has(b.id)) continue;
      if (!b.venue?.latitude || !b.venue?.longitude) continue;

      const bookingStart = new Date(`${b.date}T${b.time}`);
      if (isNaN(bookingStart.getTime())) continue;

      const durationMinutes = b.duration || 60;
      const bookingEnd = new Date(
        bookingStart.getTime() + durationMinutes * 60 * 1000,
      );

      const windowStart = new Date(
        bookingStart.getTime() - checkInWindowMinutesBefore * 60 * 1000,
      );

      // Check if current time falls within window
      if (now >= windowStart && now <= bookingEnd) {
        return b;
      }
    }
    return null;
  })();

  // 2. Watch device geolocation
  useEffect(() => {
    if (!targetBooking || typeof window === "undefined" || !navigator.geolocation) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCurrentCoords({ latitude, longitude });

        const venueLat = targetBooking.venue?.latitude;
        const venueLon = targetBooking.venue?.longitude;

        if (venueLat !== undefined && venueLon !== undefined) {
          const dist = getDistanceInMeters(latitude, longitude, venueLat, venueLon);
          setDistanceMeters(Math.round(dist));
          const inside = dist <= proximityRadiusMeters;
          setIsNearby(inside);
        }
      },
      (err) => {
        console.warn("[GeoProximity] Geolocation watch error:", err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 10000,
      },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [targetBooking, proximityRadiusMeters]);

  // 3. One-tap Check-In Handler
  const triggerCheckIn = useCallback(async (): Promise<boolean> => {
    if (!targetBooking) return false;
    const venueId = targetBooking.venue?.id || targetBooking.venueId;
    if (!venueId) {
      setError("Venue information missing for check-in.");
      return false;
    }

    setIsCheckingIn(true);
    setError(null);

    try {
      const res = await fetch(`/api/venues/${encodeURIComponent(venueId)}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Check-in failed. Please try again.");
      }

      setIsCheckedIn(true);
      setCheckInSuccess(true);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate([100, 50, 100]);
        } catch {}
      }
      return true;
    } catch (err: any) {
      setError(err.message || "Failed to confirm check-in");
      return false;
    } finally {
      setIsCheckingIn(false);
    }
  }, [targetBooking]);

  // 4. Auto check-in trigger if enabled and user enters geofence
  useEffect(() => {
    if (!autoCheckInEnabled || !targetBooking || !isNearby || isCheckedIn || isCheckingIn) {
      return;
    }

    if (!autoCheckedInRef.current.has(targetBooking.id)) {
      autoCheckedInRef.current.add(targetBooking.id);
      void triggerCheckIn();
    }
  }, [autoCheckInEnabled, targetBooking, isNearby, isCheckedIn, isCheckingIn, triggerCheckIn]);

  // 5. Native Web Notification trigger when entering proximity
  useEffect(() => {
    if (!targetBooking || !isNearby || typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    if (Notification.permission === "granted" && !notifiedBookingRef.current.has(targetBooking.id)) {
      notifiedBookingRef.current.add(targetBooking.id);
      try {
        new Notification("📍 Arrived at Venue", {
          body: `You are near ${targetBooking.venue?.name || "your booked workspace"}. Tap to check in to seat ${targetBooking.seatNumber || ""}.`,
          icon: "/favicon.ico",
        });
      } catch {}
    }
  }, [targetBooking, isNearby]);

  const dismissReminder = useCallback(() => {
    if (targetBooking) {
      setDismissedBookingIds((prev) => new Set(prev).add(targetBooking.id));
    }
  }, [targetBooking]);

  const requestNotificationPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "denied";
    }
    return Notification.requestPermission();
  }, []);

  const shouldShowReminder = Boolean(
    targetBooking && !isCheckedIn && !dismissedBookingIds.has(targetBooking.id),
  );

  return {
    targetBooking,
    distanceMeters,
    isNearby,
    isTimeEligible: Boolean(targetBooking),
    shouldShowReminder,
    isCheckedIn,
    isCheckingIn,
    autoCheckInEnabled,
    error,
    checkInSuccess,
    setAutoCheckInEnabled,
    triggerCheckIn,
    dismissReminder,
    requestNotificationPermission,
  };
}
