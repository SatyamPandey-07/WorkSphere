import { calculatePassExpiration, getNextMonday } from '@/lib/bookings/dateUtils';
import { formatLocalDate } from '@/lib/validations/dateFilter';

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

describe('getNextMonday (#9885)', () => {
  it('Sunday (0) -> immediately following Monday (+1 day)', () => {
    // 2026-11-22 is Sunday
    const sun = new Date(2026, 10, 22);
    expect(sun.getDay()).toBe(0);

    const nextMon = getNextMonday(sun);
    expect(nextMon.getDay()).toBe(1);
    expect(formatLocalDate(nextMon)).toBe('2026-11-23');
  });

  it('Monday (1) -> following week Monday (+7 days, not today)', () => {
    // 2026-11-23 is Monday
    const mon = new Date(2026, 10, 23);
    expect(mon.getDay()).toBe(1);

    const nextMon = getNextMonday(mon);
    expect(nextMon.getDay()).toBe(1);
    expect(formatLocalDate(nextMon)).toBe('2026-11-30');
  });

  it('Tuesday (2) -> upcoming Monday (+6 days)', () => {
    // 2026-11-24 is Tuesday
    const tue = new Date(2026, 10, 24);
    expect(tue.getDay()).toBe(2);

    const nextMon = getNextMonday(tue);
    expect(nextMon.getDay()).toBe(1);
    expect(formatLocalDate(nextMon)).toBe('2026-11-30');
  });

  it('Wednesday (3) -> upcoming Monday (+5 days)', () => {
    // 2026-11-25 is Wednesday
    const wed = new Date(2026, 10, 25);
    expect(wed.getDay()).toBe(3);

    const nextMon = getNextMonday(wed);
    expect(nextMon.getDay()).toBe(1);
    expect(formatLocalDate(nextMon)).toBe('2026-11-30');
  });

  it('Thursday (4) -> upcoming Monday (+4 days)', () => {
    // 2026-11-26 is Thursday
    const thu = new Date(2026, 10, 26);
    expect(thu.getDay()).toBe(4);

    const nextMon = getNextMonday(thu);
    expect(nextMon.getDay()).toBe(1);
    expect(formatLocalDate(nextMon)).toBe('2026-11-30');
  });

  it('Friday (5) -> upcoming Monday (+3 days)', () => {
    // 2026-11-27 is Friday
    const fri = new Date(2026, 10, 27);
    expect(fri.getDay()).toBe(5);

    const nextMon = getNextMonday(fri);
    expect(nextMon.getDay()).toBe(1);
    expect(formatLocalDate(nextMon)).toBe('2026-11-30');
  });

  it('Saturday (6) -> upcoming Monday (+2 days)', () => {
    // 2026-11-28 is Saturday
    const sat = new Date(2026, 10, 28);
    expect(sat.getDay()).toBe(6);

    const nextMon = getNextMonday(sat);
    expect(nextMon.getDay()).toBe(1);
    expect(formatLocalDate(nextMon)).toBe('2026-11-30');
  });

  it('correctly handles month boundary transitions', () => {
    // 2026-05-30 is Saturday -> Next Monday is 2026-06-01
    const sat = new Date(2026, 4, 30);
    expect(sat.getDay()).toBe(6);

    const nextMon = getNextMonday(sat);
    expect(formatLocalDate(nextMon)).toBe('2026-06-01');

    // 2026-05-31 is Sunday -> Next Monday is 2026-06-01
    const sun = new Date(2026, 4, 31);
    expect(sun.getDay()).toBe(0);

    const nextMonFromSun = getNextMonday(sun);
    expect(formatLocalDate(nextMonFromSun)).toBe('2026-06-01');
  });

  it('correctly handles year boundary transitions (December to January)', () => {
    // 2026-12-30 is Wednesday -> Next Monday is 2027-01-04
    const wed = new Date(2026, 11, 30);
    expect(wed.getDay()).toBe(3);

    const nextMon = getNextMonday(wed);
    expect(formatLocalDate(nextMon)).toBe('2027-01-04');

    // 2026-12-28 is Monday -> Next Monday is 2027-01-04
    const mon = new Date(2026, 11, 28);
    expect(mon.getDay()).toBe(1);

    const nextMonFromMon = getNextMonday(mon);
    expect(formatLocalDate(nextMonFromMon)).toBe('2027-01-04');
  });

  it('correctly handles leap-year February boundaries', () => {
    // 2028 is a leap year. Feb 26, 2028 is Saturday. Next Monday is Feb 28, 2028.
    const satLeap = new Date(2028, 1, 26);
    expect(satLeap.getDay()).toBe(6);
    expect(formatLocalDate(getNextMonday(satLeap))).toBe('2028-02-28');

    // Feb 28, 2028 is Monday. Next Monday is March 6, 2028.
    const monLeap = new Date(2028, 1, 28);
    expect(monLeap.getDay()).toBe(1);
    expect(formatLocalDate(getNextMonday(monLeap))).toBe('2028-03-06');
  });

  it('does not mutate input Date object', () => {
    const original = new Date(2026, 10, 24, 10, 30, 0);
    const originalTime = original.getTime();

    getNextMonday(original);

    expect(original.getTime()).toBe(originalTime);
  });
});
