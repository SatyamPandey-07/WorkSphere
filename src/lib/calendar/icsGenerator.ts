 feat/rrule-ics-calendar-7422
export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

export interface RecurrenceOptions {
  freq: RecurrenceFrequency;
  interval?: number;
  byDay?: string[]; // e.g., ["MO", "WE", "FR"]
  until?: Date;
  count?: number;
  exdates?: Date[]; // Cancelled exception dates

import { parseBookingDateTime } from "@/lib/booking/dateTimeAdapter";
import {
  buildIcsAlarmLines,
  escapeIcsText,
  foldIcsLine,
  type IcsAlarm,
} from "@/lib/calendar/ics";

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
 main
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

 feat/rrule-ics-calendar-7422
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

/** 2026-07-20T04:30:00Z (the shape Outlook web deeplinks expect) */
function formatIsoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

function mapStatus(status?: string | null): BookingCalendarEvent["status"] {
  const value = (status ?? "").toUpperCase();
  if (value === "CANCELLED" || value === "CANCELLED_BY_OPERATOR") return "CANCELLED";
  if (value === "PENDING") return "TENTATIVE";
  return "CONFIRMED";
 main
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

/**
 * Generate RFC 5545 iCalendar content string for booking events
 */
 feat/rrule-ics-calendar-7422
export function generateICS(event: IcsEventOptions): string {
  const now = new Date();
  const lines: string[] = [

export function generateBookingIcs(
  booking: BookingCalendarInput,
  options: BookingIcsOptions = {},
): string | null {
  const event = buildBookingCalendarEvent(booking);
  if (!event) return null;

  const alarms =
    options.alarms ??
    (options.alarmMinutes ?? [30])
      .filter((minutes) => Number.isInteger(minutes) && minutes > 0 && minutes <= 10_080)
      .map((minutes) => ({ trigger: `-PT${minutes}M` }));
  const stamp = formatIcsUtc(options.now ?? new Date());

  const lines = [
 main
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSphere//Desk Booking Generator//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
 feat/rrule-ics-calendar-7422
    `DTSTAMP:${formatDateToICS(now)}`,
    `DTSTART:${formatDateToICS(event.start)}`,
    `DTEND:${formatDateToICS(event.end)}`,
    `SUMMARY:${escapeICS(event.summary)}`,

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
 main
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

function escapeICS(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}
