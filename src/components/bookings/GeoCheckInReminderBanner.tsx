"use client";

import React, { useState } from "react";
import {
  MapPin,
  CheckCircle2,
  Bell,
  Clock,
  Navigation,
  Loader2,
  X,
  Sparkles,
  Zap,
} from "lucide-react";
import type { BookingSummary } from "./BookingList";
import { useGeoProximityCheckIn } from "@/hooks/useGeoProximityCheckIn";

export interface GeoCheckInReminderBannerProps {
  bookings?: BookingSummary[] | null;
  onCheckInSuccess?: () => void;
  className?: string;
  testId?: string;
}

export function GeoCheckInReminderBanner({
  bookings,
  onCheckInSuccess,
  className = "",
  testId = "geo-checkin-banner",
}: GeoCheckInReminderBannerProps) {
  const safeBookings = Array.isArray(bookings) ? bookings : [];

  const {
    targetBooking,
    distanceMeters,
    isNearby,
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
  } = useGeoProximityCheckIn(safeBookings);

  const [notificationPermissionGranted, setNotificationPermissionGranted] =
    useState<boolean>(() => {
      try {
        return typeof window !== "undefined" && "Notification" in window
          ? Notification.permission === "granted"
          : false;
      } catch {
        return false;
      }
    });

  if (!shouldShowReminder && !checkInSuccess) {
    return null;
  }

  const handleCheckIn = async () => {
    try {
      const ok = await triggerCheckIn();
      if (ok) {
        onCheckInSuccess?.();
      }
    } catch {
      // Handled within hook or local state
    }
  };

  const handleEnableNotifications = async () => {
    try {
      const perm = await requestNotificationPermission();
      if (perm === "granted") {
        setNotificationPermissionGranted(true);
      }
    } catch {
      // Ignore permission request rejection
    }
  };

  if (checkInSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid={`${testId}-success`}
        className={`relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/50 via-zinc-900 to-zinc-900 p-4 sm:p-5 shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2 ${className}`.trim()}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <CheckCircle2
                data-testid={`${testId}-success-icon`}
                className="h-5 w-5"
                aria-hidden="true"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4
                  data-testid={`${testId}-success-title`}
                  className="text-sm font-semibold text-white"
                >
                  Checked in to {targetBooking?.venue?.name || "your workspace"}!
                </h4>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <Sparkles className="h-3 w-3" aria-hidden="true" /> Streak Active
                </span>
              </div>
              <p
                data-testid={`${testId}-success-subtitle`}
                className="mt-0.5 text-xs text-zinc-400"
              >
                Seat {targetBooking?.seatNumber || "Reserved"} · Live occupancy updated
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!targetBooking) return null;

  return (
    <div
      role="alert"
      data-testid={testId}
      className={`relative overflow-hidden rounded-2xl border transition-all duration-300 backdrop-blur-md shadow-xl ${
        isNearby
          ? "border-emerald-500/40 bg-gradient-to-r from-emerald-950/60 via-zinc-900/90 to-zinc-900/90"
          : "border-indigo-500/30 bg-gradient-to-r from-indigo-950/50 via-zinc-900/90 to-zinc-900/90"
      } ${className}`.trim()}
    >
      {/* Decorative top accent line */}
      <div
        className={`h-1 w-full ${
          isNearby
            ? "bg-gradient-to-r from-emerald-500 to-teal-400"
            : "bg-gradient-to-r from-indigo-500 to-blue-400"
        }`}
      />

      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3.5">
            <div
              data-testid={`${testId}-icon-container`}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                isNearby
                  ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                  : "border-indigo-500/30 bg-indigo-500/20 text-indigo-400"
              }`}
            >
              {isNearby ? (
                <Navigation
                  data-testid={`${testId}-nav-icon`}
                  className="h-5 w-5 animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <MapPin
                  data-testid={`${testId}-pin-icon`}
                  className="h-5 w-5"
                  aria-hidden="true"
                />
              )}
              {isNearby && (
                <span className="absolute -right-1 -top-1 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                </span>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-testid={`${testId}-status-pill`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    isNearby
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
                      : "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isNearby ? "bg-emerald-400 animate-ping" : "bg-indigo-400"
                    }`}
                  />
                  {isNearby
                    ? "Arrived · Inside Venue Geofence"
                    : "Upcoming Check-In Reminder"}
                </span>

                {distanceMeters !== null && (
                  <span
                    data-testid={`${testId}-distance`}
                    className="text-xs text-zinc-400 font-mono"
                  >
                    📍 {distanceMeters}m away
                  </span>
                )}
              </div>

              <h3
                data-testid={`${testId}-venue-name`}
                className="text-base font-semibold text-white"
              >
                {targetBooking.venue?.name || "Booked Workspace"}
              </h3>

              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                <span
                  data-testid={`${testId}-time-duration`}
                  className="flex items-center gap-1"
                >
                  <Clock className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                  {targetBooking.time} ({targetBooking.duration || 60} min)
                </span>
                {targetBooking.seatNumber && (
                  <span
                    data-testid={`${testId}-seat-number`}
                    className="font-medium text-zinc-300"
                  >
                    Seat: {targetBooking.seatNumber}
                  </span>
                )}
                {targetBooking.venue?.address && (
                  <span
                    data-testid={`${testId}-venue-address`}
                    className="hidden truncate max-w-[200px] text-zinc-500 sm:inline"
                  >
                    {targetBooking.venue.address}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-end md:self-center">
            {/* Native browser notifications prompt if not granted */}
            {!notificationPermissionGranted &&
              typeof window !== "undefined" &&
              "Notification" in window && (
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  data-testid={`${testId}-notifications-btn`}
                  title="Enable browser notifications for arrival triggers"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <Bell className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                  <span className="hidden sm:inline">Alerts</span>
                </button>
              )}

            {/* Auto Check-in Toggle */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-300 hover:bg-white/10 transition-colors">
              <input
                type="checkbox"
                checked={autoCheckInEnabled}
                onChange={(e) => setAutoCheckInEnabled(e.target.checked)}
                data-testid={`${testId}-autocheckin-checkbox`}
                className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
              />
              <Zap className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span className="hidden sm:inline">Auto-check-in</span>
            </label>

            {/* 1-Tap Check-In CTA */}
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={isCheckingIn}
              data-testid={`${testId}-checkin-btn`}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-md hover:from-emerald-500 hover:to-teal-400 disabled:opacity-50 transition-all cursor-pointer"
            >
              {isCheckingIn ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Checking In...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Check In Now
                </>
              )}
            </button>

            {/* Dismiss Button */}
            <button
              type="button"
              onClick={dismissReminder}
              aria-label="Dismiss check-in reminder"
              data-testid={`${testId}-dismiss-btn`}
              className="rounded-xl border border-transparent p-2 text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-zinc-200 transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {error && (
          <p
            data-testid={`${testId}-error`}
            role="alert"
            className="mt-2 text-xs text-rose-400"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default GeoCheckInReminderBanner;
