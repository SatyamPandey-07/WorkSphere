"use client";

import { useState } from "react";
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
  bookings: BookingSummary[];
  onCheckInSuccess?: () => void;
}

export function GeoCheckInReminderBanner({
  bookings,
  onCheckInSuccess,
}: GeoCheckInReminderBannerProps) {
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
  } = useGeoProximityCheckIn(bookings);

  const [notificationPermission, setNotificationPermission] =
    useState<string>(() =>
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "denied",
    );

  if (!shouldShowReminder && !checkInSuccess) {
    return null;
  }

  const handleCheckIn = async () => {
    const ok = await triggerCheckIn();
    if (ok) {
      onCheckInSuccess?.();
    }
  };

  const handleEnableNotifications = async () => {
    const perm = await requestNotificationPermission();
    if (typeof perm === "string") {
      setNotificationPermission(perm);
    }
  };

  if (checkInSuccess) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/50 via-zinc-900 to-zinc-900 p-4 sm:p-5 shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-white">
                  Checked in to {targetBooking?.venue?.name || "your workspace"}!
                </h4>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <Sparkles className="h-3 w-3" /> Streak Active
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">
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
      className={`relative overflow-hidden rounded-2xl border transition-all duration-300 backdrop-blur-md shadow-xl ${
        isNearby
          ? "border-emerald-500/40 bg-gradient-to-r from-emerald-950/60 via-zinc-900/90 to-zinc-900/90"
          : "border-indigo-500/30 bg-gradient-to-r from-indigo-950/50 via-zinc-900/90 to-zinc-900/90"
      }`}
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
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                isNearby
                  ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                  : "border-indigo-500/30 bg-indigo-500/20 text-indigo-400"
              }`}
            >
              {isNearby ? (
                <Navigation className="h-5 w-5 animate-pulse" />
              ) : (
                <MapPin className="h-5 w-5" />
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
                  <span className="text-xs text-zinc-400 font-mono">
                    📍 {distanceMeters}m away
                  </span>
                )}
              </div>

              <h3 className="text-base font-semibold text-white">
                {targetBooking.venue?.name || "Booked Workspace"}
              </h3>

              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-zinc-500" />
                  {targetBooking.time} ({targetBooking.duration || 60} min)
                </span>
                {targetBooking.seatNumber && (
                  <span className="font-medium text-zinc-300">
                    Seat: {targetBooking.seatNumber}
                  </span>
                )}
                {targetBooking.venue?.address && (
                  <span className="hidden truncate max-w-[200px] text-zinc-500 sm:inline">
                    {targetBooking.venue.address}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-end md:self-center">
            {/* Native browser notifications prompt if not yet decided */}
            {notificationPermission === "default" &&
              typeof window !== "undefined" &&
              "Notification" in window && (
              <button
                type="button"
                onClick={handleEnableNotifications}
                title="Enable browser notifications for arrival triggers"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
              >
                <Bell className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden sm:inline">Alerts</span>
              </button>
            )}

            {/* Auto Check-in Toggle */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-300 hover:bg-white/10 transition-colors">
              <input
                type="checkbox"
                checked={autoCheckInEnabled}
                onChange={(e) => setAutoCheckInEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
              />
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Auto-check-in</span>
            </label>

            {/* 1-Tap Check-In CTA */}
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={isCheckingIn}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-md hover:from-emerald-500 hover:to-teal-400 disabled:opacity-50 transition-all cursor-pointer"
            >
              {isCheckingIn ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking In...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Check In Now
                </>
              )}
            </button>

            {/* Dismiss Button */}
            <button
              type="button"
              onClick={dismissReminder}
              aria-label="Dismiss check-in reminder"
              className="rounded-xl border border-transparent p-2 text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-zinc-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-2 text-xs text-rose-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
