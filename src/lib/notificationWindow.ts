/**
 * Checks whether the current time falls within a user's notification window.
 *
 * @param now The current date/time instant
 * @param start Start time in HH:mm or 12h AM/PM format (e.g. "09:00", "9:00 AM", "09:00:00")
 * @param end End time in HH:mm or 12h AM/PM format (e.g. "17:00", "5:00 PM", "17:00:00", "24:00")
 * @param timezone The user's timezone (e.g. "America/New_York", "UTC")
 * @returns boolean True if notifications are allowed to be sent, false otherwise.
 */
export function isWithinNotificationWindow(
  now: Date,
  start: string | null | undefined,
  end: string | null | undefined,
  timezone: string | null | undefined,
): boolean {
  // If not configured, default to sending notifications
  if (!start || !end) {
    return true;
  }

  if (typeof start !== "string" || typeof end !== "string") {
    return true;
  }

  const trimmedStart = start.trim();
  const trimmedEnd = end.trim();
  if (!trimmedStart || !trimmedEnd) {
    return true;
  }

  const parseTimeToMinutes = (timeStr: string): number | null => {
    // 1. Check for 12-hour format with optional seconds: e.g. "09:00 AM", "9:00:00 PM", "9:30am"
    const match12 = timeStr.match(
      /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\s*$/i,
    );
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = parseInt(match12[2], 10);
      if (h < 1 || h > 12 || m < 0 || m > 59) return null;

      const ampm = match12[4].toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return h * 60 + m;
    }

    // 2. Check for 24-hour format with optional seconds: e.g. "09:00", "9:00:00", "24:00"
    const match24 = timeStr.match(/^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
    if (match24) {
      const h = parseInt(match24[1], 10);
      const m = parseInt(match24[2], 10);

      // Support 24:00 midnight end representation
      if (h === 24 && m === 0) {
        return 1440;
      }

      if (h < 0 || h > 23 || m < 0 || m > 59) return null;
      return h * 60 + m;
    }

    return null;
  };

  const startMinutes = parseTimeToMinutes(trimmedStart);
  const endMinutes = parseTimeToMinutes(trimmedEnd);

  // If time format cannot be parsed, safely default to sending notifications
  if (startMinutes === null || endMinutes === null) {
    return true;
  }

  // Continuous 24-hour schedules (e.g. 00:00 to 00:00, 12:00 AM to 12:00 AM, or 00:00 to 24:00)
  if (startMinutes === endMinutes || (startMinutes === 0 && endMinutes === 1440)) {
    return true;
  }

  let tz =
    typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);

    const getPart = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "0";
    let currentHour = Number(getPart("hour"));
    if (currentHour === 24) currentHour = 0;
    const currentMin = Number(getPart("minute"));
    const currentMinutes = currentHour * 60 + currentMin;

    if (startMinutes <= endMinutes) {
      // Standard daytime window: e.g., 09:00 to 17:00
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Overnight window: e.g., 22:00 to 06:00 (next day)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  } catch (error) {
    console.error(
      `Error calculating notification window for timezone ${tz}:`,
      error,
    );
    return true;
  }
}
