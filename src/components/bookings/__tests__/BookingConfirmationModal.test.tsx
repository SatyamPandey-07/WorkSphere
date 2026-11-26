import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  BookingConfirmationModal,
  BookingReceiptData,
  escapeIcsText,
  generateIcsCalendar,
  downloadBookingIcs,
} from '../BookingConfirmationModal';

describe('BookingConfirmationModal - Add to Calendar (.ics)', () => {
  const mockBooking: BookingReceiptData = {
    id: 'res_12345',
    referenceNumber: 'WS-9876',
    venueName: 'Central Innovation Hub, Room A',
    venueAddress: '123 Tech Avenue, Silicon District',
    spaceTitle: 'Dedicated Desk 4',
    date: '2026-12-15',
    startTime: '10:00',
    endTime: '18:00',
    passcode: '998877',
    totalAmount: 45.0,
    currency: 'USD',
  };

  let originalCreateObjectURL: typeof window.URL.createObjectURL;
  let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;
  let createdBlob: Blob | null = null;
  let downloadedFileName: string | null = null;
  let clicked = false;

  beforeEach(() => {
    createdBlob = null;
    downloadedFileName = null;
    clicked = false;

    originalCreateObjectURL = window.URL.createObjectURL;
    originalRevokeObjectURL = window.URL.revokeObjectURL;

    window.URL.createObjectURL = jest.fn((blob: Blob) => {
      createdBlob = blob;
      return 'blob:mock-url';
    });
    window.URL.revokeObjectURL = jest.fn();

    jest.spyOn(document, 'createElement').then?.(() => {}) ||
      jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = document.createElement.bind(document)(tagName);
        if (tagName === 'a') {
          jest.spyOn(el, 'click').mockImplementation(() => {
            clicked = true;
            downloadedFileName = el.getAttribute('download');
          });
        }
        return el;
      });
  });

  afterEach(() => {
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  it('correctly escapes special characters according to RFC 5545', () => {
    const raw = 'Meeting, with Notes; and \\Backslashes\nand newlines';
    const escaped = escapeIcsText(raw);
    expect(escaped).toBe('Meeting\\, with Notes\\; and \\\\Backslashes\\nand newlines');
  });

  it('generates valid RFC 5545 .ics content for confirmed booking', () => {
    const ics = generateIcsCalendar(mockBooking);
    expect(ics).not.toBeNull();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Central Innovation Hub\\, Room A - Dedicated Desk 4');
    expect(ics).toContain('LOCATION:123 Tech Avenue\\, Silicon District');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('DTSTART:');
    expect(ics).toContain('DTEND:');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('handles missing date or booking data safely without generating malformed calendar file', () => {
    const invalidBooking = { ...mockBooking, date: undefined, startDateTime: undefined };
    const ics = generateIcsCalendar(invalidBooking);
    expect(ics).toBeNull();

    const downloaded = downloadBookingIcs(invalidBooking);
    expect(downloaded).toBe(false);
  });

  it('renders the modal and triggers .ics download when clicking "Add to Calendar" button', () => {
    const onClose = jest.fn();
    render(<BookingConfirmationModal isOpen={true} onClose={onClose} booking={mockBooking} />);

    expect(screen.getByText('Reservation Confirmed!')).toBeInTheDocument();
    expect(screen.getByText('Central Innovation Hub, Room A')).toBeInTheDocument();

    const addToCalendarBtn = screen.getByRole('button', { name: /add to calendar/i });
    expect(addToCalendarBtn).toBeInTheDocument();

    fireEvent.click(addToCalendarBtn);

    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(createdBlob).not.toBeNull();
    expect(createdBlob?.type).toBe('text/calendar;charset=utf-8');
    expect(clicked).toBe(true);
    expect(downloadedFileName).toBe('booking-res_12345.ics');
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('does not render when isOpen is false', () => {
    const onClose = jest.fn();
    render(<BookingConfirmationModal isOpen={false} onClose={onClose} booking={mockBooking} />);
    expect(screen.queryByText('Reservation Confirmed!')).not.toBeInTheDocument();
  });
});
