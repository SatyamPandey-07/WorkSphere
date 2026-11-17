import { mean, standardDeviation } from "@/lib/statistics";
import { isValidTimeZone } from "@/lib/booking/dateTimeAdapter";
import type { RawNoiseData } from "@/lib/noiseForecast";

export const WEEKLY_NOISE_DAYS = 7;
export const HOURS_PER_DAY = 24;

export interface WeeklyNoiseForecastCell {
  dayOfWeek: number;
  dayName: string;
  hour: number;
  predictedDb: number | null;
  standardDeviation: number | null;
  focusSuitabilityScore: number | null;
  samples: number;
  interpolated: boolean;
}

export interface WeeklyNoiseForecast {
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  days: Array<{
    dayOfWeek: number;
    dayName: string;
    hours: WeeklyNoiseForecastCell[];
  }>;
  /** Sunday-first 7 x 24 matrix; each entry is the same cell exposed in days. */
  matrix: WeeklyNoiseForecastCell[][];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CellStats {
  values: number[];
  mean: number;
  deviation: number;
}

/** Focus score is a transparent linear scale: 30 dB maps to 100 and 85 dB to 0. */
export function calculateFocusSuitabilityScore(avgDecibels: number): number {
  if (!Number.isFinite(avgDecibels)) return 0;
  const score = ((85 - avgDecibels) / (85 - 30)) * 100;
  return Math.round(Math.max(0, Math.min(100, score)));
}

function getDayAndHour(
  timestamp: Date,
  formatter: Intl.DateTimeFormat,
): { dayOfWeek: number; hour: number } | null {
  const parts = formatter.formatToParts(timestamp);
  const dayName = parts.find((part) => part.type === "weekday")?.value;
  const hourValue = Number(parts.find((part) => part.type === "hour")?.value);
  const dayOfWeek = DAY_NAMES.findIndex(
    (day) => day.toLowerCase() === dayName?.slice(0, 3).toLowerCase(),
  );
  if (dayOfWeek < 0 || !Number.isInteger(hourValue) || hourValue < 0 || hourValue > 23) {
    return null;
  }
  return { dayOfWeek, hour: hourValue };
}

function summarize(values: number[]): CellStats | null {
  if (values.length === 0) return null;
  return {
    values,
    mean: mean(values),
    deviation: values.length > 1 ? standardDeviation(values) : 0,
  };
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function interpolateCell(
  dayOfWeek: number,
  hour: number,
  grid: number[][][],
  timezoneFallback: number[],
): WeeklyNoiseForecastCell {
  const sameDay = grid[dayOfWeek];
  let previous: { distance: number; stats: CellStats } | null = null;
  let next: { distance: number; stats: CellStats } | null = null;

  for (let distance = 1; distance < HOURS_PER_DAY; distance += 1) {
    if (!previous) {
      const candidate = summarize(sameDay[(hour - distance + HOURS_PER_DAY) % HOURS_PER_DAY]);
      if (candidate) previous = { distance, stats: candidate };
    }
    if (!next) {
      const candidate = summarize(sameDay[(hour + distance) % HOURS_PER_DAY]);
      if (candidate) next = { distance, stats: candidate };
    }
    if (previous && next) break;
  }

  let predicted: number | null = null;
  let deviation: number | null = null;

  if (previous && next) {
    const totalDistance = previous.distance + next.distance;
    const ratio = previous.distance / totalDistance;
    predicted = previous.stats.mean + (next.stats.mean - previous.stats.mean) * ratio;
    deviation =
      previous.stats.deviation +
      (next.stats.deviation - previous.stats.deviation) * ratio;
  } else if (previous || next) {
    const chosen = (previous ?? next)!.stats;
    predicted = chosen.mean;
    deviation = chosen.deviation;
  } else {
    // If this weekday has no data, borrow the same hour from other weekdays.
    const crossDayValues = grid
      .filter((_, index) => index !== dayOfWeek)
      .flatMap((day) => day[hour]);
    const crossDay = summarize(crossDayValues);
    if (crossDay) {
      predicted = crossDay.mean;
      deviation = crossDay.deviation;
    } else if (timezoneFallback.length > 0) {
      const all = summarize(timezoneFallback);
      predicted = all?.mean ?? null;
      deviation = all?.deviation ?? null;
    }
  }

  return {
    dayOfWeek,
    dayName: DAY_NAMES[dayOfWeek],
    hour,
    predictedDb: predicted === null ? null : roundOne(predicted),
    standardDeviation: deviation === null ? null : roundOne(deviation),
    focusSuitabilityScore:
      predicted === null ? null : calculateFocusSuitabilityScore(predicted),
    samples: 0,
    interpolated: predicted !== null,
  };
}

/**
 * Creates a Sunday-first 7 x 24 forecast from readings already constrained to
 * the requested seven-day window. Missing hours are interpolated from the
 * nearest populated hours on that weekday, then the same hour on other days.
 */
export function generateWeeklyNoiseForecast(
  data: RawNoiseData[],
  options: {
    timeZone?: string;
    windowStart?: Date;
    windowEnd?: Date;
  } = {},
): WeeklyNoiseForecast {
  const requestedZone = options.timeZone;
  const timeZone =
    requestedZone && isValidTimeZone(requestedZone) ? requestedZone : "UTC";
  const windowEnd = options.windowEnd ?? new Date();
  const windowStart =
    options.windowStart ?? new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  });

  const grid: number[][][] = Array.from({ length: WEEKLY_NOISE_DAYS }, () =>
    Array.from({ length: HOURS_PER_DAY }, () => [] as number[]),
  );
  const allValues: number[] = [];

  for (const entry of Array.isArray(data) ? data : []) {
    if (
      !entry ||
      typeof entry.avgDecibels !== "number" ||
      !Number.isFinite(entry.avgDecibels) ||
      entry.avgDecibels < 0
    ) {
      continue;
    }
    const timestamp =
      entry.timestamp instanceof Date
        ? entry.timestamp
        : new Date(entry.timestamp);
    if (!Number.isFinite(timestamp.getTime())) continue;
    if (timestamp < windowStart || timestamp > windowEnd) continue;

    const position = getDayAndHour(timestamp, formatter);
    if (!position) continue;
    grid[position.dayOfWeek][position.hour].push(entry.avgDecibels);
    allValues.push(entry.avgDecibels);
  }

  const matrix: WeeklyNoiseForecastCell[][] = [];
  for (let day = 0; day < WEEKLY_NOISE_DAYS; day += 1) {
    const row: WeeklyNoiseForecastCell[] = [];
    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
      const stats = summarize(grid[day][hour]);
      if (!stats) {
        row.push(interpolateCell(day, hour, grid, allValues));
        continue;
      }
      row.push({
        dayOfWeek: day,
        dayName: DAY_NAMES[day],
        hour,
        predictedDb: roundOne(stats.mean),
        standardDeviation: roundOne(stats.deviation),
        focusSuitabilityScore: calculateFocusSuitabilityScore(stats.mean),
        samples: stats.values.length,
        interpolated: false,
      });
    }
    matrix.push(row);
  }

  return {
    timeZone,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    days: matrix.map((hours, dayOfWeek) => ({
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek],
      hours,
    })),
    matrix,
  };
}
