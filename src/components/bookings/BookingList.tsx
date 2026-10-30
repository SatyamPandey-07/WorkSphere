"use client";

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  Ban,
  Calendar,
  CalendarPlus,
  Download,
  Inbox,
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { getCalendarUrls, downloadICS } from "@/lib/calendar";
import { BookingHistoryList } from "@/app/dashboard/BookingHistoryList";
import { ExportBookingsCSVButton } from "@/components/bookings/ExportBookingsCSVButton";
import { RescheduleModal } from "@/components/bookings/RescheduleModal";
import { SplitBillModal } from "@/components/bookings/SplitBillModal";
import { GeoCheckInReminderBanner } from "@/components/bookings/GeoCheckInReminderBanner";
import { MobileWalletPassModal } from "@/components/bookings/MobileWalletPassModal";
import { CopyBookingReferenceButton } from "@/components/bookings/CopyBookingReferenceButton";

export interface BookingSummary {
  id: string;
  confirmationId: string;
  date: string;
  time: string;
  status?: "CONFIRMED" | "PENDING" | "CANCELLED";
  seatNumber?: string | null;
  duration?: number | null;
  timeZone?: string | null;
  createdAt: string;
  venueId?: string;
  venue: {
    id?: string;
    name: string;
    category?: string;
    address?: string | null;
    latitude?: number;
    longitude?: number;
  } | null;
}

export function isUpcoming(booking: BookingSummary): boolean {
  if (!booking?.date || !booking?.time) return false;
  const start = new Date(`${booking.date}T${booking.time}`);
  return !isNaN(start.getTime()) && start.getTime() > Date.now();
}

const chipClass =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors";

export interface BookingListProps {
  initialBookings?: BookingSummary[];
  onCountsChange?: (counts: { upcoming: number; total: number }) => void;
  className?: string;
  testId?: string;
}

/**
 * The signed-in user's bookings: upcoming first, with cancel, receipt,
 * calendar and bulk export actions.
 */
export function BookingList({
  initialBookings,
  onCountsChange,
  className = "",
  testId = "booking-list-container",
}: BookingListProps) {
  const [bookings, setBookings] = useState<BookingSummary[]>(
    Array.isArray(initialBookings) ? initialBookings : [],
  );
  const [loading, setLoading] = useState(initialBookings === undefined);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [reschedulingBooking, setReschedulingBooking] =
    useState<BookingSummary | null>(null);
  const [splitBillBooking, setSplitBillBooking] =
    useState<BookingSummary | null>(null);
  const [walletBooking, setWalletBooking] = useState<BookingSummary | null>(
    null,
  );

  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/history");
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!isMountedRef.current) return;
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
      setSelectedIds(new Set());
    } catch {
      if (!isMountedRef.current) return;
      setError("We couldn't load your bookings. Please try again.");
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (initialBookings === undefined) {
      void load();
    }
  }, [initialBookings, load]);

  const { upcoming, rest } = useMemo(() => {
    const active = (b: BookingSummary) =>
      b?.status !== "CANCELLED" && isUpcoming(b);
    return {
      upcoming: bookings
        .filter(active)
        .sort((a, b) =>
          `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`),
        ),
      rest: bookings
        .filter((b) => !active(b))
        .sort((a, b) =>
          `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`),
        ),
    };
  }, [bookings]);

  useEffect(() => {
    onCountsChange?.({ upcoming: upcoming.length, total: bookings.length });
  }, [upcoming.length, bookings.length, onCountsChange]);

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cancelBooking = async (booking: BookingSummary) => {
    if (
      !confirm(
        `Cancel your booking at ${booking?.venue?.name ?? "this venue"} on ${booking?.date ?? ""}?`,
      )
    ) {
      return;
    }
    setCancellingId(booking.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!isMountedRef.current) return;
      if (!res.ok) {
        throw new Error(data.error || "Couldn't cancel this booking.");
      }
      setBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id ? { ...b, status: "CANCELLED" } : b,
        ),
      );
      setMessage({ kind: "ok", text: "Booking cancelled." });
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : "Cancellation failed";
      setMessage({ kind: "error", text: msg });
    } finally {
      if (isMountedRef.current) {
        setCancellingId(null);
      }
    }
  };

  const exportSelected = async (format: "pdf" | "csv" | "xlsx") => {
    setIsExporting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/bookings/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingIds: Array.from(selectedIds), format }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      if (!isMountedRef.current) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WorkSphere_Bookings.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      if (!isMountedRef.current) return;
      setMessage({ kind: "error", text: "Export failed. Please try again." });
    } finally {
      if (isMountedRef.current) {
        setIsExporting(false);
      }
    }
  };

  const renderBooking = (booking: BookingSummary) => {
    const cancelled = booking?.status === "CANCELLED";
    const future = !cancelled && isUpcoming(booking);
    const venueName = booking?.venue?.name ?? "Workspace";
    const address = booking?.venue?.address ?? "";

    return (
      <li
        key={booking.id}
        data-testid={`booking-card-${booking.id}`}
        className={`rounded-2xl border p-4 transition-colors bg-white dark:bg-zinc-900 ${
          selectedIds.has(booking.id)
            ? "accent-border"
            : "border-zinc-200 dark:border-zinc-800"
        } ${cancelled ? "opacity-60" : ""}`}
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selectedIds.has(booking.id)}
            onChange={() => toggleSelected(booking.id)}
            aria-label={`Select booking ${booking.confirmationId}`}
            data-testid={`booking-checkbox-${booking.id}`}
            className="w-4 h-4 mt-1 cursor-pointer shrink-0"
            style={{ accentColor: "var(--primary-accent)" }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold truncate">{venueName}</h4>
              <span
                data-testid={`booking-status-${booking.id}`}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  cancelled
                    ? "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                    : future
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {cancelled ? "Cancelled" : future ? "Upcoming" : "Completed"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">
              <span>
                {booking.date} · {booking.time}
                {booking.seatNumber ? ` · Seat ${booking.seatNumber}` : ""}
              </span>
              <div className="inline-flex items-center gap-1">
                <span className="font-mono text-xs text-zinc-400">
                  {booking.confirmationId}
                </span>
                <CopyBookingReferenceButton
                  referenceId={booking.confirmationId}
                  tooltipPosition="top"
                  className="!p-1 !rounded-md"
                />
              </div>
            </div>
            {address && (
              <p className="text-xs text-zinc-500 flex items-center gap-1 mt-1 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                {address}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3 pl-7">
          <a
            href={`/api/bookings/${booking.id}/download`}
            className={chipClass}
            aria-label="Download receipt"
            data-testid={`booking-receipt-link-${booking.id}`}
          >
            <Download className="w-3.5 h-3.5" />
            Receipt
          </a>
          <a
            href={`/api/bookings/${booking.id}/itinerary`}
            className={chipClass}
            aria-label="Export booking itinerary as PDF with QR code verification badge"
            data-testid={`booking-itinerary-link-${booking.id}`}
          >
            <QrCode className="w-3.5 h-3.5 text-blue-500" />
            Itinerary PDF
          </a>
          {future && (
            <>
              <a
                href={
                  getCalendarUrls(
                    venueName,
                    address,
                    booking.date,
                    booking.time,
                    booking.duration || 60,
                    booking.timeZone ?? undefined,
                  ).googleUrl
                }
                target="_blank"
                rel="noopener noreferrer"
                className={chipClass}
                data-testid={`booking-google-calendar-${booking.id}`}
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                Google Calendar
              </a>
              <button
                type="button"
                onClick={() =>
                  downloadICS(venueName, address, booking.date, booking.time, {
                    durationMinutes: booking.duration || 60,
                    confirmationId: booking.confirmationId,
                    timezone: booking.timeZone ?? undefined,
                  })
                }
                className={chipClass}
                aria-label={`Download iCalendar file for booking ${booking.confirmationId}`}
                data-testid={`booking-ics-btn-${booking.id}`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Add to Calendar (.ics)
              </button>
              <button
                type="button"
                onClick={() => setReschedulingBooking(booking)}
                className={chipClass}
                aria-label={`Reschedule or extend booking ${booking.confirmationId}`}
                data-testid={`booking-reschedule-btn-${booking.id}`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reschedule / Extend
              </button>
              <button
                type="button"
                onClick={() => setSplitBillBooking(booking)}
                className={chipClass}
                aria-label={`Split bill & generate guest payment links for booking ${booking.confirmationId}`}
                data-testid={`booking-split-bill-btn-${booking.id}`}
              >
                <span className="text-xs">💳</span>
                Split Bill &amp; Passes
              </button>
              <button
                type="button"
                onClick={() => setWalletBooking(booking)}
                className={chipClass}
                aria-label={`Add booking ${booking.confirmationId} to Apple or Google Wallet`}
                data-testid={`booking-wallet-pass-btn-${booking.id}`}
              >
                <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                Apple / Google Pass
              </button>
              <button
                type="button"
                onClick={() => cancelBooking(booking)}
                disabled={cancellingId === booking.id}
                data-testid={`booking-cancel-btn-${booking.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                {cancellingId === booking.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Ban className="w-3.5 h-3.5" />
                )}
                Cancel
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  if (loading) {
    return (
      <div
        data-testid="booking-loading"
        className="py-16 flex flex-col items-center gap-3 text-zinc-500"
        role="status"
      >
        <Loader2 className="w-8 h-8 accent-text animate-spin" />
        <p className="text-sm">Loading your bookings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="booking-error" className="py-12 text-center space-y-3">
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={load}
          data-testid="booking-retry-btn"
          className="text-sm font-medium accent-text"
        >
          Try again
        </button>
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div
        data-testid="booking-empty"
        className="py-16 flex flex-col items-center text-center gap-3"
      >
        <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <Inbox className="w-8 h-8 text-zinc-400" />
        </div>
        <h3 className="font-semibold">No bookings yet</h3>
        <p className="text-sm text-zinc-500 max-w-xs">
          Find a workspace in Discover and reserve a spot — it will show up
          here.
        </p>
      </div>
    );
  }

  return (
    <div data-testid={testId} className={`space-y-5 ${className}`.trim()}>
      <GeoCheckInReminderBanner bookings={bookings} onCheckInSuccess={load} />

      {message && (
        <p
          role="status"
          data-testid="booking-status-message"
          className={`text-sm ${message.kind === "ok" ? "text-green-600" : "text-red-600"}`}
        >
          {message.text}
        </p>
      )}
      {bookings.length > 10 ? (
        <BookingHistoryList
          bookings={bookings}
          onCancelBooking={cancelBooking}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          cancellingId={cancellingId}
        />
      ) : (
        <>
          <div className="flex items-center justify-between pb-1">
            <span
              data-testid="booking-count-summary"
              className="text-xs text-zinc-500 font-medium"
            >
              {bookings.length} {bookings.length === 1 ? "booking" : "bookings"}{" "}
              recorded
            </span>
            <ExportBookingsCSVButton
              bookings={bookings}
              label="Export CSV"
              variant="outline"
            />
          </div>
          {upcoming.length > 0 && (
            <section data-testid="upcoming-bookings-section">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                Upcoming
              </h3>
              <ul className="space-y-3">{upcoming.map(renderBooking)}</ul>
            </section>
          )}
          {rest.length > 0 && (
            <section data-testid="past-bookings-section">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                Past &amp; cancelled
              </h3>
              <ul className="space-y-3">{rest.map(renderBooking)}</ul>
            </section>
          )}
        </>
      )}

      {selectedIds.size > 0 && (
        <div
          data-testid="bulk-actions-toolbar"
          className="sticky bottom-4 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-3 shadow-lg"
        >
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => exportSelected("csv")}
              disabled={isExporting}
              data-testid="bulk-export-csv-btn"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportSelected("xlsx")}
              disabled={isExporting}
              data-testid="bulk-export-excel-btn"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 disabled:opacity-50"
            >
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => exportSelected("pdf")}
              disabled={isExporting}
              data-testid="bulk-export-pdf-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold accent-bg text-white disabled:opacity-50"
            >
              {isExporting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Export PDF
            </button>
          </div>
        </div>
      )}

      <RescheduleModal
        booking={reschedulingBooking}
        isOpen={Boolean(reschedulingBooking)}
        onClose={() => setReschedulingBooking(null)}
        onSuccess={(updated) => {
          setBookings((prev) =>
            prev.map((b) =>
              b.id === updated.id || b.confirmationId === updated.confirmationId
                ? {
                    ...b,
                    date: updated.date,
                    time: updated.time,
                    duration: updated.duration,
                    seatNumber: updated.seatNumber,
                  }
                : b,
            ),
          );
          setMessage({
            kind: "ok",
            text: `Booking ${updated.confirmationId} rescheduled to ${updated.date} at ${updated.time}.`,
          });
        }}
      />

      {splitBillBooking && (
        <SplitBillModal
          booking={splitBillBooking}
          isOpen={Boolean(splitBillBooking)}
          onClose={() => setSplitBillBooking(null)}
        />
      )}

      {walletBooking && (
        <MobileWalletPassModal
          booking={walletBooking}
          isOpen={Boolean(walletBooking)}
          onClose={() => setWalletBooking(null)}
        />
      )}
    </div>
  );
}

export default BookingList;
