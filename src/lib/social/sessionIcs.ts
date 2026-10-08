/**
 * RFC 5545 iCalendar (.ics) Generator for WorkSphere Coworking Sessions (#4953)
 */

export interface SessionIcsOptions {
  title: string;
  description?: string | null;
  startsAt: string | Date;
  endsAt: string | Date;
  venueName?: string | null;
  venueAddress?: string | null;
  slug: string;
  organizerName?: string | null;
  organizerEmail?: string | null;
  url?: string | null;
}

/**
 * Format a Date object to RFC 5545 UTC timestamp format: YYYYMMDDTHHmmssZ
 */
export function formatIcsUtcDate(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Escapes characters per RFC 5545 specifications (commas, semicolons, backslashes, newlines).
 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

/**
 * Generates an RFC 5545 compliant .ics calendar event string.
 */
export function generateSessionIcs(options: SessionIcsOptions): string {
  const dtStamp = formatIcsUtcDate(new Date());
  const dtStart = formatIcsUtcDate(options.startsAt);
  const dtEnd = formatIcsUtcDate(options.endsAt);
  const uid = `session-${options.slug}@worksphere.app`;

  const location =
    [options.venueName, options.venueAddress].filter(Boolean).join(", ") ||
    "WorkSphere Coworking Space";

  const description =
    options.description ||
    `Coworking study and work session at ${options.venueName || "WorkSphere"}.`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSphere//SocialCoworkingSession//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(options.title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    "STATUS:CONFIRMED",
  ];

  if (options.organizerName) {
    const email = options.organizerEmail || "noreply@worksphere.app";
    lines.push(
      `ORGANIZER;CN=${escapeIcsText(options.organizerName)}:mailto:${email}`,
    );
  }

  if (options.url) {
    lines.push(`URL:${options.url}`);
  }

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  // RFC 5545 mandates CRLF line endings
  return lines.join("\r\n");
}
