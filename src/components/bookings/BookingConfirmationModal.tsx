import React, { useEffect, useRef } from 'react';
import { Calendar, Download, X, Printer, MapPin, Clock } from 'lucide-react';

export interface BookingReceiptData {
  id: string;
  venueName: string;
  venueAddress?: string;
  address?: string;
  spaceTitle?: string;
  date?: string; // YYYY-MM-DD or ISO string
  startTime?: string; // HH:mm or HH:mm:ss
  endTime?: string; // HH:mm or HH:mm:ss
  startDateTime?: string; // ISO string fallback
  endDateTime?: string; // ISO string fallback
  totalAmount?: number;
  currency?: string;
  passcode?: string;
  referenceNumber?: string;
}

export interface BookingConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingReceiptData | null;
}

/**
 * Escapes characters according to RFC 5545 specification for TEXT property values:
 * backslash, semicolon, comma, and newline.
 */
export function escapeIcsText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Formats a Date object to RFC 5545 UTC timestamp: YYYYMMDDTHHmmssZ
 */
export function formatIcsUtcDate(date: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Parses booking date and time components safely into a valid Date object.
 */
export function parseBookingDateTime(
  dateStr?: string,
  timeStr?: string,
  isoFallback?: string
): Date | null {
  if (isoFallback) {
    const parsed = new Date(isoFallback);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  if (!dateStr) return null;

  // Try parsing dateStr directly if it includes full timestamp
  if (dateStr.includes('T')) {
    const directDate = new Date(dateStr);
    if (!isNaN(directDate.getTime())) return directDate;
  }

  const timePart = timeStr ? timeStr.trim() : '09:00';
  const combined = `${dateStr.trim()}T${timePart.length === 5 ? timePart + ':00' : timePart}`;
  const parsed = new Date(combined);
  if (!isNaN(parsed.getTime())) return parsed;

  const fallback = new Date(dateStr);
  return !isNaN(fallback.getTime()) ? fallback : null;
}

/**
 * Generates RFC 5545 compliant .ics string for a confirmed reservation.
 */
export function generateIcsCalendar(booking: BookingReceiptData): string | null {
  if (!booking || !booking.id) {
    return null;
  }

  const startDate = parseBookingDateTime(booking.date, booking.startTime, booking.startDateTime);
  let endDate = parseBookingDateTime(booking.date, booking.endTime, booking.endDateTime);

  // If no valid start date can be parsed, cannot create a valid RFC 5545 event
  if (!startDate) {
    return null;
  }

  // If end date is missing or not after start date, default to start + 1 hour
  if (!endDate || endDate.getTime() <= startDate.getTime()) {
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  }

  const now = new Date();
  const dtStamp = formatIcsUtcDate(now);
  const dtStart = formatIcsUtcDate(startDate);
  const dtEnd = formatIcsUtcDate(endDate);

  const venueName = booking.venueName || 'WorkSphere Venue';
  const spaceTitle = booking.spaceTitle ? ` - ${booking.spaceTitle}` : '';
  const summary = escapeIcsText(`${venueName}${spaceTitle}`);
  const location = escapeIcsText(booking.venueAddress || booking.address || venueName);

  const descriptionLines: string[] = [
    `Reservation at ${venueName}`,
    booking.spaceTitle ? `Space: ${booking.spaceTitle}` : '',
    `Booking ID: ${booking.id}`,
    booking.passcode ? `Access Code: ${booking.passcode}` : '',
    booking.referenceNumber ? `Reference: ${booking.referenceNumber}` : '',
  ].filter(Boolean);

  const description = escapeIcsText(descriptionLines.join('\n'));
  const uid = `${booking.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'booking'}-${Date.now()}@worksphere.com`;

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WorkSphere//Booking Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return icsLines.join('\r\n');
}

/**
 * Triggers download of the generated .ics file in browser environments.
 */
export function downloadBookingIcs(booking: BookingReceiptData): boolean {
  try {
    const icsContent = generateIcsCalendar(booking);
    if (!icsContent) return false;

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const sanitizedId = (booking.id || 'reservation').replace(/[^a-zA-Z0-9_-]/g, '_');
    link.setAttribute('download', `booking-${sanitizedId}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Failed to download calendar event:', err);
    return false;
  }
}

export const BookingConfirmationModal: React.FC<BookingConfirmationModalProps> = ({
  isOpen,
  onClose,
  booking,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !booking) {
    return null;
  }

  const handlePrint = () => {
    window.print();
  };

  const handleAddToCalendar = () => {
    downloadBookingIcs(booking);
  };

  const venueAddress = booking.venueAddress || booking.address;
  const timeDisplay =
    booking.startTime && booking.endTime
      ? `${booking.startTime} - ${booking.endTime}`
      : booking.startTime || '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-confirmation-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      ref={modalRef}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 transition-all">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute top-4 right-4 rounded-full p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="text-center sm:text-left mb-6">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 mb-3">
            <Calendar className="h-6 w-6" />
          </div>
          <h2
            id="booking-confirmation-title"
            className="text-2xl font-bold text-slate-900 dark:text-white"
          >
            Reservation Confirmed!
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Reference #{booking.referenceNumber || booking.id}
          </p>
        </div>

        {/* Details Card */}
        <div className="space-y-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-sm">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white text-base">
              {booking.venueName}
            </h3>
            {booking.spaceTitle && (
              <p className="text-slate-600 dark:text-slate-300 font-medium">
                {booking.spaceTitle}
              </p>
            )}
          </div>

          {venueAddress && (
            <div className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
              <MapPin className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
              <span>{venueAddress}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-slate-600 dark:text-slate-300">
            {booking.date && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                <span>{booking.date}</span>
              </div>
            )}
            {timeDisplay && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-slate-400 shrink-0" />
                <span>{timeDisplay}</span>
              </div>
            )}
          </div>

          {booking.passcode && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
              <span className="text-xs uppercase font-semibold tracking-wider text-slate-500 dark:text-slate-400">
                Access Code
              </span>
              <span className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">
                {booking.passcode}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
          <button
            type="button"
            onClick={handleAddToCalendar}
            data-testid="add-to-calendar-btn"
            aria-label="Add to Calendar"
            className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
          >
            <Download className="h-4 w-4" />
            Add to Calendar (.ics)
          </button>

          <button
            type="button"
            onClick={handlePrint}
            aria-label="Print receipt"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookingConfirmationModal;
