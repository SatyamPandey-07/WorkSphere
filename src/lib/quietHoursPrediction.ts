/**
 * Quiet Hours Prediction Engine
 *
 * Analyzes historical noise level ratings grouped by hour-of-day to identify
 * "quiet windows" — contiguous time blocks where average dB < QUIET_THRESHOLD.
 * These windows are surfaced in the AI chat via the ReasoningAgent context.
 */

import { prisma } from "@/lib/prisma";

export const QUIET_THRESHOLD_DB = 55; // dB below which a slot is considered "quiet"
export const PEAK_THRESHOLD_DB  = 70; // dB above which a slot is "loud"

export interface HourlyNoiseProfile {
  hour: number;         // 0–23
  averageDb: number | null;
  label: string;        // "Quiet" | "Moderate" | "Loud"
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

/**
 * Aggregates VenueRating rows for the given venue by hour-of-day (UTC).
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
    return buckets.map((b, hour) => ({
      hour,
      averageDb: null,
      label: "Moderate",
      samples: 0,
    }));
  }

  // Fetch all ratings with decibel data for this venue
  const ratings = await prisma.venueRating.findMany({
    where: { venueId: venueId.trim() },
    select: {
      avgDecibels: true,
      createdAt: true,
    },
  });

  for (const r of ratings || []) {
    if (
      !r ||
      r.avgDecibels == null ||
      typeof r.avgDecibels !== "number" ||
      !Number.isFinite(r.avgDecibels) ||
      r.avgDecibels < 0
    ) {
      continue;
    }

    let hour = -1;
    if (r.createdAt instanceof Date) {
      hour = Number.isNaN(r.createdAt.getTime()) ? -1 : r.createdAt.getUTCHours();
    } else if (typeof r.createdAt === "string" || typeof r.createdAt === "number") {
      const parsed = new Date(r.createdAt);
      hour = Number.isNaN(parsed.getTime()) ? -1 : parsed.getUTCHours();
    }

    if (hour < 0 || hour > 23 || !Number.isFinite(hour)) {
      continue;
    }

    buckets[hour].sum += r.avgDecibels;
    buckets[hour].count++;
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
  const quietWindows: Array<{ startHour: number; endHour: number; avgDb: number }> = [];
  let windowStart: number | null = null;

  for (let i = 0; i < 24; i++) {
    const isQuiet = quietHours.includes(i);
    if (isQuiet && windowStart === null) {
      windowStart = i;
    } else if (!isQuiet && windowStart !== null) {
      const windowHours = hourlyProfile.slice(windowStart, i);
      const validDbs = windowHours
        .map((h) => h.averageDb)
        .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
      const avgDb =
        validDbs.length > 0
          ? Math.round((validDbs.reduce((a, b) => a + b, 0) / validDbs.length) * 10) / 10
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
        ? Math.round((validDbs.reduce((a, b) => a + b, 0) / validDbs.length) * 10) / 10
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

  const windowDescs = quietWindows.slice(0, 3).map(
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

  return { venueId: safeVenueId, quietWindows, peakHours, summary, hourlyProfile };
}
