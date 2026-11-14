import { parseBookingDateTime } from "@/lib/booking/dateTimeAdapter";
import { escapeIcsText, foldIcsLine } from "@/lib/calendar/ics";

export interface CalendarEvent {
  title: string;
  description: string;
  location: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
}

/**
 * Generates a pre-filled Google Calendar event URL.
 */
export function generateGoogleCalendarUrl(event: CalendarEvent): string {
  const formatDate = (isoString: string) => {
    return new Date(isoString).toISOString().replace(/-|:|\.\d\d\d/g, "");
  };

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    details: event.description,
    location: event.location,
    dates: `${formatDate(event.startTime)}/${formatDate(event.endTime)}`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generates and triggers a download for an .ics calendar file compatible with Apple Calendar and Outlook.
 */
export function downloadIcsFile(event: CalendarEvent): void {
  const formatDate = (isoString: string) => {
    return new Date(isoString).toISOString().replace(/-|:|\.\d\d\d/g, "");
  };

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Coworking Session//EN",
    "BEGIN:VEVENT",
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`,
    `LOCATION:${event.location}`,
    `DTSTART:${formatDate(event.startTime)}`,
    `DTEND:${formatDate(event.endTime)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute(
    "download",
    `${event.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.ics`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Booking calendar sync (RFC 5545 feed + one click web links)
// ---------------------------------------------------------------------------

export interface BookingCalendarInput {
  id: string;
  confirmationId?: string | null;
  date: string;
  time: string;
  timeZone?: string | null;
  duration?: number | null;
  status?: string | null;
  seatNumber?: string | null;
  venue: {
    name: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
}

export interface BookingCalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  title: string;
  description: string;
  location: string;
  timeZone: string;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  geo: { latitude: number; longitude: number } | null;
}

export interface BookingIcsOptions {
  /** Minutes before start for each VALARM. Defaults to a single 30 minute reminder. */
  alarmMinutes?: number[];
  /** Injectable clock for DTSTAMP, mainly for tests. */
  now?: Date;
}

const DEFAULT_DURATION_MINUTES = 60;
const MAX_DURATION_MINUTES = 24 * 60;

/** 20260720T043000Z */
export function formatIcsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** 2026-07-20T04:30:00Z (the shape Outlook web deeplinks expect) */
function formatIsoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

function mapStatus(status?: string | null): BookingCalendarEvent["status"] {
  const value = (status ?? "").toUpperCase();
  if (value === "CANCELLED") return "CANCELLED";
  if (value === "PENDING") return "TENTATIVE";
  return "CONFIRMED";
}

/**
 * Normalises a booking row into a calendar event. The wall clock date and time
 * are read in the booking's own IANA zone (falling back to UTC) so the UTC
 * instants are right regardless of where the server runs.
 * Returns null when the date or time cannot be parsed.
 */
export function buildBookingCalendarEvent(
  booking: BookingCalendarInput,
): BookingCalendarEvent | null {
  const timeZone = booking.timeZone || "UTC";
  const start = parseBookingDateTime(booking.date, booking.time, timeZone);
  if (!start) return null;

  const rawDuration = booking.duration;
  const minutes =
    isFiniteNumber(rawDuration) && rawDuration > 0
      ? Math.min(Math.floor(rawDuration), MAX_DURATION_MINUTES)
      : DEFAULT_DURATION_MINUTES;
  const end = new Date(start.getTime() + minutes * 60_000);

  const ref = booking.confirmationId || booking.id;
  const venueName = booking.venue.name;
  const address = booking.venue.address?.trim() || "";
  const location = address ? `${venueName}, ${address}` : venueName;

  const description = [
    `Booking at ${venueName}`,
    address ? `Address: ${address}` : "",
    booking.seatNumber ? `Seat: ${booking.seatNumber}` : "",
    `Booking ID: ${ref}`,
    `Duration: ${minutes} min`,
    `Local time zone: ${timeZone}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { latitude, longitude } = booking.venue;
  const geo =
    isFiniteNumber(latitude) &&
    isFiniteNumber(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
      ? { latitude, longitude }
      : null;

  return {
    uid: `${booking.id.replace(/[^A-Za-z0-9-]/g, "")}@worksphere.app`,
    start,
    end,
    title: `Booking at ${venueName}`,
    description,
    location,
    timeZone,
    status: mapStatus(booking.status),
    geo,
  };
}

/**
 * RFC 5545 iCalendar feed for one booking. Lines are CRLF terminated, folded at
 * 75 octets, and text values are escaped. Times are written in UTC so every
 * client (Apple, Google, Outlook) resolves the same instant.
 * Returns null when the booking date or time is invalid.
 */
export function generateBookingIcs(
  booking: BookingCalendarInput,
  options: BookingIcsOptions = {},
): string | null {
  const event = buildBookingCalendarEvent(booking);
  if (!event) return null;

  const alarms = (options.alarmMinutes ?? [30]).filter(
    (m) => Number.isInteger(m) && m > 0 && m <= 10_080,
  );
  const stamp = formatIcsUtc(options.now ?? new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSphere//Booking Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatIcsUtc(event.start)}`,
    `DTEND:${formatIcsUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    ...(event.geo ? [`GEO:${event.geo.latitude};${event.geo.longitude}`] : []),
    `STATUS:${event.status}`,
    "TRANSP:OPAQUE",
    ...alarms.flatMap((m) => [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:-PT${m}M`,
      `DESCRIPTION:${escapeIcsText(`Reminder: ${event.title}`)}`,
      "END:VALARM",
    ]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** One click "add to Google Calendar" link. */
export function buildGoogleCalendarLink(event: BookingCalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${formatIcsUtc(event.start)}/${formatIcsUtc(event.end)}`,
    details: event.description,
    location: event.location,
    ctz: event.timeZone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** One click "add to Outlook" link (personal accounts by default, work or school with `work`). */
export function buildOutlookWebLink(
  event: BookingCalendarEvent,
  account: "personal" | "work" = "personal",
): string {
  const host = account === "work" ? "outlook.office.com" : "outlook.live.com";
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: formatIsoUtc(event.start),
    enddt: formatIsoUtc(event.end),
    body: event.description,
    location: event.location,
  });
  return `https://${host}/calendar/0/deeplink/compose?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// RFC 5545 RRULE Series Generator
// ---------------------------------------------------------------------------

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

export interface RecurrenceOptions {
  freq: RecurrenceFrequency;
  interval?: number;
  byDay?: string[]; // e.g., ["MO", "WE", "FR"]
  until?: Date;
  count?: number;
  exdates?: Date[]; // Cancelled exception dates
}

export interface IcsEventOptions {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  recurrence?: RecurrenceOptions;
  organizer?: { name: string; email: string };
}

/**
 * Format Date to UTC iCalendar format: YYYYMMDDTHHMMSSZ
 */
export function formatDateToICS(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Build RFC 5545 compliant RRULE string
 */
export function buildRRule(options: RecurrenceOptions): string {
  const parts: string[] = [`FREQ=${options.freq}`];

  if (options.interval && options.interval > 1) {
    parts.push(`INTERVAL=${options.interval}`);
  }

  if (options.byDay && options.byDay.length > 0) {
    parts.push(`BYDAY=${options.byDay.join(",")}`);
  }

  if (options.until) {
    parts.push(`UNTIL=${formatDateToICS(options.until)}`);
  } else if (options.count && options.count > 0) {
    parts.push(`COUNT=${options.count}`);
  }

  return `RRULE:${parts.join(";")}`;
}

function escapeICS(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Generate RFC 5545 iCalendar content string for booking events
 */
export function generateICS(event: IcsEventOptions): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSphere//Desk Booking Generator//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${formatDateToICS(now)}`,
    `DTSTART:${formatDateToICS(event.start)}`,
    `DTEND:${formatDateToICS(event.end)}`,
    `SUMMARY:${escapeICS(event.summary)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeICS(event.location)}`);
  }

  if (event.organizer) {
    lines.push(
      `ORGANIZER;CN=${escapeICS(event.organizer.name)}:mailto:${event.organizer.email}`,
    );
  }

  if (event.recurrence) {
    lines.push(buildRRule(event.recurrence));

    if (event.recurrence.exdates && event.recurrence.exdates.length > 0) {
      const formattedExdates = event.recurrence.exdates
        .map((d) => formatDateToICS(d))
        .join(",");
      lines.push(`EXDATE:${formattedExdates}`);
    }
  }

  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n");
}
