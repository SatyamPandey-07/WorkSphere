/**
 * ICS Calendar File Generator
 *
 * Generates standard ICS (iCalendar) files for guest invitations.
 * Compliant with RFC 5545. No external library required — pure string building
 * keeps the bundle small and avoids dependency overhead.
 *
 * If a full-featured library is preferred in the future, replace this module's
 * internals while keeping the public API (`generateIcsContent`) stable.
 */

import type { IcsEventData } from "./types";

/**
 * Formats a Date to RFC 5545 UTC timestamp string: YYYYMMDDTHHmmSSZ
 */
export function formatIcsUtc(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Formats a Date to ICS-compatible local or UTC time string.
 * Retained for backward compatibility.
 */
export function formatIcsDate(date: Date): string {
  return formatIcsUtc(date);
}

/**
 * Computes offset (ms) between UTC and wall-clock time in timeZone at the given instant.
 * Positive for zones ahead of UTC.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
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
}

/**
 * Converts a wall-clock date ("YYYY-MM-DD") and time ("HH:MM") chosen in an
 * IANA timezone into the matching UTC Date instant.
 * Handles daylight saving transitions and falls back safely to UTC if invalid/omitted.
 */
export function wallClockToUtcDate(
  dateStr: string,
  timeStr: string,
  timeZone?: string | null,
): Date {
  const safeZone = timeZone?.trim() || "UTC";
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute = 0, second = 0] = timeStr.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  try {
    // Two passes settle the offset across daylight-saving boundaries.
    let utc = wallAsUtc;
    for (let i = 0; i < 2; i++) {
      utc = wallAsUtc - timeZoneOffsetMs(new Date(utc), safeZone);
    }
    const result = new Date(utc);
    return isNaN(result.getTime()) ? new Date(wallAsUtc) : result;
  } catch {
    // Unknown or invalid timezone name: fallback to UTC
    return new Date(wallAsUtc);
  }
}

/**
 * Escapes special characters in ICS text fields per RFC 5545.
 */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

/**
 * Folds long lines per RFC 5545 (max 75 octets per line).
 */
function foldLine(line: string): string {
  const maxLen = 75;
  if (line.length <= maxLen) return line;

  const parts: string[] = [];
  parts.push(line.substring(0, maxLen));
  let remaining = line.substring(maxLen);
  while (remaining.length > 0) {
    // Continuation lines start with a space
    const chunk = remaining.substring(0, maxLen - 1);
    parts.push(" " + chunk);
    remaining = remaining.substring(maxLen - 1);
  }
  return parts.join("\r\n");
}

/**
 * Generates the raw ICS file content for a calendar event.
 *
 * @param data - The event data
 * @returns The complete ICS file content as a string
 */
export function generateIcsContent(data: IcsEventData): string {
  const now = new Date();
  const nowFormatted = formatIcsUtc(now);

  // Build description with directions and venue info
  const descriptionLines: string[] = [
    `Workspace session at ${data.location}`,
    "",
    `Address: ${data.locationAddress}`,
  ];

  if (data.timeZone) {
    descriptionLines.push(`Time Zone: ${data.timeZone}`);
  }

  descriptionLines.push(
    "",
    "Directions:",
    getDirectionsUrl(data.venueLatitude, data.venueLongitude),
    "",
    "Host: " + data.organizerName,
  );

  if (data.venuePhotoUrl) {
    descriptionLines.push("");
    descriptionLines.push("Venue Photo: " + data.venuePhotoUrl);
  }

  const description = escapeIcsText(descriptionLines.join("\n"));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSphere//GuestInvite//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${data.uid}`,
    `DTSTAMP:${nowFormatted}`,
    `DTSTART:${data.startDate}`,
    `DTEND:${data.endDate}`,
    `SUMMARY:${escapeIcsText(data.title)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeIcsText(data.locationAddress)}`,
    `ORGANIZER;CN=${escapeIcsText(data.organizerName)}:mailto:${data.organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${escapeIcsText(data.attendeeName || data.attendeeEmail)}:mailto:${data.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "PRIORITY:5",
    "CLASS:PUBLIC",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:Reminder: ${escapeIcsText(data.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // Fold long lines and join with CRLF per RFC 5545
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/**
 * Generates a directions URL for Google Maps (default provider).
 * Modular: swap this function to change the provider.
 */
function getDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * Generates a unique UID for an ICS event.
 */
export function generateIcsUid(
  _bookingId: string,
  _guestEmail: string,
): string {
  const uuid = crypto.randomUUID();
  return `worksphere-guest-${uuid}@worksphere.io`;
}

/**
 * Builds an IcsEventData from booking and guest info.
 */
export function buildIcsEventData(params: {
  bookingId: string;
  confirmationId: string;
  venueName: string;
  venueAddress: string;
  venueLatitude: number;
  venueLongitude: number;
  venuePhotoUrl?: string;
  hostName: string;
  hostEmail: string;
  guestEmail: string;
  guestName?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number;
  timeZone?: string | null;
}): IcsEventData {
  const timeZone = params.timeZone?.trim() || "UTC";
  const startDate = wallClockToUtcDate(params.date, params.time, timeZone);
  const endDate = new Date(
    startDate.getTime() + params.durationMinutes * 60 * 1000,
  );

  const uid = generateIcsUid(params.bookingId, params.guestEmail);

  return {
    title: `Workspace Session at ${params.venueName}`,
    description: `You're invited to a coworking session at ${params.venueName}. Join ${params.hostName} for a productive workspace session.`,
    location: params.venueName,
    locationAddress: params.venueAddress,
    startDate: formatIcsUtc(startDate),
    endDate: formatIcsUtc(endDate),
    organizerName: params.hostName,
    organizerEmail: params.hostEmail,
    attendeeEmail: params.guestEmail,
    attendeeName: params.guestName,
    uid,
    venueLatitude: params.venueLatitude,
    venueLongitude: params.venueLongitude,
    venuePhotoUrl: params.venuePhotoUrl,
    timeZone,
  };
}

/**
 * Creates a Blob from ICS content suitable for email attachment or download.
 */
export function createIcsBlob(icsContent: string): Blob {
  return new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
}
