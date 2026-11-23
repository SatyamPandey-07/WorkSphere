import { calculatePassExpiration } from '@/lib/bookings/dateUtils';

describe('calculatePassExpiration timezone handling', () => {
  it('anchors a 3-day Bangkok (UTC+7) pass to Bangkok 23:59:59.999 regardless of client UTC-5 booking time', () => {
    const bookingInstant = '2026-06-11T02:00:00.000Z';
    const expiresAt = calculatePassExpiration(bookingInstant, 3, 'Asia/Bangkok');

    expect(expiresAt.toISOString()).toBe('2026-06-13T16:59:59.999Z');
  });

  it('anchors a multi-day New York (UTC-5) pass to America/New_York 23:59:59.999', () => {
    const bookingInstant = '2026-01-15T14:00:00.000Z';
    const expiresAt = calculatePassExpiration(bookingInstant, 2, 'America/New_York');

    expect(expiresAt.toISOString()).toBe('2026-01-17T04:59:59.999Z');
  });

  it('handles spring-forward DST transition day accurately', () => {
    const bookingInstant = '2026-03-08T15:00:00.000Z';
    const expiresAt = calculatePassExpiration(bookingInstant, 1, 'America/New_York');

    expect(expiresAt.toISOString()).toBe('2026-03-09T03:59:59.999Z');
  });

  it('handles fall-back DST transition day accurately', () => {
    const bookingInstant = '2026-11-01T15:00:00.000Z';
    const expiresAt = calculatePassExpiration(bookingInstant, 1, 'America/New_York');

    expect(expiresAt.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });
});
