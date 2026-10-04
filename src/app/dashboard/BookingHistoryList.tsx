"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Search, Filter, Calendar, MapPin, Download, CalendarPlus, Ban } from "lucide-react";
import { BookingSummary } from "@/components/bookings/BookingList";
import { getCalendarUrls } from "@/lib/calendar";

export interface BookingHistoryListProps {
  bookings: BookingSummary[];
  onCancelBooking?: (booking: BookingSummary) => Promise<void>;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
  cancellingId?: string | null;
  itemHeight?: number; // Estimated height for virtualized items
}

const chipClass =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors";

function isUpcoming(booking: BookingSummary): boolean {
  const start = new Date(`${booking.date}T${booking.time}`);
  return !isNaN(start.getTime()) && start.getTime() > Date.now();
}

export function BookingHistoryList({
  bookings,
  onCancelBooking,
  selectedIds = new Set(),
  onToggleSelected,
  cancellingId = null,
  itemHeight = 130,
}: BookingHistoryListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "UPCOMING" | "COMPLETED" | "CANCELLED">("ALL");

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Dynamic measured item heights map
  const itemHeightsRef = useRef<Map<string, number>>(new Map());
  const [, setHeightMeasureTick] = useState(0);

  // Filtered list
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      const cancelled = b.status === "CANCELLED";
      const future = !cancelled && isUpcoming(b);
      const currentStatus = cancelled ? "CANCELLED" : future ? "UPCOMING" : "COMPLETED";

      if (statusFilter !== "ALL" && currentStatus !== statusFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const venueName = (b.venue?.name || "").toLowerCase();
        const address = (b.venue?.address || "").toLowerCase();
        const confirmation = (b.confirmationId || "").toLowerCase();
        if (
          !venueName.includes(q) &&
          !address.includes(q) &&
          !confirmation.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [bookings, searchQuery, statusFilter]);

  // Window virtualization logic with 3-item overscan buffer
  const OVERSCAN = 3;
  const totalCount = filteredBookings.length;

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight || 600);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setContainerHeight(entry.contentRect.height);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute positions
  const { totalHeight, itemsToRender, offsetY } = useMemo(() => {
    let runningHeight = 0;
    const positions: { id: string; top: number; height: number; index: number }[] = [];

    for (let i = 0; i < totalCount; i++) {
      const booking = filteredBookings[i];
      const h = itemHeightsRef.current.get(booking.id) || itemHeight;
      positions.push({
        id: booking.id,
        top: runningHeight,
        height: h,
        index: i,
      });
      runningHeight += h + 12; // 12px gap
    }

    const viewportStart = scrollTop;
    const viewportEnd = scrollTop + containerHeight;

    let startIndex = 0;
    let endIndex = totalCount - 1;

    for (let i = 0; i < positions.length; i++) {
      if (positions[i].top + positions[i].height >= viewportStart) {
        startIndex = Math.max(0, i - OVERSCAN);
        break;
      }
    }

    for (let i = startIndex; i < positions.length; i++) {
      if (positions[i].top > viewportEnd) {
        endIndex = Math.min(totalCount - 1, i + OVERSCAN);
        break;
      }
    }

    const visibleItems = positions.slice(startIndex, endIndex + 1).map((p) => ({
      booking: filteredBookings[p.index],
      top: p.top,
      index: p.index,
    }));

    const firstTop = visibleItems[0]?.top || 0;

    return {
      totalHeight: runningHeight,
      itemsToRender: visibleItems,
      offsetY: firstTop,
    };
  }, [totalCount, filteredBookings, scrollTop, containerHeight, itemHeight]);

  const measureRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      const measured = el.getBoundingClientRect().height;
      const prev = itemHeightsRef.current.get(id);
      if (prev !== measured && Math.abs((prev || 0) - measured) > 2) {
        itemHeightsRef.current.set(id, measured);
        setHeightMeasureTick((t) => t + 1);
      }
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Search and Filters toolbar - scroll position preserved */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search venue name, confirmation code, or address..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(["ALL", "UPCOMING", "COMPLETED", "CANCELLED"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                statusFilter === tab
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {tab.charAt(0) + tab.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {filteredBookings.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-500">
          No bookings match the selected filter.
        </div>
      ) : (
        /* Virtualized Scrollable Viewport */
        <div
          ref={containerRef}
          onScroll={handleScroll}
          data-testid="virtualized-booking-viewport"
          className="relative overflow-y-auto max-h-[650px] rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80 p-2"
          style={{ willChange: "transform" }}
        >
          <div
            style={{
              height: `${totalHeight}px`,
              position: "relative",
              width: "100%",
            }}
          >
            <div
              style={{
                transform: `translateY(${offsetY}px)`,
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
              }}
              className="space-y-3"
            >
              {itemsToRender.map(({ booking }) => {
                const cancelled = booking.status === "CANCELLED";
                const future = !cancelled && isUpcoming(booking);
                const venueName = booking.venue?.name ?? "Workspace";
                const address = booking.venue?.address ?? "";

                return (
                  <div
                    key={booking.id}
                    ref={(el) => measureRef(booking.id, el)}
                    data-testid="virtual-booking-card"
                    className={`rounded-2xl border p-4 transition-colors bg-white dark:bg-zinc-900 ${
                      selectedIds.has(booking.id)
                        ? "accent-border"
                        : "border-zinc-200 dark:border-zinc-800"
                    } ${cancelled ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      {onToggleSelected && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(booking.id)}
                          onChange={() => onToggleSelected(booking.id)}
                          aria-label={`Select booking ${booking.confirmationId}`}
                          className="w-4 h-4 mt-1 cursor-pointer shrink-0"
                          style={{ accentColor: "var(--primary-accent)" }}
                        />
                      )}
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
                          {onCancelBooking && (
                            <button
                              type="button"
                              onClick={() => onCancelBooking(booking)}
                              disabled={cancellingId === booking.id}
                              className={`${chipClass} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}
                            >
                              <Ban className="w-3.5 h-3.5" />
                              {cancellingId === booking.id ? "Cancelling…" : "Cancel"}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
