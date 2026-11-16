export interface BookingCalendarEvent {
  bookingId: string;
  confirmationCode: string;
  venueName: string;
  venueAddress?: string | null;
  seatLabel?: string | null;
  startTime: Date | string;
  endTime: Date | string;
  latitude?: number | null;
  longitude?: number | null;
  organizerEmail?: string;
  appUrl?: string;
}

/**
 * Formats a Date or ISO-8601 string into an RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ
 */
export function formatIcsUtcDate(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date provided to ICS generator: ${String(input)}`);
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Escapes special characters per RFC 5545 Section 3.3.11 (TEXT value type).
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Folds lines exceeding 75 octets using CRLF + single space per RFC 5545 Section 3.1.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) {
    return line;
  }

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const limit = chunks.length === 0 ? 75 : 74; // Account for leading space on folded lines

    if (currentBytes + charBytes > limit) {
      chunks.push(current);
      current = ` ${char}`;
      currentBytes = 1 + charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.join('\r\n');
}

/**
 * Builds the human-readable event description including venue, address, time window, and confirmation code.
 */
export function buildEventDescription(event: BookingCalendarEvent): string {
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);

  const lines: string[] = [
    `WorkSphere Workspace Reservation`,
    `Confirmation Code: ${event.confirmationCode}`,
    `Venue: ${event.venueName}`,
  ];

  if (event.venueAddress) {
    lines.push(`Address: ${event.venueAddress}`);
  }

  if (event.seatLabel) {
    lines.push(`Desk / Zone: ${event.seatLabel}`);
  }

  lines.push(
    `Start (UTC): ${startDate.toUTCString()}`,
    `End (UTC): ${endDate.toUTCString()}`
  );

  if (event.appUrl) {
    lines.push(`Manage Booking: ${event.appUrl.replace(/\/$/, '')}/dashboard`);
  }

  return lines.join('\n');
}

/**
 * Generates a complete, RFC 5545-compliant iCalendar (.ics) string.
 */
export function generateBookingIcs(
  event: BookingCalendarEvent,
  now: Date = new Date()
): string {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid startTime or endTime for booking calendar event.');
  }

  if (end.getTime() <= start.getTime()) {
    throw new Error('Booking endTime must be strictly after startTime.');
  }

  const dtStamp = formatIcsUtcDate(now);
  const dtStart = formatIcsUtcDate(start);
  const dtEnd = formatIcsUtcDate(end);

  const summary = escapeIcsText(
    `WorkSphere Desk: ${event.venueName} (${event.confirmationCode})`
  );
  const description = escapeIcsText(buildEventDescription(event));
  const location = event.venueAddress ? escapeIcsText(event.venueAddress) : '';
  const uid = `booking-${event.bookingId}@worksphere.app`;

  const rawLines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WorkSphere//Workspace Booking Engine//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    ...(location ? [`LOCATION:${location}`] : []),
    ...(typeof event.latitude === 'number' && typeof event.longitude === 'number'
      ? [`GEO:${event.latitude};${event.longitude}`]
      : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(`Upcoming WorkSphere session at ${event.venueName}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${rawLines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/**
 * Builds a direct Google Calendar template URL for zero-download browser addition.
 */
export function buildGoogleCalendarUrl(event: BookingCalendarEvent): string {
  const dtStart = formatIcsUtcDate(event.startTime);
  const dtEnd = formatIcsUtcDate(event.endTime);
  const title = `WorkSphere Desk: ${event.venueName} (${event.confirmationCode})`;
  const details = buildEventDescription(event);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${dtStart}/${dtEnd}`,
    details,
  });

  if (event.venueAddress) {
    params.set('location', event.venueAddress);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Triggers a browser download of the generated .ics file for Apple Calendar, Outlook, and desktop clients.
 */
export function downloadBookingIcs(event: BookingCalendarEvent): void {
  if (typeof window === 'undefined') return;

  const icsContent = generateBookingIcs(event);
  const blob = new Blob([icsContent], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);

  const safeCode = event.confirmationCode.replace(/[^a-zA-Z0-9-_]/g, '');
  const filename = `worksphere-${safeCode || event.bookingId}.ics`;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}