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

function escapeICS(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}
