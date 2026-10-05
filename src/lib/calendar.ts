const escapeIcsText = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");

export const formatDateTimeForCalendar = (
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
) => {
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

export const getCalendarUrls = (
  venueName: string,
  venueAddress: string,
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
) => {
  const { start, end } = formatDateTimeForCalendar(
    dateStr,
    timeStr,
    durationMinutes,
  );
  const title = encodeURIComponent(`Booking at ${venueName}`);
  const details = encodeURIComponent(`Hot desk booking at ${venueName}`);
  const location = encodeURIComponent(venueAddress);

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${start}&enddt=${end}&body=${details}&location=${location}`;

  return { googleUrl, outlookUrl, start, end };
};

export interface ICSOptions {
  durationMinutes?: number;
  confirmationId?: string;
  timezone?: string;
  description?: string;
  summary?: string;
}

/**
 * Folds lines longer than 75 characters per RFC 5545 section 3.1.
 */
function foldIcsLine(line: string): string {
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

export const generateICSContent = (
  venueName: string,
  venueAddress: string,
  dateStr: string,
  timeStr: string,
  durationOrOptions: number | ICSOptions = 60,
  legacyConfirmationId = "",
) => {
  const options: ICSOptions =
    typeof durationOrOptions === "number"
      ? {
          durationMinutes: durationOrOptions,
          confirmationId: legacyConfirmationId,
        }
      : durationOrOptions;

  const durationMinutes = options.durationMinutes ?? 60;
  const confirmationId = options.confirmationId ?? "";
  const timezone =
    options.timezone ||
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        return "UTC";
      }
    })();

  const { start, end } = formatDateTimeForCalendar(
    dateStr,
    timeStr,
    durationMinutes,
  );
  if (!start) return "";

  const durationLabel = `${durationMinutes} min`;
  const defaultSummary = confirmationId
    ? `Booking at ${venueName} (${durationLabel}) [${confirmationId}] - ${venueAddress}`
    : `Booking at ${venueName} (${durationLabel}) - ${venueAddress}`;
  const summary = options.summary || defaultSummary;

  const defaultDescription = [
    `Hot desk booking at ${venueName}`,
    `Duration: ${durationLabel}`,
    confirmationId ? `Confirmation: ${confirmationId}` : "",
    timezone ? `Timezone: ${timezone}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const description = escapeIcsText(options.description || defaultDescription);

  const uid = confirmationId
    ? `${confirmationId.replace(/[^A-Za-z0-9#-]/g, "")}@worksphere.app`
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
    `LOCATION:${escapeIcsText(venueAddress)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
};

export const downloadICS = (
  venueName: string,
  venueAddress: string,
  dateStr: string,
  timeStr: string,
  durationOrOptions: number | ICSOptions = 60,
  legacyConfirmationId = "",
) => {
  const icsContent = generateICSContent(
    venueName,
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
  link.download = `booking-${venueName.replace(/\s+/g, "-").toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// Bulk ICS export — multiple bookings in a single calendar file
// ---------------------------------------------------------------------------

interface BulkBooking {
  venueName: string;
  venueAddress: string;
  date: string;
  time: string;
  duration?: number;
  confirmationId?: string;
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
    const summary = b.confirmationId
      ? `Booking at ${b.venueName} (${durationLabel}) [${b.confirmationId}]`
      : `Booking at ${b.venueName} (${durationLabel})`;
    const uid = b.confirmationId
      ? `${b.confirmationId.replace(/[^A-Za-z0-9#-]/g, "")}@worksphere.app`
      : `booking-${start}-${Math.random().toString(36).slice(2, 8)}@worksphere.app`;

    events.push(
      [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        `LOCATION:${escapeIcsText(b.venueAddress)}`,
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
