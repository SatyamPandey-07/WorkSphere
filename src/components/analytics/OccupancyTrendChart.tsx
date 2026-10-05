"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Calendar, Users, TrendingUp, Sparkles, Loader2, Info } from "lucide-react";

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
 *
 * @param bookings Array of historical bookings with date and duration
 * @param venueCapacity Total capacity of the venue (default 50)
 * @param operatingHoursPerDay Number of hours the venue operates per day (default 10)
 * @param weeksInMonth Window divisor for monthly averaging (default 4)
 * @returns Array of 7 DayOccupancyPoint objects (Mon-Sun)
 */
export function calculateDayOfWeekOccupancy(
  bookings: BookingRecord[] = [],
  venueCapacity: number = 50,
  operatingHoursPerDay: number = 10,
  weeksInMonth: number = 4
): DayOccupancyPoint[] {
  const safeCapacity = Math.max(1, venueCapacity);
  const safeOperatingHours = Math.max(1, operatingHoursPerDay);
  const safeWeeks = Math.max(1, weeksInMonth);

  // Available seat-hours per day of the week over a typical monthly window (e.g. 4 Mondays in a month)
  const capacitySeatHours = safeCapacity * safeOperatingHours * safeWeeks;

  // Initialize 7 days
  const dayStats = DAYS_ORDER.map((d) => ({
    day: d.full,
    shortDay: d.short,
    dayIndex: d.dayIndex,
    bookedHours: 0,
    bookingCount: 0,
  }));

  // Filter out cancelled bookings
  const validBookings = bookings.filter(
    (b) => !b.status || b.status.toUpperCase() !== "CANCELLED"
  );

  validBookings.forEach((b) => {
    if (!b.date) return;
    const parsedDate = new Date(b.date);
    if (isNaN(parsedDate.getTime())) return;

    const jsDay = parsedDate.getDay();
    const mondayIndex = getMondayFirstIndex(jsDay);

    // Duration is in minutes (default 60 minutes = 1 hour)
    const durationMinutes =
      typeof b.duration === "number" && b.duration > 0 ? b.duration : 60;
    const hours = durationMinutes / 60;

    dayStats[mondayIndex].bookedHours += hours;
    dayStats[mondayIndex].bookingCount += 1;
  });

  return dayStats.map((stat) => {
    const rawPercentage = (stat.bookedHours / capacitySeatHours) * 100;
    const occupancyPercent = Math.min(100, Math.max(0, Math.round(rawPercentage)));

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
  if (percent >= 75) return "#ef4444"; // High occupancy
  if (percent >= 40) return "#f59e0b"; // Moderate occupancy
  return "#10b981"; // Low occupancy
}

export function getOccupancyLabel(percent: number): string {
  if (percent >= 75) return "High Occupancy";
  if (percent >= 40) return "Moderate";
  return "Optimal Space";
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
  const [fetchedBookings, setFetchedBookings] = useState<BookingRecord[] | null>(null);
  const [loading, setLoading] = useState<boolean>(!bookings && !precomputedData && !!venueId);

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
          // If no direct booking array, generate representative baseline for venue dashboard
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
    return [...chartData].sort((a, b) => b.occupancyPercent - a.occupancyPercent)[0];
  }, [chartData]);

  const averageOccupancy = useMemo(() => {
    if (chartData.length === 0) return 0;
    const total = chartData.reduce((acc, curr) => acc + curr.occupancyPercent, 0);
    return Math.round(total / chartData.length);
  }, [chartData]);

  if (loading) {
    return (
      <div
        className={`w-full h-72 flex flex-col items-center justify-center bg-zinc-900/60 rounded-2xl border border-zinc-800 p-6 ${className}`}
        aria-busy="true"
        aria-live="polite"
      >
        <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
        <span className="text-xs text-zinc-400">Loading seat occupancy trends...</span>
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
            <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Historical booking distribution across days of the week (Monday – Sunday)
          </p>
        </div>

        {/* Quick summary badges */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-zinc-300">
            <Users className="w-3.5 h-3.5 text-blue-400" />
            <span>Avg: <strong className="text-white">{averageOccupancy}%</strong></span>
          </div>
          {peakDay && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-zinc-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Peak: <strong className="text-white">{peakDay.shortDay}</strong> ({peakDay.occupancyPercent}%)</span>
            </div>
          )}
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-64 focus:outline-none">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#27272a"
            />
            <XAxis
              dataKey="shortDay"
              stroke="#71717a"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: "#3f3f46" }}
            />
            <YAxis
              domain={[0, 100]}
              unit="%"
              stroke="#71717a"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: "#3f3f46" }}
              ticks={[0, 25, 50, 75, 100]}
            />
            <Tooltip
              cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const dataPoint = payload[0].payload as DayOccupancyPoint;
                  const color = getOccupancyColor(dataPoint.occupancyPercent);
                  const label = getOccupancyLabel(dataPoint.occupancyPercent);

                  return (
                    <div className="bg-zinc-950/95 border border-zinc-800 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs space-y-1.5 min-w-[140px]">
                      <div className="font-bold text-white text-sm">
                        {dataPoint.day}
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-400">Occupancy:</span>
                        <span
                          className="font-bold px-1.5 py-0.5 rounded text-[11px]"
                          style={{
                            color,
                            backgroundColor: `${color}15`,
                            border: `1px solid ${color}30`,
                          }}
                        >
                          {dataPoint.occupancyPercent}% ({label})
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-zinc-400">
                        <span>Booked hours:</span>
                        <span className="font-medium text-zinc-200">
                          {dataPoint.bookedHours} hrs
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-zinc-400">
                        <span>Bookings:</span>
                        <span className="font-medium text-zinc-200">
                          {dataPoint.bookingCount}
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar
              dataKey="occupancyPercent"
              radius={[6, 6, 0, 0]}
              animationDuration={600}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getOccupancyColor(entry.occupancyPercent)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
