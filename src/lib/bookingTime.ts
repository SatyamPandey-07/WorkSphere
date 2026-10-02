/**
 * Booking dates/times are stored as wall-clock strings ("YYYY-MM-DD", "HH:mm")
 * plus the IANA timezone they were chosen in. These helpers turn them into
 * real instants without depending on the server's locale or timezone.
 */

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Normalises "9:05", "09:05" or "9:05 AM" to 24-hour "HH:mm"; null if invalid. */
export function normalizeBookingTime(time: string): string | null {
  const value = time?.trim() ?? "";
  let hours: number;
  let minutes: number;

  const twelveHour = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const twentyFourHour = value.match(/^(\d{1,2}):(\d{2})$/);
  if (twelveHour) {
    hours = parseInt(twelveHour[1], 10);
    minutes = parseInt(twelveHour[2], 10);
    if (hours < 1 || hours > 12) return null;
    const isPm = twelveHour[3].toUpperCase() === "PM";
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
  } else if (twentyFourHour) {
    hours = parseInt(twentyFourHour[1], 10);
    minutes = parseInt(twentyFourHour[2], 10);
    if (hours > 23) return null;
  } else {
    return null;
  }
  if (minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Returns true for a real calendar date in "YYYY-MM-DD" form. */
export function isValidBookingDate(date: string): boolean {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

/**
 * Parses a booking's date and time as wall-clock time in `timeZone` and
 * returns the corresponding instant, or null when either part is invalid.
 */
export function parseBookingDateTime(
  dateStr: string,
  timeStr: string,
  timeZone: string = "UTC",
): Date | null {
  if (!isValidBookingDate(dateStr)) return null;
  const time = normalizeBookingTime(timeStr);
  if (!time) return null;

  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";

  // Two passes handle DST transitions where the offset differs across the boundary.
  let instant =
    wallClockAsUtc - timeZoneOffsetMs(new Date(wallClockAsUtc), zone);
  instant = wallClockAsUtc - timeZoneOffsetMs(new Date(instant), zone);
  const result = new Date(instant);
  return isNaN(result.getTime()) ? null : result;
}

/** Start instant of a stored booking, preferring its own timezone. */
export function bookingStartsAt(
  booking: { date: string; time: string; timeZone?: string | null },
  fallbackTimeZone?: string | null,
): Date | null {
  return parseBookingDateTime(
    booking.date,
    booking.time,
    booking.timeZone || fallbackTimeZone || "UTC",
  );
}

/** Today's date ("YYYY-MM-DD") as seen in `timeZone`. */
export function todayInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
