"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Loader2,
  Clock,
  Sparkles,
  TrendingUp,
  AlertCircle,
  Sliders,
} from "lucide-react";

export interface HeatmapSelection {
  date: string;
  time: string;
}

export interface SeatStatusUpdate {
  seatId?: string;
  id?: string;
  seatNumber: string;
  available: boolean;
}

/**
 * Formats a concise status update for screen reader users when a seat changes availability.
 * e.g., "Seat 4B is now available" or "Seat 12A was just reserved".
 */
export function formatSeatStatusAnnouncement(
  seatNumber: string,
  isAvailable: boolean,
): string {
  return isAvailable
    ? `Seat ${seatNumber} is now available`
    : `Seat ${seatNumber} was just reserved`;
}

interface HeatmapCell {
  date: string;
  hour: number;
  occupancy: number;
}

interface ForecastHeatmapResponse {
  success: boolean;
  data: HeatmapCell[];
  error?: string;
}

export interface HourlyForecastItem {
  hour: number;
  predictedOccupancy: number | null;
  confidence: number;
  capacity: number;
}

export interface SeatingForecastResponse {
  forecast: HourlyForecastItem[];
  recommendedHours: number[];
  capacity: number;
  error?: string;
}

interface SeatOccupancyHeatmapProps {
  venueId: string;
  onSelectSlot?: (selection: HeatmapSelection) => void;
  selectedDate?: string;
  selectedTime?: string;
  /** Real-time seat availability updates for live assistive screen-reader announcements */
  seats?: SeatStatusUpdate[];
  realtimeSeats?: SeatStatusUpdate[];
  /** Minimum delay between consecutive aria-live updates in ms (default: 300ms) */
  announcementThrottleMs?: number;
}

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MIN_SCRUB_HOUR = 9; // 9:00 AM
const MAX_SCRUB_HOUR = 22; // 10:00 PM

function getStartDate() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDateLabel(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
  }).format(date);
}

function getDayName(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  }).format(date);
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:00 ${period}`;
}

function getCellClass(occupancy: number) {
  if (occupancy > 75) {
    return "bg-red-500/80 hover:bg-red-500";
  }
  if (occupancy >= 40) {
    return "bg-yellow-400/80 hover:bg-yellow-400";
  }
  return "bg-green-500/80 hover:bg-green-500";
}

function getCellLabel(occupancy: number) {
  if (occupancy > 75) return "High occupancy";
  if (occupancy >= 40) return "Medium occupancy";
  return "Low occupancy";
}

function parseHourFromTime(timeString?: string): number {
  if (!timeString) return 14; // Default to 2:00 PM
  const match = timeString.match(/^(\d{1,2})/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 23) {
      return Math.max(MIN_SCRUB_HOUR, Math.min(MAX_SCRUB_HOUR, parsed));
    }
  }
  return 14;
}

export function SeatOccupancyHeatmap({
  venueId,
  onSelectSlot,
  selectedDate,
  selectedTime,
  seats,
  realtimeSeats,
  announcementThrottleMs = 300,
}: SeatOccupancyHeatmapProps) {
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [forecastData, setForecastData] = useState<SeatingForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>("");

  const previousSeatsMapRef = useRef<Map<string, boolean>>(new Map());
  const pendingAnnouncementsRef = useRef<string[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMountRef = useRef<boolean>(true);

  const effectiveSeats = seats || realtimeSeats;

  // Track real-time seat transitions and throttle screen-reader announcements
  useEffect(() => {
    if (!effectiveSeats || effectiveSeats.length === 0) return;

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      const initialMap = new Map<string, boolean>();
      for (const s of effectiveSeats) {
        const key = s.seatNumber || s.seatId || s.id || "";
        if (key) initialMap.set(key, s.available);
      }
      previousSeatsMapRef.current = initialMap;
      return;
    }

    const currentMap = previousSeatsMapRef.current;
    const newAnnouncements: string[] = [];

    for (const seat of effectiveSeats) {
      const key = seat.seatNumber || seat.seatId || seat.id || "";
      if (!key) continue;

      const previousAvailable = currentMap.get(key);
      if (previousAvailable !== undefined && previousAvailable !== seat.available) {
        const msg = formatSeatStatusAnnouncement(seat.seatNumber || key, seat.available);
        newAnnouncements.push(msg);
      }
      currentMap.set(key, seat.available);
    }

    if (newAnnouncements.length > 0) {
      pendingAnnouncementsRef.current.push(...newAnnouncements);

      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          if (pendingAnnouncementsRef.current.length > 0) {
            const textToAnnounce = pendingAnnouncementsRef.current.join(". ");
            pendingAnnouncementsRef.current = [];
            setAnnouncement(textToAnnounce);
          }
          throttleTimerRef.current = null;
        }, announcementThrottleMs);
      }
    }
  }, [effectiveSeats, announcementThrottleMs]);

  // Listen for global custom seat status events if dispatched from WebSocket / PartyKit
  useEffect(() => {
    const handleSeatEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ seatNumber: string; available: boolean }>).detail;
      if (detail && typeof detail.seatNumber === "string" && typeof detail.available === "boolean") {
        const msg = formatSeatStatusAnnouncement(detail.seatNumber, detail.available);
        setAnnouncement(msg);
      }
    };

    window.addEventListener("worksphere:seat-status-changed", handleSeatEvent);
    return () => {
      window.removeEventListener("worksphere:seat-status-changed", handleSeatEvent);
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  const initialHour = useMemo(() => parseHourFromTime(selectedTime), [selectedTime]);
  const [scrubHour, setScrubHour] = useState<number>(initialHour);

  // Sync state if selectedTime prop changes from parent
  useEffect(() => {
    if (selectedTime) {
      setScrubHour(parseHourFromTime(selectedTime));
    }
  }, [selectedTime]);

  const startDate = useMemo(() => getStartDate(), []);
  const activeDate = selectedDate || startDate;

  // Load heatmap and seating forecast in parallel
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const heatmapParams = new URLSearchParams({
          venueId,
          startDate,
        });

        const [heatmapRes, forecastRes] = await Promise.all([
          fetch(`/api/map/forecast-heatmap?${heatmapParams.toString()}`, {
            cache: "no-store",
          }),
          fetch(`/api/venues/${venueId}/seating-forecast`, {
            cache: "no-store",
          }),
        ]);

        if (!cancelled) {
          if (heatmapRes.ok) {
            const heatmapPayload = (await heatmapRes.json()) as ForecastHeatmapResponse;
            if (heatmapPayload.success && Array.isArray(heatmapPayload.data)) {
              setCells(heatmapPayload.data);
            }
          }

          if (forecastRes.ok) {
            const forecastPayload = (await forecastRes.json()) as SeatingForecastResponse;
            if (forecastPayload.forecast && Array.isArray(forecastPayload.forecast)) {
              setForecastData(forecastPayload);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load occupancy forecast",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [venueId, startDate]);

  const dates = useMemo(
    () => Array.from(new Set(cells.map((cell) => cell.date))),
    [cells],
  );

  const cellMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const cell of cells) {
      map.set(`${cell.date}-${cell.hour}`, cell.occupancy);
    }
    return map;
  }, [cells]);

  // Find forecast item for currently scrubbed hour
  const currentHourForecast = useMemo(() => {
    if (!forecastData?.forecast) return null;
    return forecastData.forecast.find((f) => f.hour === scrubHour) || null;
  }, [forecastData, scrubHour]);

  const capacity = forecastData?.capacity || 50;
  const predictedOccupancy = currentHourForecast?.predictedOccupancy ?? null;
  const occupancyPercentage =
    predictedOccupancy !== null
      ? Math.round((predictedOccupancy / capacity) * 100)
      : (cellMap.get(`${activeDate}-${scrubHour}`) ?? 45);

  const confidence = currentHourForecast?.confidence ?? 0.85;
  const confidenceMargin = Math.round((1 - confidence) * 20);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHour = parseInt(e.target.value, 10);
    setScrubHour(newHour);
    const formattedTime = `${newHour.toString().padStart(2, "0")}:00`;
    onSelectSlot?.({
      date: activeDate,
      time: formattedTime,
    });
  };

  const handleBarClick = (hour: number) => {
    setScrubHour(hour);
    const formattedTime = `${hour.toString().padStart(2, "0")}:00`;
    onSelectSlot?.({
      date: activeDate,
      time: formattedTime,
    });
  };

  if (loading) {
    return (
      <section
        data-testid="seat-occupancy-heatmap"
        className="rounded-2xl border border-white/10 bg-black/20 p-5"
      >
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        data-testid="seat-occupancy-heatmap"
        className="rounded-2xl border border-white/10 bg-black/20 p-5"
      >
        <p className="text-sm text-zinc-500">{error}</p>
      </section>
    );
  }

  return (
    <section
      data-testid="seat-occupancy-heatmap"
      className="rounded-2xl border border-white/10 bg-black/20 p-5 space-y-6"
    >
      {/* Visually hidden live region for screen-reader real-time seat availability updates */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="seat-availability-announcer"
        className="sr-only"
      >
        {announcement}
      </div>

      {/* Header & Legend */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-violet-300" />
            <h3 className="font-semibold text-white">
              Seat occupancy forecast
            </h3>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Scrub through the 24-hour timeline to view predicted seat congestion and quiet hours.
          </p>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-zinc-400 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            &lt;40% (Quiet)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-yellow-400" />
            40-75% (Moderate)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            &gt;75% (Busy)
          </span>
        </div>
      </div>

      {/* 24-Hour Timeline Scrubbing Graph (#3515) */}
      <div className="rounded-xl bg-zinc-900/70 border border-zinc-800 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-indigo-400" />
            <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Time scrubber: {formatHour(scrubHour)}
            </span>
          </div>

          {/* Dynamic Confidence Interval Display */}
          <div
            data-testid="occupancy-confidence-insight"
            className="flex items-center gap-2 px-3 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300"
          >
            <TrendingUp className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            <span>
              Usually <strong>{occupancyPercentage}% full</strong> on{" "}
              {getDayName(activeDate)}s at {formatHour(scrubHour)} (±{confidenceMargin}% confidence)
            </span>
          </div>
        </div>

        {/* 24-Hour Timeline Histogram Sparkline */}
        <div className="pt-2">
          <div className="flex items-end gap-1 h-20 w-full px-1">
            {HOURS.map((hour) => {
              const forecastHour = forecastData?.forecast?.find((f) => f.hour === hour);
              const occ =
                forecastHour?.predictedOccupancy !== null && forecastHour?.predictedOccupancy !== undefined
                  ? Math.round((forecastHour.predictedOccupancy / capacity) * 100)
                  : (cellMap.get(`${activeDate}-${hour}`) ?? 10);

              const isRecommended = forecastData?.recommendedHours?.includes(hour);
              const isSelected = hour === scrubHour;
              const inScrubRange = hour >= MIN_SCRUB_HOUR && hour <= MAX_SCRUB_HOUR;

              let barColor = "bg-green-500/70";
              if (occ > 75) barColor = "bg-red-500/80";
              else if (occ >= 40) barColor = "bg-yellow-400/80";

              return (
                <button
                  key={`bar-${hour}`}
                  type="button"
                  onClick={() => handleBarClick(hour)}
                  title={`${formatHour(hour)}: ~${occ}% occupancy`}
                  className={`flex-1 flex flex-col justify-end items-center h-full group relative transition-all ${
                    inScrubRange ? "opacity-100" : "opacity-40"
                  }`}
                >
                  {/* Recommended Star Indicator */}
                  {isRecommended && (
                    <span className="absolute -top-3 text-[9px] text-amber-400">★</span>
                  )}

                  {/* Occupancy bar height */}
                  <div
                    style={{ height: `${Math.max(12, occ)}%` }}
                    className={`w-full rounded-t-sm transition-all ${barColor} ${
                      isSelected
                        ? "ring-2 ring-white shadow-lg shadow-indigo-500/30 scale-105"
                        : "group-hover:brightness-125"
                    }`}
                  />
                  <span className="text-[9px] text-zinc-500 mt-1">
                    {hour % 3 === 0 ? `${hour}h` : ""}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Interactive Scrub Slider */}
          <div className="relative mt-2 px-1">
            <input
              type="range"
              min={MIN_SCRUB_HOUR}
              max={MAX_SCRUB_HOUR}
              step={1}
              value={scrubHour}
              onChange={handleSliderChange}
              data-testid="timeline-scrubber-slider"
              aria-label="Occupancy timeline slider"
              className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1 font-mono">
              <span>9:00 AM</span>
              <span>1:00 PM</span>
              <span>5:00 PM</span>
              <span>10:00 PM</span>
            </div>
          </div>
        </div>

        {/* Recommended quiet hours shortcuts */}
        {forecastData?.recommendedHours && forecastData.recommendedHours.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-zinc-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Quiet Hours:
            </span>
            {forecastData.recommendedHours.map((h) => (
              <button
                key={`rec-${h}`}
                type="button"
                onClick={() => handleBarClick(h)}
                className={`text-xs px-2.5 py-0.5 rounded-full border transition-all ${
                  scrubHour === h
                    ? "bg-indigo-600 text-white border-indigo-500 font-medium"
                    : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                }`}
              >
                {formatHour(h)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 7-Day Matrix Heatmap View */}
      {dates.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: `72px repeat(${dates.length}, minmax(0, 1fr))`,
              }}
            >
              <div />

              {dates.map((date) => (
                <div
                  key={date}
                  className={`pb-2 text-center text-[11px] font-medium transition-colors ${
                    date === activeDate ? "text-indigo-400 font-bold" : "text-zinc-400"
                  }`}
                >
                  {getDateLabel(date)}
                </div>
              ))}

              {HOURS.map((hour) => {
                const isCurrentScrub = hour === scrubHour;
                return (
                  <div key={`row-${hour}`} className="contents">
                    <div
                      className={`flex items-center justify-end pr-2 text-[10px] transition-colors ${
                        isCurrentScrub
                          ? "text-indigo-400 font-bold"
                          : "text-zinc-600"
                      }`}
                    >
                      {hour.toString().padStart(2, "0")}:00
                    </div>

                    {dates.map((date) => {
                      const occupancy = cellMap.get(`${date}-${hour}`) ?? 0;
                      const slotTime = `${hour.toString().padStart(2, "0")}:00`;
                      const isSelected =
                        (selectedDate || activeDate) === date &&
                        (selectedTime || `${scrubHour.toString().padStart(2, "0")}:00`) === slotTime;

                      return (
                        <button
                          key={`${date}-${hour}`}
                          type="button"
                          data-testid={`heatmap-cell-${date}-${hour}`}
                          aria-label={`${date} ${slotTime}, ${Math.round(
                            occupancy,
                          )}% occupancy, ${getCellLabel(occupancy)}`}
                          title={`${Math.round(occupancy)}% occupancy`}
                          onClick={() => {
                            setScrubHour(hour);
                            onSelectSlot?.({
                              date,
                              time: slotTime,
                            });
                          }}
                          className={`h-7 min-w-0 rounded-sm transition ${getCellClass(
                            occupancy,
                          )} ${
                            isSelected
                              ? "ring-2 ring-white ring-offset-1 ring-offset-zinc-950 scale-95"
                              : ""
                          }`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
