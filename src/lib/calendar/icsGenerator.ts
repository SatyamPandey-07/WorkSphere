import { parseBookingDateTime } from "@/lib/booking/dateTimeAdapter";
import {
  buildIcsAlarmLines,
  escapeIcsText,
  foldIcsLine,
  type IcsAlarm,
} from "@/lib/calendar/ics";

// Re-export escapeIcsText and foldIcsLine for backward compatibility
export { escapeIcsText, foldIcsLine };

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

  // Convenience fields for direct event consumers
  bookingId?: string;
  confirmationCode?: string;
  venueName?: string;
  venueAddress?: string | null;
  seatLabel?: string | null;
  startTime?: Date | string;
  endTime?: Date | string;
  latitude?: number | null;
  longitude?: number | null;
  organizerEmail?: string;
  appUrl?: string;
}

export interface BookingIcsOptions {
  /** Minutes before start for each VALARM. Defaults to a single 30 minute reminder. */
  alarmMinutes?: number[];
  /** Custom RFC 5545 alarm triggers such as -PT15M, -PT1H, or -P1D. */
  alarms?: IcsAlarm[];
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

/** Formats a Date or ISO-8601 string into an RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ */
export function formatIcsUtcDate(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date provided to ICS generator: ${String(input)}`);
  }
  return formatIcsUtc(date);
}

/** 2026-07-20T04:30:00Z (the shape Outlook web deeplinks expect) */
function formatIsoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

function mapStatus(status?: string | null): BookingCalendarEvent["status"] {
  const value = (status ?? "").toUpperCase();
  if (value === "CANCELLED" || value === "CANCELLED_BY_OPERATOR")
    return "CANCELLED";
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
    bookingId: booking.id,
    confirmationCode: ref,
    venueName,
    venueAddress: address,
    seatLabel: booking.seatNumber,
    startTime: start,
    endTime: end,
    latitude: geo?.latitude,
    longitude: geo?.longitude,
  };
}

/**
 * Helper to check whether an object is BookingCalendarInput
 */
function isBookingCalendarInput(obj: any): obj is BookingCalendarInput {
  return Boolean(
    obj &&
    typeof obj === "object" &&
    "date" in obj &&
    "time" in obj &&
    "venue" in obj,
  );
}

/**
 * RFC 5545 iCalendar feed for one booking. Lines are CRLF terminated, folded at
 * 75 octets, and text values are escaped. Times are written in UTC so every
 * client (Apple, Google, Outlook) resolves the same instant.
 * Accepts either BookingCalendarInput or BookingCalendarEvent.
 * Returns null when the booking date or time is invalid.
 */
export function generateBookingIcs(
  bookingOrEvent: BookingCalendarInput | BookingCalendarEvent,
  options: BookingIcsOptions = {},
): string | null {
  let event: BookingCalendarEvent | null = null;

  if (isBookingCalendarInput(bookingOrEvent)) {
    event = buildBookingCalendarEvent(bookingOrEvent);
  } else {
    // It's a BookingCalendarEvent
    const start =
      bookingOrEvent.start instanceof Date
        ? bookingOrEvent.start
        : bookingOrEvent.startTime
          ? new Date(bookingOrEvent.startTime)
          : null;
    const end =
      bookingOrEvent.end instanceof Date
        ? bookingOrEvent.end
        : bookingOrEvent.endTime
          ? new Date(bookingOrEvent.endTime)
          : null;

    if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) {
      return null;
    }

    const venueName = bookingOrEvent.venueName || "Workspace";
    const ref =
      bookingOrEvent.confirmationCode ||
      bookingOrEvent.bookingId ||
      bookingOrEvent.uid ||
      "booking";
    const uid =
      bookingOrEvent.uid ||
      `booking-${bookingOrEvent.bookingId || ref}@worksphere.app`;
    const title =
      bookingOrEvent.title || `WorkSphere Desk: ${venueName} (${ref})`;
    const location =
      bookingOrEvent.location || bookingOrEvent.venueAddress || "";
    const description =
      bookingOrEvent.description ||
      [
        `Upcoming WorkSphere session at ${venueName}`,
        bookingOrEvent.venueAddress
          ? `Address: ${bookingOrEvent.venueAddress}`
          : "",
        bookingOrEvent.seatLabel ? `Seat: ${bookingOrEvent.seatLabel}` : "",
        `Booking Reference: ${ref}`,
      ]
        .filter(Boolean)
        .join("\n");

    const lat = bookingOrEvent.geo?.latitude ?? bookingOrEvent.latitude;
    const lon = bookingOrEvent.geo?.longitude ?? bookingOrEvent.longitude;
    const geo =
      isFiniteNumber(lat) && isFiniteNumber(lon)
        ? { latitude: lat, longitude: lon }
        : null;

    event = {
      uid,
      start,
      end,
      title,
      description,
      location,
      timeZone: bookingOrEvent.timeZone || "UTC",
      status: bookingOrEvent.status || "CONFIRMED",
      geo,
      bookingId: bookingOrEvent.bookingId,
      confirmationCode: bookingOrEvent.confirmationCode,
      venueName,
      venueAddress: location,
      seatLabel: bookingOrEvent.seatLabel,
      startTime: start,
      endTime: end,
      latitude: geo?.latitude,
      longitude: geo?.longitude,
    };
  }

  if (!event) return null;

  const alarms =
    options.alarms ??
    (options.alarmMinutes ?? [30])
      .filter(
        (minutes) =>
          Number.isInteger(minutes) && minutes > 0 && minutes <= 10_080,
      )
      .map((minutes) => ({ trigger: `-PT${minutes}M` }));
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
    ...buildIcsAlarmLines(alarms, `Reminder: ${event.title}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** One click "add to Google Calendar" link. */
export function buildGoogleCalendarLink(event: BookingCalendarEvent): string {
  const start =
    event.start || (event.startTime ? new Date(event.startTime) : new Date());
  const end =
    event.end || (event.endTime ? new Date(event.endTime) : new Date());
  const title =
    event.title ||
    `WorkSphere Desk: ${event.venueName ?? ""} (${event.confirmationCode ?? ""})`;
  const location = event.location || event.venueAddress || "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${formatIcsUtc(start)}/${formatIcsUtc(end)}`,
    details: event.description,
    location,
  });
  if (event.timeZone) {
    params.set("ctz", event.timeZone);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Compatibility alias for buildGoogleCalendarLink */
export function buildGoogleCalendarUrl(event: BookingCalendarEvent): string {
  return buildGoogleCalendarLink(event);
}

/** One click "add to Outlook" link (personal accounts by default, work or school with `work`). */
export function buildOutlookWebLink(
  event: BookingCalendarEvent,
  account: "personal" | "work" = "personal",
): string {
  const host = account === "work" ? "outlook.office.com" : "outlook.live.com";
  const start =
    event.start || (event.startTime ? new Date(event.startTime) : new Date());
  const end =
    event.end || (event.endTime ? new Date(event.endTime) : new Date());
  const title =
    event.title ||
    `WorkSphere Desk: ${event.venueName ?? ""} (${event.confirmationCode ?? ""})`;
  const location = event.location || event.venueAddress || "";
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: title,
    startdt: formatIsoUtc(start),
    enddt: formatIsoUtc(end),
    body: event.description,
    location,
  });
  return `https://${host}/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * Triggers a browser download of the generated .ics file for Apple Calendar, Outlook, and desktop clients.
 */
export function downloadBookingIcs(
  event: BookingCalendarEvent,
  alarmMinutes?: number,
): void {
  if (typeof window === "undefined") return;

  const icsContent = generateBookingIcs(
    event,
    alarmMinutes ? { alarmMinutes: [alarmMinutes] } : {},
  );
  if (!icsContent) return;

  const blob = new Blob([icsContent], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);

  const safeCode = (
    event.confirmationCode ||
    event.bookingId ||
    "booking"
  ).replace(/[^a-zA-Z0-9-_]/g, "");
  const filename = `worksphere-${safeCode}.ics`;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
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
