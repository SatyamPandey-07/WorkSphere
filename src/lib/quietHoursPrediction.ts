/**
 * Quiet Hours Prediction Engine
 *
 * Analyzes historical noise level ratings grouped by hour-of-day to identify
 * "quiet windows" — contiguous time blocks where average dB < QUIET_THRESHOLD.
 * These windows are surfaced in the AI chat via the ReasoningAgent context.
 */

import { prisma } from "@/lib/prisma";

export const QUIET_THRESHOLD_DB = 55; // dB below which a slot is considered "quiet"
export const PEAK_THRESHOLD_DB = 70; // dB above which a slot is "loud"

export interface HourlyNoiseProfile {
  hour: number; // 0–23
  averageDb: number | null;
  label: string; // "Quiet" | "Moderate" | "Loud"
  samples: number;
}

export interface QuietWindowPrediction {
  venueId: string;
  quietWindows: Array<{ startHour: number; endHour: number; avgDb: number }>;
  peakHours: number[];
  summary: string;
  hourlyProfile: HourlyNoiseProfile[];
}

export function classifyNoiseLevelDb(
  db: number | null | undefined,
): "Quiet" | "Moderate" | "Loud" {
  if (db === null || db === undefined || !Number.isFinite(db) || db < 0) {
    return "Moderate";
  }
  if (db < QUIET_THRESHOLD_DB) return "Quiet";
  if (db < PEAK_THRESHOLD_DB) return "Moderate";
  return "Loud";
}

interface AggregatedHourRow {
  hour: number | bigint;
  averageDb: number | string | null;
  samples: number | bigint;
}

/**
 * Aggregates VenueRating rows for the given venue by hour-of-day (UTC)
 * directly in PostgreSQL so only up to 24 bucket rows are transferred.
 * Returns a 24-element array indexed by hour.
 */
export async function getHourlyNoiseProfile(
  venueId: string,
): Promise<HourlyNoiseProfile[]> {
  const buckets: { sum: number; count: number }[] = Array.from(
    { length: 24 },
    () => ({ sum: 0, count: 0 }),
  );

  if (!venueId || typeof venueId !== "string" || venueId.trim().length === 0) {
    return buckets.map((_, hour) => ({
      hour,
      averageDb: null,
      label: "Moderate",
      samples: 0,
    }));
  }

  const trimmedVenueId = venueId.trim();

  // Prisma stores DateTime columns as UTC TIMESTAMP(3) without timezone, so
  // EXTRACT(HOUR FROM "createdAt") groups samples strictly by UTC hour 0-23
  // regardless of the database session timezone.
  const rows = await prisma.$queryRaw<AggregatedHourRow[]>`
    SELECT
      EXTRACT(HOUR FROM "createdAt")::int AS hour,
      AVG("avgDecibels")::double precision AS "averageDb",
      COUNT(*)::int AS samples
    FROM "VenueRating"
    WHERE "venueId" = ${trimmedVenueId}
      AND "avgDecibels" IS NOT NULL
      AND "avgDecibels" >= 0
      AND "avgDecibels" < 'Infinity'::double precision
      AND "avgDecibels" <> 'NaN'::double precision
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  for (const row of rows || []) {
    if (!row) continue;

    const hour = Number(row.hour);
    const samples = Number(row.samples);
    const averageDb = row.averageDb === null ? NaN : Number(row.averageDb);

    if (
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isInteger(samples) ||
      samples <= 0 ||
      !Number.isFinite(averageDb) ||
      averageDb < 0
    ) {
      continue;
    }

    buckets[hour].sum += averageDb * samples;
    buckets[hour].count += samples;
  }

  return buckets.map((b, hour) => {
    const averageDb =
      b.count > 0 && Number.isFinite(b.sum)
        ? Math.round((b.sum / b.count) * 10) / 10
        : null;
    return {
      hour,
      averageDb,
      label: classifyNoiseLevelDb(averageDb),
      samples: b.count,
    };
  });
}

/**
 * Identifies contiguous "quiet window" blocks in the hourly profile and returns
 * a structured prediction including a human-readable summary string.
 */
export async function predictQuietHours(
  venueId: string,
): Promise<QuietWindowPrediction> {
  const safeVenueId = typeof venueId === "string" ? venueId.trim() : "";
  const hourlyProfile = await getHourlyNoiseProfile(safeVenueId);

  // Identify quiet hours (averageDb is finite and averageDb < QUIET_THRESHOLD)
  const quietHours = hourlyProfile
    .filter(
      (h) =>
        typeof h.averageDb === "number" &&
        Number.isFinite(h.averageDb) &&
        h.averageDb < QUIET_THRESHOLD_DB,
    )
    .map((h) => h.hour);

  // Merge contiguous quiet hours into windows
  const quietWindows: Array<{
    startHour: number;
    endHour: number;
    avgDb: number;
  }> = [];
  let windowStart: number | null = null;

  for (let i = 0; i < 24; i++) {
    const isQuiet = quietHours.includes(i);
    if (isQuiet && windowStart === null) {
      windowStart = i;
    } else if (!isQuiet && windowStart !== null) {
      const windowHours = hourlyProfile.slice(windowStart, i);
      const validDbs = windowHours
        .map((h) => h.averageDb)
        .filter(
          (d): d is number => typeof d === "number" && Number.isFinite(d),
        );
      const avgDb =
        validDbs.length > 0
          ? Math.round(
              (validDbs.reduce((a, b) => a + b, 0) / validDbs.length) * 10,
            ) / 10
          : 0;
      quietWindows.push({ startHour: windowStart, endHour: i - 1, avgDb });
      windowStart = null;
    }
  }
  if (windowStart !== null) {
    const windowHours = hourlyProfile.slice(windowStart);
    const validDbs = windowHours
      .map((h) => h.averageDb)
      .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
    const avgDb =
      validDbs.length > 0
        ? Math.round(
            (validDbs.reduce((a, b) => a + b, 0) / validDbs.length) * 10,
          ) / 10
        : 0;
    quietWindows.push({ startHour: windowStart, endHour: 23, avgDb });
  }

  const peakHours = hourlyProfile
    .filter(
      (h) =>
        typeof h.averageDb === "number" &&
        Number.isFinite(h.averageDb) &&
        h.averageDb >= PEAK_THRESHOLD_DB,
    )
    .map((h) => h.hour);

  // Build human-readable summary
  const format = (h: number) =>
    h === 24 ? "24:00" : `${(h % 24).toString().padStart(2, "0")}:00`;

  const windowDescs = quietWindows
    .slice(0, 3)
    .map(
      (w) => `${format(w.startHour)}–${format(w.endHour + 1)} (~${w.avgDb} dB)`,
    );

  const summary =
    quietWindows.length > 0
      ? `Quietest times: ${windowDescs.join(", ")}.${
          peakHours.length > 0
            ? ` Peak noise around ${peakHours.map((h) => format(h)).join(", ")}.`
            : ""
        }`
      : "Insufficient noise data to predict quiet windows.";

  return {
    venueId: safeVenueId,
    quietWindows,
    peakHours,
    summary,
    hourlyProfile,
  };
}
