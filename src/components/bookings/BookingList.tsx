"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Calendar,
  CalendarPlus,
  Download,
  Inbox,
  Loader2,
  MapPin,
} from "lucide-react";
import { getCalendarUrls, downloadICS } from "@/lib/calendar";
import { BookingHistoryList } from "@/app/dashboard/BookingHistoryList";
import { ExportBookingsCSVButton } from "@/components/bookings/ExportBookingsCSVButton";

export interface BookingSummary {
  id: string;
  confirmationId: string;
  date: string;
  time: string;
  status?: "CONFIRMED" | "PENDING" | "CANCELLED";
  seatNumber?: string | null;
  duration?: number | null;
  createdAt: string;
  venue: {
    name: string;
    category: string;
    address: string | null;
  } | null;
}

function isUpcoming(booking: BookingSummary): boolean {
  const start = new Date(`${booking.date}T${booking.time}`);
  return !isNaN(start.getTime()) && start.getTime() > Date.now();
}

const chipClass =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors";

/**
 * The signed-in user's bookings: upcoming first, with cancel, receipt,
 * calendar and bulk export actions.
 */
export function BookingList({
  initialBookings,
  onCountsChange,
}: {
  initialBookings?: BookingSummary[];
  onCountsChange?: (counts: { upcoming: number; total: number }) => void;
}) {
  const [bookings, setBookings] = useState<BookingSummary[]>(
    initialBookings ?? [],
  );
  const [loading, setLoading] = useState(!initialBookings?.length);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/history");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
      setSelectedIds(new Set());
    } catch {
      setError("We couldn't load your bookings. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialBookings?.length) void load();
  }, [initialBookings, load]);

  const { upcoming, rest } = useMemo(() => {
    const active = (b: BookingSummary) =>
      b.status !== "CANCELLED" && isUpcoming(b);
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
        `Cancel your booking at ${booking.venue?.name ?? "this venue"} on ${booking.date}?`,
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
      if (!res.ok)
        throw new Error(data.error || "Couldn't cancel this booking.");
      setBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id ? { ...b, status: "CANCELLED" } : b,
        ),
      );
      setMessage({ kind: "ok", text: "Booking cancelled." });
    } catch (err: any) {
      setMessage({ kind: "error", text: err.message });
    } finally {
      setCancellingId(null);
    }
  };

  const exportSelected = async (format: "pdf" | "csv") => {
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WorkSphere_Bookings.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMessage({ kind: "error", text: "Export failed. Please try again." });
    } finally {
      setIsExporting(false);
    }
  };

  const renderBooking = (booking: BookingSummary) => {
    const cancelled = booking.status === "CANCELLED";
    const future = !cancelled && isUpcoming(booking);
    const venueName = booking.venue?.name ?? "Workspace";
    const address = booking.venue?.address ?? "";

    return (
      <li
        key={booking.id}
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
            className="w-4 h-4 mt-1 cursor-pointer shrink-0"
            style={{ accentColor: "var(--primary-accent)" }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold truncate">{venueName}</h4>
              <span
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
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">
              {booking.date} · {booking.time}
              {booking.seatNumber ? ` · Seat ${booking.seatNumber}` : ""}
              <span className="ml-2 font-mono text-xs text-zinc-400">
                {booking.confirmationId}
              </span>
            </p>
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
          >
            <Download className="w-3.5 h-3.5" />
            Receipt
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
                  ).googleUrl
                }
                target="_blank"
                rel="noopener noreferrer"
                className={chipClass}
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                Google Calendar
              </a>
              <button
                type="button"
                onClick={() =>
                  downloadICS(
                    venueName,
                    address,
                    booking.date,
                    booking.time,
                    booking.duration || 60,
                    booking.confirmationId,
                  )
                }
                className={chipClass}
                aria-label={`Download iCalendar file for booking ${booking.confirmationId}`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Add to Calendar (.ics)
              </button>
              <button
                onClick={() => cancelBooking(booking)}
                disabled={cancellingId === booking.id}
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
      <div className="py-12 text-center space-y-3">
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={load} className="text-sm font-medium accent-text">
          Try again
        </button>
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center text-center gap-3">
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
    <div className="space-y-5">
      {message && (
        <p
          role="status"
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
            <span className="text-xs text-zinc-500 font-medium">
              {bookings.length} {bookings.length === 1 ? "booking" : "bookings"} recorded
            </span>
            <ExportBookingsCSVButton
              bookings={bookings}
              label="Export CSV"
              variant="outline"
            />
          </div>
          {upcoming.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                Upcoming
              </h3>
              <ul className="space-y-3">{upcoming.map(renderBooking)}</ul>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                Past &amp; cancelled
              </h3>
              <ul className="space-y-3">{rest.map(renderBooking)}</ul>
            </section>
          )}
        </>
      )}

      {selectedIds.size > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-3 shadow-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => exportSelected("csv")}
              disabled={isExporting}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              onClick={() => exportSelected("pdf")}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold accent-bg text-white disabled:opacity-50"
            >
              {isExporting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Export PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
