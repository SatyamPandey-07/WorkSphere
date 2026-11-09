"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { Users, TrendingUp, Sparkles, Loader2, Info } from "lucide-react";

export interface BookingRecord {
  date: string; // ISO date string or "YYYY-MM-DD"
  duration?: number | null; // booking duration in minutes, default 60
  status?: string | null; // e.g. "CONFIRMED", "CANCELLED", "COMPLETED"
  time?: string | null; // e.g. "14:00"
}

export interface DayOccupancyPoint {
  day: string; // Full day name (e.g. "Monday")
  shortDay: string; // Short day abbreviation (e.g. "Mon")
  dayIndex: number; // 0 for Monday through 6 for Sunday
  occupancyPercent: number; // 0 - 100 clamped average occupancy
  bookedHours: number; // Total aggregated hours booked on this day
  totalCapacityHours: number; // Total available seat hours
  bookingCount: number; // Total number of active bookings
}

export const DAYS_ORDER = [
  { full: "Monday", short: "Mon", dayIndex: 0 },
  { full: "Tuesday", short: "Tue", dayIndex: 1 },
  { full: "Wednesday", short: "Wed", dayIndex: 2 },
  { full: "Thursday", short: "Thu", dayIndex: 3 },
  { full: "Friday", short: "Fri", dayIndex: 4 },
  { full: "Saturday", short: "Sat", dayIndex: 5 },
  { full: "Sunday", short: "Sun", dayIndex: 6 },
];

/**
 * Maps JS Date.getDay() (0=Sunday..6=Saturday) to Monday-indexed order (0=Monday..6=Sunday).
 */
export function getMondayFirstIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/**
 * Aggregates historical bookings into monthly average seat occupancy percentage per day of the week (Mon–Sun).
 */
export function calculateDayOfWeekOccupancy(
  bookings: BookingRecord[] = [],
  venueCapacity: number = 50,
  operatingHoursPerDay: number = 10,
  weeksInMonth: number = 4,
): DayOccupancyPoint[] {
  const safeCapacity = Math.max(1, venueCapacity);
  const safeOperatingHours = Math.max(1, operatingHoursPerDay);
  const safeWeeks = Math.max(1, weeksInMonth);

  const capacitySeatHours = safeCapacity * safeOperatingHours * safeWeeks;

  const dayStats = DAYS_ORDER.map((d) => ({
    day: d.full,
    shortDay: d.short,
    dayIndex: d.dayIndex,
    bookedHours: 0,
    bookingCount: 0,
  }));

  const validBookings = bookings.filter(
    (b) => !b.status || b.status.toUpperCase() !== "CANCELLED",
  );

  validBookings.forEach((b) => {
    if (!b.date) return;
    const parsedDate = new Date(b.date);
    if (isNaN(parsedDate.getTime())) return;

    const jsDay = parsedDate.getDay();
    const mondayIndex = getMondayFirstIndex(jsDay);

    const durationMinutes =
      typeof b.duration === "number" && b.duration > 0 ? b.duration : 60;
    const hours = durationMinutes / 60;

    dayStats[mondayIndex].bookedHours += hours;
    dayStats[mondayIndex].bookingCount += 1;
  });

  return dayStats.map((stat) => {
    const rawPercentage = (stat.bookedHours / capacitySeatHours) * 100;
    const occupancyPercent = Math.min(
      100,
      Math.max(0, Math.round(rawPercentage)),
    );

    return {
      day: stat.day,
      shortDay: stat.shortDay,
      dayIndex: stat.dayIndex,
      occupancyPercent,
      bookedHours: Math.round(stat.bookedHours * 10) / 10,
      totalCapacityHours: capacitySeatHours,
      bookingCount: stat.bookingCount,
    };
  });
}

/**
 * Returns color code based on seat occupancy level:
 * - Low (<40%): Emerald green
 * - Moderate (40% - 75%): Amber yellow
 * - High (>75%): Rose / Red
 */
export function getOccupancyColor(percent: number): string {
  if (percent >= 75) return "#ef4444";
  if (percent >= 40) return "#f59e0b";
  return "#10b981";
}

export function getOccupancyLabel(percent: number): string {
  if (percent >= 75) return "High Occupancy";
  if (percent >= 40) return "Moderate";
  return "Optimal Space";
}

/**
 * Recalculates axis tick labels cleanly across viewport breakpoints:
 * - Mobile (<= 420px, e.g. 375px): Single-letter abbreviation ('M', 'T', 'W'...)
 * - Tablet (421px - 900px, e.g. 768px): Short day name ('Mon', 'Tue'...)
 * - Desktop (> 900px, e.g. 1280px): Full day name ('Monday', 'Tuesday'...)
 */
export function getResponsiveDayLabel(
  point: DayOccupancyPoint,
  viewportWidth: number,
): string {
  if (viewportWidth <= 420) {
    return point.shortDay.slice(0, 1);
  }
  if (viewportWidth <= 900) {
    return point.shortDay;
  }
  return point.day;
}

export interface OccupancyTrendChartProps {
  venueId?: string;
  venueCapacity?: number;
  bookings?: BookingRecord[];
  data?: DayOccupancyPoint[];
  title?: string;
  className?: string;
}

export function OccupancyTrendChart({
  venueId,
  venueCapacity = 50,
  bookings,
  data: precomputedData,
  title = "Monthly Average Seat Occupancy",
  className = "",
}: OccupancyTrendChartProps) {
  const [fetchedBookings, setFetchedBookings] = useState<
    BookingRecord[] | null
  >(null);
  const [loading, setLoading] = useState<boolean>(
    !bookings && !precomputedData && !!venueId,
  );
  const [activePoint, setActivePoint] = useState<DayOccupancyPoint | null>(
    null,
  );
  const [containerWidth, setContainerWidth] = useState<number>(800);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const measureWidth = (width: number) => {
      if (width > 0) setContainerWidth(width);
    };

    const initialRect = containerRef.current.getBoundingClientRect();
    if (initialRect.width > 0) {
      measureWidth(initialRect.width);
    }

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const contentWidth = entry.contentRect.width;
          if (contentWidth > 0) {
            measureWidth(contentWidth);
          }
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    } else {
      const handleResize = () => {
        if (containerRef.current) {
          measureWidth(containerRef.current.getBoundingClientRect().width);
        }
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  useEffect(() => {
    if (precomputedData || bookings || !venueId) return;

    let isMounted = true;
    setLoading(true);

    fetch(`/api/venues/${encodeURIComponent(venueId)}/telemetry`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!isMounted) return;
        if (json?.bookings && Array.isArray(json.bookings)) {
          setFetchedBookings(json.bookings);
        } else {
          setFetchedBookings([]);
        }
      })
      .catch(() => {
        if (isMounted) setFetchedBookings([]);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [venueId, bookings, precomputedData]);

  const chartData = useMemo(() => {
    if (precomputedData && precomputedData.length > 0) {
      return precomputedData;
    }
    const sourceBookings = bookings ?? fetchedBookings ?? [];
    return calculateDayOfWeekOccupancy(sourceBookings, venueCapacity);
  }, [precomputedData, bookings, fetchedBookings, venueCapacity]);

  const peakDay = useMemo(() => {
    if (chartData.length === 0) return null;
    return [...chartData].sort(
      (a, b) => b.occupancyPercent - a.occupancyPercent,
    )[0];
  }, [chartData]);

  const averageOccupancy = useMemo(() => {
    if (chartData.length === 0) return 0;
    const total = chartData.reduce(
      (acc, curr) => acc + curr.occupancyPercent,
      0,
    );
    return Math.round(total / chartData.length);
  }, [chartData]);

  const SVG_WIDTH = 800;
  const SVG_HEIGHT = 400;
  const PADDING = { top: 35, right: 35, bottom: 55, left: 60 };
  const PLOT_WIDTH = SVG_WIDTH - PADDING.left - PADDING.right;
  const PLOT_HEIGHT = SVG_HEIGHT - PADDING.top - PADDING.bottom;

  const yTicks = [0, 25, 50, 75, 100];
  const slotWidth = PLOT_WIDTH / 7;
  const barWidth = Math.min(54, slotWidth * 0.55);

  if (loading) {
    return (
      <div
        className={`w-full h-72 flex flex-col items-center justify-center bg-zinc-900/60 rounded-2xl border border-zinc-800 p-6 ${className}`}
        aria-busy="true"
        aria-live="polite"
      >
        <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
        <span className="text-xs text-zinc-400">
          Loading seat occupancy trends...
        </span>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Monthly average seat occupancy chart by day of week"
      className={`w-full bg-zinc-900/80 dark:bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-xl backdrop-blur-sm ${className}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h3 className="text-base font-bold text-white tracking-tight">
              {title}
            </h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Historical booking distribution across days of the week (Monday –
            Sunday)
          </p>
        </div>

        {/* Quick summary badges */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-zinc-300">
            <Users className="w-3.5 h-3.5 text-blue-400" />
            <span>
              Avg: <strong className="text-white">{averageOccupancy}%</strong>
            </span>
          </div>
          {peakDay && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-zinc-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>
                Peak: <strong className="text-white">{peakDay.shortDay}</strong>{" "}
                ({peakDay.occupancyPercent}%)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Fluid percentage-width container with responsive SVG */}
      <div
        ref={containerRef}
        data-testid="chart-container"
        className="w-full h-72 sm:h-80 relative focus:outline-none"
      >
        <svg
          data-testid="occupancy-trend-svg"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full select-none"
          role="img"
          aria-label="Seat occupancy trends chart"
        >
          {/* Background Grid Lines & Y-Axis Labels */}
          {yTicks.map((tick) => {
            const y = PADDING.top + PLOT_HEIGHT - (tick / 100) * PLOT_HEIGHT;
            return (
              <g key={`ytick-${tick}`}>
                <line
                  x1={PADDING.left}
                  y1={y}
                  x2={SVG_WIDTH - PADDING.right}
                  y2={y}
                  stroke="#27272a"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={PADDING.left - 12}
                  y={y + 4}
                  textAnchor="end"
                  fill="#71717a"
                  fontSize="12"
                  fontWeight="500"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {/* X Axis baseline */}
          <line
            x1={PADDING.left}
            y1={PADDING.top + PLOT_HEIGHT}
            x2={SVG_WIDTH - PADDING.right}
            y2={PADDING.top + PLOT_HEIGHT}
            stroke="#3f3f46"
            strokeWidth="1.5"
          />

          {/* Bar Groups & Responsive X-Axis Labels */}
          {chartData.map((point, index) => {
            const barHeight = (point.occupancyPercent / 100) * PLOT_HEIGHT;
            const x =
              PADDING.left + index * slotWidth + (slotWidth - barWidth) / 2;
            const y = PADDING.top + PLOT_HEIGHT - barHeight;
            const centerX = x + barWidth / 2;
            const color = getOccupancyColor(point.occupancyPercent);
            const responsiveLabel = getResponsiveDayLabel(
              point,
              containerWidth,
            );
            const isHovered = activePoint?.dayIndex === point.dayIndex;

            return (
              <g
                key={`bar-group-${point.day}`}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${point.day}: ${point.occupancyPercent}% occupancy`}
                className="cursor-pointer focus:outline-none"
                onMouseEnter={() => setActivePoint(point)}
                onMouseLeave={() => setActivePoint(null)}
                onFocus={() => setActivePoint(point)}
                onBlur={() => setActivePoint(null)}
              >
                {/* Transparent hit area for easy hover/tap */}
                <rect
                  x={PADDING.left + index * slotWidth}
                  y={PADDING.top}
                  width={slotWidth}
                  height={PLOT_HEIGHT + PADDING.bottom}
                  fill="transparent"
                />

                {/* Occupancy Bar */}
                <rect
                  data-testid={`occupancy-bar-${point.dayIndex}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(4, barHeight)}
                  rx="6"
                  ry="6"
                  fill={color}
                  opacity={isHovered ? 1 : 0.9}
                  className="transition-all duration-200"
                  style={{
                    filter: isHovered
                      ? `drop-shadow(0 0 8px ${color}80)`
                      : "none",
                  }}
                />

                {/* Percentage label above bar */}
                <text
                  x={centerX}
                  y={Math.max(PADDING.top - 8, y - 8)}
                  textAnchor="middle"
                  fill={isHovered ? "#ffffff" : "#a1a1aa"}
                  fontSize={containerWidth <= 420 ? "11" : "12"}
                  fontWeight="600"
                  className="transition-colors duration-150"
                >
                  {point.occupancyPercent}%
                </text>

                {/* Dynamic Axis Tick Label */}
                <text
                  data-testid={`x-axis-tick-${point.dayIndex}`}
                  x={centerX}
                  y={PADDING.top + PLOT_HEIGHT + 26}
                  textAnchor="middle"
                  fill={isHovered ? "#ffffff" : "#a1a1aa"}
                  fontSize={containerWidth <= 420 ? "12" : "13"}
                  fontWeight="600"
                  className="transition-colors duration-150"
                >
                  {responsiveLabel}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {activePoint && (
          <div
            data-testid="chart-tooltip"
            role="tooltip"
            className="absolute top-2 right-4 pointer-events-none bg-zinc-950/95 border border-zinc-800 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs space-y-1.5 min-w-[150px] z-10"
          >
            <div className="font-bold text-white text-sm">
              {activePoint.day}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-zinc-400">Occupancy:</span>
              <span
                className="font-bold px-1.5 py-0.5 rounded text-[11px]"
                style={{
                  color: getOccupancyColor(activePoint.occupancyPercent),
                  backgroundColor: `${getOccupancyColor(activePoint.occupancyPercent)}15`,
                  border: `1px solid ${getOccupancyColor(activePoint.occupancyPercent)}30`,
                }}
              >
                {activePoint.occupancyPercent}% (
                {getOccupancyLabel(activePoint.occupancyPercent)})
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-zinc-400">
              <span>Booked hours:</span>
              <span className="font-medium text-zinc-200">
                {activePoint.bookedHours} hrs
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-zinc-400">
              <span>Bookings:</span>
              <span className="font-medium text-zinc-200">
                {activePoint.bookingCount}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Accessible screen-reader & keyboard table */}
      <div className="mt-4 pt-4 border-t border-zinc-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>&lt;40% Low</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>40–75% Moderate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>&gt;75% High</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-zinc-500">
          <Info className="w-3.5 h-3.5" />
          <span>Capacity base: {venueCapacity} seats / 10h operating day</span>
        </div>
      </div>

      {/* Visually hidden screen-reader accessible data table */}
      <table className="sr-only">
        <caption>Monthly average seat occupancy per day of week</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Average Occupancy Percentage</th>
            <th scope="col">Total Booked Hours</th>
            <th scope="col">Bookings Count</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.occupancyPercent}%</td>
              <td>{d.bookedHours} hours</td>
              <td>{d.bookingCount} bookings</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
