/**
 * Checks whether the current time falls within a user's notification window.
 *
 * @param now The current date/time
 * @param start Start time in HH:mm format (e.g. "09:00" or "9:00 AM")
 * @param end End time in HH:mm format (e.g. "17:00" or "5:00 PM")
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

  const tz = timezone || "UTC";

  try {
    // Get the hour and minute in the user's timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const formatted = formatter.format(now);
    const parts = formatted.split(":");
    let currentHour = parseInt(parts[0], 10);
    const currentMin = parseInt(parts[1], 10);

    // Normalize 24 to 0
    if (currentHour === 24) {
      currentHour = 0;
    }

    const currentMinutes = currentHour * 60 + currentMin;

    const parseTimeToMinutes = (timeStr: string): number => {
      // Check for 12-hour format: e.g. "09:00 AM" or "9:00 PM"
      const match12 = timeStr.match(/^\s*(\d+):(\d+)\s*(AM|PM)\s*$/i);
      if (match12) {
        let h = parseInt(match12[1], 10);
        const m = parseInt(match12[2], 10);
        const ampm = match12[3].toUpperCase();
        if (ampm === "PM" && h < 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        return h * 60 + m;
      }

      // Check for 24-hour format: e.g. "09:00"
      const match24 = timeStr.match(/^\s*(\d+):(\d+)\s*$/);
      if (match24) {
        const h = parseInt(match24[1], 10);
        const m = parseInt(match24[2], 10);
        return h * 60 + m;
      }
      return 0;
    };

    const startMinutes = parseTimeToMinutes(start);
    const endMinutes = parseTimeToMinutes(end);

    if (startMinutes <= endMinutes) {
      // Standard window: e.g., 09:00 to 17:00
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
    // Fall back to sending notifications on error
    return true;
  }
}
