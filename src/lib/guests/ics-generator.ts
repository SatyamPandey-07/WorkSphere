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
 * Formats a Date to ICS-compatible local time string: YYYYMMDDTHHmmSS
 */
function formatIcsDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
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
  const nowFormatted = formatIcsDate(now);

  // Build description with directions and venue info
  const descriptionLines: string[] = [
    `Workspace session at ${data.location}`,
    "",
    `Address: ${data.locationAddress}`,
    "",
    "Directions:",
    getDirectionsUrl(data.venueLatitude, data.venueLongitude),
    "",
    "Host: " + data.organizerName,
  ];

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
export function generateIcsUid(bookingId: string, guestEmail: string): string {
  const hash = `${bookingId}-${guestEmail}-${Date.now()}`;
  // Simple deterministic hash for uniqueness
  let hashVal = 0;
  for (let i = 0; i < hash.length; i++) {
    const char = hash.charCodeAt(i);
    hashVal = (hashVal << 5) - hashVal + char;
    hashVal |= 0; // Convert to 32bit integer
  }
  const hexHash = Math.abs(hashVal).toString(16).padStart(8, "0");
  return `worksphere-guest-${bookingId.substring(0, 8)}-${hexHash}@worksphere.io`;
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
}): IcsEventData {
  const startDate = new Date(`${params.date}T${params.time}:00`);
  const endDate = new Date(
    startDate.getTime() + params.durationMinutes * 60 * 1000,
  );

  const uid = generateIcsUid(params.bookingId, params.guestEmail);

  return {
    title: `Workspace Session at ${params.venueName}`,
    description: `You're invited to a coworking session at ${params.venueName}. Join ${params.hostName} for a productive workspace session.`,
    location: params.venueName,
    locationAddress: params.venueAddress,
    startDate: formatIcsDate(startDate),
    endDate: formatIcsDate(endDate),
    organizerName: params.hostName,
    organizerEmail: params.hostEmail,
    attendeeEmail: params.guestEmail,
    attendeeName: params.guestName,
    uid,
    venueLatitude: params.venueLatitude,
    venueLongitude: params.venueLongitude,
    venuePhotoUrl: params.venuePhotoUrl,
  };
}

/**
 * Creates a Blob from ICS content suitable for email attachment or download.
 */
export function createIcsBlob(icsContent: string): Blob {
  return new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
}
