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
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");

/**
 * Folds lines longer than 75 characters per RFC 5545 section 3.1.
 */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  parts.push(line.slice(0, 75));
  let remaining = line.slice(75);
  while (remaining.length > 0) {
    parts.push(" " + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return parts.join("\r\n");
}

export const formatDateTimeForCalendar = (
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
): { start: string; end: string } => {
  if (!dateStr || !timeStr) return { start: "", end: "" };
  const start = new Date(`${dateStr}T${timeStr}`);
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

  if (typeof venueNameOrOptions === "object" && venueNameOrOptions !== null) {
    venueName = venueNameOrOptions.venueName ?? "";
    address = venueNameOrOptions.venueAddress ?? venueNameOrOptions.location ?? "";
    date = venueNameOrOptions.date ?? "";
    time = venueNameOrOptions.time ?? "";
    durationMinutes = venueNameOrOptions.durationMinutes ?? 60;
    confirmationId = venueNameOrOptions.confirmationId ?? "";
    bookingId = venueNameOrOptions.bookingId ?? confirmationId;
    timezone = venueNameOrOptions.timezone ?? "";
    customSummary = venueNameOrOptions.summary ?? "";
    customDescription = venueNameOrOptions.description ?? "";
  } else {
    venueName = venueNameOrOptions ?? "";
    address = venueAddress ?? "";
    date = dateStr ?? "";
    time = timeStr ?? "";

    if (typeof durationOrOptions === "number") {
      durationMinutes = durationOrOptions;
      confirmationId = legacyConfirmationId;
      bookingId = legacyConfirmationId;
    } else if (typeof durationOrOptions === "object" && durationOrOptions !== null) {
      durationMinutes = durationOrOptions.durationMinutes ?? 60;
      confirmationId = durationOrOptions.confirmationId ?? legacyConfirmationId;
      bookingId = durationOrOptions.bookingId ?? confirmationId;
      timezone = durationOrOptions.timezone ?? "";
      customSummary = durationOrOptions.summary ?? "";
      customDescription = durationOrOptions.description ?? "";
    }
  }

  if (!timezone) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      timezone = "UTC";
    }
  }

  const { start, end } = formatDateTimeForCalendar(date, time, durationMinutes);
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
    confirmationId && confirmationId !== referenceId ? `Confirmation: ${confirmationId}` : "",
    `Duration: ${durationLabel}`,
    timezone ? `Timezone: ${timezone}` : "",
  ].filter(Boolean);

  const description = escapeIcsText(customDescription || descriptionLines.join("\n"));

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
