"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  PlusCircle,
} from "lucide-react";
import { downloadICS, generateICSContent } from "@/lib/calendar";

export interface RescheduleBookingData {
  id: string;
  confirmationId: string;
  date: string;
  time: string;
  duration?: number | null;
  seatNumber?: string | null;
  seatId?: string | null;
  venue?: {
    name: string;
    address?: string | null;
  } | null;
}

interface RescheduleModalProps {
  booking: RescheduleBookingData | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (updatedBooking: any) => void;
}

const DURATION_PRESETS = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "1.5h", minutes: 90 },
  { label: "2h", minutes: 120 },
  { label: "3h", minutes: 180 },
  { label: "4h", minutes: 240 },
  { label: "Full Day", minutes: 480 },
];

function localTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calculateEndTime(startTime: string, durationMinutes: number): string {
  if (!startTime) return "";
  const [h, m] = startTime.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  const totalMinutes = h * 60 + m + durationMinutes;
  const endHour = Math.floor(totalMinutes / 60) % 24;
  const endMinute = totalMinutes % 60;
  return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
}

/**
 * Generates RFC 5545 compliant iCalendar (.ics) string for rescheduled booking.
 */
export function generateRescheduledICS(
  booking: RescheduleBookingData,
  date: string,
  time: string,
  duration: number,
  alarmMinutes = 15,
): string {
  return generateICSContent({
    venueName: booking.venue?.name || "Workspace",
    venueAddress: booking.venue?.address || "",
    date,
    time,
    durationMinutes: duration,
    confirmationId: booking.confirmationId,
    bookingId: booking.id,
    alarmMinutes,
  });
}

export function RescheduleModal({
  booking,
  isOpen,
  onClose,
  onSuccess,
}: RescheduleModalProps) {
  const today = localTodayString();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (booking && isOpen) {
      setDate(booking.date || today);
      setTime(booking.time || "09:00");
      setDuration(booking.duration || 60);
      setError(null);
      setSuccessMessage(null);
      setIsSuccess(false);
    }
  }, [booking, isOpen, today]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !booking) return null;

  const endTime = calculateEndTime(time, duration);
  const venueName = booking.venue?.name || "Workspace";
  const isExtension =
    date === booking.date &&
    time === booking.time &&
    duration > (booking.duration || 60);

  const handleQuickExtend = (extraMinutes: number) => {
    setDuration((prev) => Math.min(480, prev + extraMinutes));
  };

  const handleDownloadICS = () => {
    downloadICS({
      venueName,
      venueAddress: booking.venue?.address || "",
      date,
      time,
      durationMinutes: duration,
      confirmationId: booking.confirmationId,
      bookingId: booking.id,
      alarmMinutes: 15,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) {
      setError("Please choose a valid date and start time.");
      return;
    }
    if (date < today) {
      setError("Please choose today or a future date.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          time,
          duration,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to reschedule booking.");
      }

      setSuccessMessage(
        isExtension
          ? `Booking extended to ${duration} min (${endTime})!`
          : "Booking successfully rescheduled!",
      );
      setIsSuccess(true);

      if (onSuccess) {
        onSuccess(data.booking);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update booking. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[25000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-modal-title"
        data-testid="reschedule-modal"
        className="w-full max-w-lg rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h3
              id="reschedule-modal-title"
              className="text-lg font-bold tracking-tight flex items-center gap-2"
            >
              {isSuccess ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  Booking Confirmed
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5 text-violet-500" />
                  Reschedule / Extend Booking
                </>
              )}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {venueName}
              {booking.seatNumber ? ` · Seat ${booking.seatNumber}` : ""}
              <span className="ml-1 font-mono text-zinc-400">
                ({booking.confirmationId})
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Step View */}
        {isSuccess ? (
          <div
            data-testid="reschedule-success-step"
            className="py-5 flex flex-col items-center text-center gap-4 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h4 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {isExtension ? "Booking Extended!" : "Booking Rescheduled!"}
              </h4>
              <p className="text-xs text-zinc-500 mt-1">
                {successMessage || (
                  <>
                    Your reservation at{" "}
                    <strong className="text-zinc-700 dark:text-zinc-300">
                      {venueName}
                    </strong>{" "}
                    has been updated.
                  </>
                )}
              </p>
            </div>

            {/* Updated booking summary card */}
            <div className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 p-4 text-xs space-y-2 text-left">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Venue</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {venueName}
                </span>
              </div>
              {booking.venue?.address && (
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Location</span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300 text-right max-w-[240px] truncate">
                    {booking.venue.address}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Updated Schedule</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {date} · {time} – {endTime} ({duration} min)
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Booking Reference</span>
                <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                  {booking.confirmationId}
                </span>
              </div>
            </div>

            {/* Success Actions */}
            <div className="w-full flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleDownloadICS}
                data-testid="add-to-calendar-ics-btn"
                className="flex-1 py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm transition flex items-center justify-center gap-2 shadow-sm"
              >
                <Calendar className="w-4 h-4" />
                <span>Add to Calendar (.ics)</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                data-testid="reschedule-done-btn"
                className="py-2.5 px-5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-sm transition"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Current booking summary banner */}
            <div className="my-4 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 flex items-center justify-between text-xs">
              <div>
                <span className="text-zinc-500 font-medium">
                  Current schedule:
                </span>
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {booking.date} · {booking.time} ({booking.duration || 60} min)
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="quick-extend-30m"
                  onClick={() => handleQuickExtend(30)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/60 transition"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> +30m
                </button>
                <button
                  type="button"
                  data-testid="quick-extend-1h"
                  onClick={() => handleQuickExtend(60)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/60 transition"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> +1h
                </button>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reschedule-date"
                    className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1"
                  >
                    New Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="date"
                      id="reschedule-date"
                      data-testid="reschedule-date-input"
                      min={today}
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500 transition"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reschedule-time"
                    className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1"
                  >
                    Start Time
                  </label>
                  <div className="relative">
                    <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="time"
                      id="reschedule-time"
                      data-testid="reschedule-time-input"
                      required
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500 transition"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    Duration
                  </label>
                  {endTime && (
                    <span className="text-xs text-zinc-500">
                      Ends at{" "}
                      <strong className="text-zinc-700 dark:text-zinc-300">
                        {endTime}
                      </strong>{" "}
                      ({duration} min)
                    </span>
                  )}
                </div>

                <div
                  className="flex flex-wrap gap-2"
                  data-testid="reschedule-duration-presets"
                >
                  {DURATION_PRESETS.map((preset) => {
                    const isSelected = duration === preset.minutes;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        data-testid={`reschedule-duration-${preset.label.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => setDuration(preset.minutes)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                          isSelected
                            ? "bg-violet-600 text-white font-semibold shadow-sm ring-2 ring-violet-500/30"
                            : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !date || !time}
                  data-testid="reschedule-submit-button"
                  className="flex-1 py-3 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading
                    ? "Checking & Saving..."
                    : isExtension
                      ? "Confirm Extension"
                      : "Confirm Reschedule"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
