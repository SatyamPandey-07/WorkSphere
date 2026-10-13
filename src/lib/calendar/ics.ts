/**
 * RFC 5545 Compliant iCalendar (.ics) Generator & Downloader
 *
 * Supports generating individual and bulk calendar events for confirmed bookings.
 */

export const escapeIcsText = (text: string): string =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");

/**
 * Folds lines longer than 75 octets per RFC 5545 section 3.1.
 * Ensures continuation lines begin with a single space and multi-byte UTF-8
 * characters are not split across fold boundaries.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let isFirst = true;
  let currentPart = "";
  let currentBytes = isFirst ? 0 : 1;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const limit = 75;

    if (currentBytes + charBytes > limit) {
      if (isFirst) {
        parts.push(currentPart);
        isFirst = false;
      } else {
        parts.push(" " + currentPart);
      }
      currentPart = char;
      currentBytes = (isFirst ? 0 : 1) + charBytes;
    } else {
      currentPart += char;
      currentBytes += charBytes;
    }
  }

  if (currentPart.length > 0) {
    if (isFirst) {
      parts.push(currentPart);
    } else {
      parts.push(" " + currentPart);
    }
  }

  return parts.join("\r\n");
}

/**
 * Offset (ms) between UTC and the wall-clock time shown in `timeZone` at the
 * given instant. Positive for zones ahead of UTC.
 */
const timeZoneOffsetMs = (instant: Date, timeZone: string): number => {
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
    Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

/**
 * Converts a wall-clock date ("2026-07-20") and time ("14:30") chosen in an
 * IANA timezone into the matching UTC instant. Without a (valid) timezone the
 * time is read in the runtime's local zone, as before.
 */
const wallClockToDate = (
  dateStr: string,
  timeStr: string,
  timeZone?: string,
): Date => {
  const local = new Date(`${dateStr}T${timeStr}`);
  if (isNaN(local.getTime()) || !timeZone) return local;

  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const [hour, minute = 0, second = 0] = timeStr.split(":").map(Number);
    const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);

    // Two passes settle the offset across daylight-saving boundaries.
    let utc = wallAsUtc;
    for (let i = 0; i < 2; i++) {
      utc = wallAsUtc - timeZoneOffsetMs(new Date(utc), timeZone);
    }
    const result = new Date(utc);
    return isNaN(result.getTime()) ? local : result;
  } catch {
    // Unknown timezone name: fall back to the runtime's local zone.
    return local;
  }
};

export const formatDateTimeForCalendar = (
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
  timeZone?: string,
): { start: string; end: string } => {
  if (!dateStr || !timeStr) return { start: "", end: "" };
  const start = wallClockToDate(dateStr, timeStr, timeZone);
  if (isNaN(start.getTime())) return { start: "", end: "" };
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const format = (d: Date) => d.toISOString().replace(/-|:|\.\d\d\d/g, "");

  return {
    start: format(start),
    end: format(end),
  };
};

export interface ICSOptions {
  venueName?: string;
  venueAddress?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  confirmationId?: string;
  bookingId?: string;
  timezone?: string;
  description?: string;
  summary?: string;
  location?: string;
  alarmMinutes?: number;
}

/**
 * Generates RFC 5545 iCalendar format string for a reservation.
 *
 * Includes: SUMMARY, DTSTART, DTEND, LOCATION, and DESCRIPTION with venue address and booking ID.
 */
export function generateICSContent(
  venueNameOrOptions: string | ICSOptions,
  venueAddress = "",
  dateStr = "",
  timeStr = "",
  durationOrOptions: number | ICSOptions = 60,
  legacyConfirmationId = "",
): string {
  let venueName = "";
  let address = "";
  let date = "";
  let time = "";
  let durationMinutes = 60;
  let confirmationId = "";
  let bookingId = "";
  let timezone = "";
  let customSummary = "";
  let customDescription = "";
  let alarmMinutes: number | undefined;

  if (typeof venueNameOrOptions === "object" && venueNameOrOptions !== null) {
    venueName = venueNameOrOptions.venueName ?? "";
    address =
      venueNameOrOptions.venueAddress ?? venueNameOrOptions.location ?? "";
    date = venueNameOrOptions.date ?? "";
    time = venueNameOrOptions.time ?? "";
    durationMinutes = venueNameOrOptions.durationMinutes ?? 60;
    confirmationId = venueNameOrOptions.confirmationId ?? "";
    bookingId = venueNameOrOptions.bookingId ?? confirmationId;
    timezone = venueNameOrOptions.timezone ?? "";
    customSummary = venueNameOrOptions.summary ?? "";
    customDescription = venueNameOrOptions.description ?? "";
    alarmMinutes = venueNameOrOptions.alarmMinutes;
  } else {
    venueName = venueNameOrOptions ?? "";
    address = venueAddress ?? "";
    date = dateStr ?? "";
    time = timeStr ?? "";

    if (typeof durationOrOptions === "number") {
      durationMinutes = durationOrOptions;
      confirmationId = legacyConfirmationId;
      bookingId = legacyConfirmationId;
    } else if (
      typeof durationOrOptions === "object" &&
      durationOrOptions !== null
    ) {
      durationMinutes = durationOrOptions.durationMinutes ?? 60;
      confirmationId = durationOrOptions.confirmationId ?? legacyConfirmationId;
      bookingId = durationOrOptions.bookingId ?? confirmationId;
      timezone = durationOrOptions.timezone ?? "";
      customSummary = durationOrOptions.summary ?? "";
      customDescription = durationOrOptions.description ?? "";
      alarmMinutes = durationOrOptions.alarmMinutes;
    }
  }

  if (!timezone) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      timezone = "UTC";
    }
  }

  const { start, end } = formatDateTimeForCalendar(
    date,
    time,
    durationMinutes,
    timezone,
  );
  if (!start) return "";

  const durationLabel = `${durationMinutes} min`;
  const referenceId = bookingId || confirmationId;
  const defaultSummary = referenceId
    ? `Booking at ${venueName} (${durationLabel}) [${referenceId}] - ${address}`
    : `Booking at ${venueName} (${durationLabel}) - ${address}`;
  const summary = customSummary || defaultSummary;

  const descriptionLines: string[] = [
    `Hot desk booking at ${venueName}`,
    `Venue Address: ${address}`,
    referenceId ? `Booking ID: ${referenceId}` : "",
    confirmationId && confirmationId !== referenceId
      ? `Confirmation: ${confirmationId}`
      : "",
    `Duration: ${durationLabel}`,
    timezone ? `Timezone: ${timezone}` : "",
  ].filter(Boolean);

  const description = escapeIcsText(
    customDescription || descriptionLines.join("\n"),
  );

  const uid = referenceId
    ? `${referenceId.replace(/[^A-Za-z0-9#-]/g, "")}@worksphere.app`
    : `booking-${start}@worksphere.app`;

  const stamp = new Date().toISOString().replace(/-|:|\.\d\d\d/g, "");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSphere//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(timezone ? [`X-WR-TIMEZONE:${escapeIcsText(timezone)}`] : []),
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeIcsText(address)}`,
    "STATUS:CONFIRMED",
    ...(alarmMinutes !== undefined && alarmMinutes > 0
      ? [
          "BEGIN:VALARM",
          `TRIGGER:-PT${alarmMinutes}M`,
          "ACTION:DISPLAY",
          `DESCRIPTION:Reminder: ${escapeIcsText(summary)}`,
          "END:VALARM",
        ]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/**
 * Convenience alias for generateICSContent.
 */
export const generateICS = generateICSContent;

/**
 * Triggers a browser download of the generated .ics file for a booking.
 */
export const downloadICS = (
  venueNameOrOptions: string | ICSOptions,
  venueAddress = "",
  dateStr = "",
  timeStr = "",
  durationOrOptions: number | ICSOptions = 60,
  legacyConfirmationId = "",
): void => {
  const icsContent = generateICSContent(
    venueNameOrOptions,
    venueAddress,
    dateStr,
    timeStr,
    durationOrOptions,
    legacyConfirmationId,
  );
  if (!icsContent) return;

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;

  const venueName =
    typeof venueNameOrOptions === "object"
      ? venueNameOrOptions.venueName || "booking"
      : venueNameOrOptions || "booking";

  link.download = `booking-${venueName.replace(/\s+/g, "-").toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export interface BulkBooking {
  venueName: string;
  venueAddress: string;
  date: string;
  time: string;
  duration?: number;
  confirmationId?: string;
  bookingId?: string;
  timeZone?: string;
}

/**
 * Generate a single RFC 5545 .ics file containing one VEVENT per booking.
 * Returns null if none of the bookings produced valid date/time values.
 */
export function generateBulkICSContent(bookings: BulkBooking[]): string | null {
  const events: string[] = [];
  const stamp = new Date().toISOString().replace(/-|:|\.\d\d\d/g, "");

  for (const b of bookings) {
    const { start, end } = formatDateTimeForCalendar(
      b.date,
      b.time,
      b.duration ?? 60,
      b.timeZone,
    );
    if (!start) continue;

    const durationLabel = `${b.duration ?? 60} min`;
    const refId = b.bookingId || b.confirmationId;
    const summary = refId
      ? `Booking at ${b.venueName} (${durationLabel}) [${refId}]`
      : `Booking at ${b.venueName} (${durationLabel})`;
    const uid = refId
      ? `${refId.replace(/[^A-Za-z0-9#-]/g, "")}@worksphere.app`
      : `booking-${start}-${Math.random().toString(36).slice(2, 8)}@worksphere.app`;

    const description = escapeIcsText(
      [
        `Hot desk booking at ${b.venueName}`,
        `Venue Address: ${b.venueAddress}`,
        refId ? `Booking ID: ${refId}` : "",
        `Duration: ${durationLabel}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    events.push(
      [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        `DESCRIPTION:${description}`,
        `LOCATION:${escapeIcsText(b.venueAddress)}`,
        "STATUS:CONFIRMED",
        "END:VEVENT",
      ].join("\r\n"),
    );
  }

  if (events.length === 0) return null;

  const rawLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSphere//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.flatMap((e) => e.split("\r\n")),
    "END:VCALENDAR",
  ];

  return rawLines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/**
 * Download all confirmed bookings as a single worksphere-bookings.ics file.
 */
export function downloadBulkICS(bookings: BulkBooking[]): void {
  const content = generateBulkICSContent(bookings);
  if (!content) return;

  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worksphere-bookings.ics";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
