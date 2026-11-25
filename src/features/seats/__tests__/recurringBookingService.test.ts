import {
  expandRecurringDates,
  validateRecurringBookingSlots,
  type SeatOccupancyStore,
} from '../recurringBookingService';
import { createRecurringAvailabilityHandler } from '@/app/api/seats/recurring-availability/route';
import { NextRequest } from 'next/server';

describe('recurringBookingService', () => {
  it('expands Mon-Thu across multiple weeks accurately', () => {
    const dates = expandRecurringDates('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH', {
      startDate: '2026-11-02',
      endDate: '2026-11-22',
    });

    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe('2026-11-02');
    expect(dates[dates.length - 1]).toBe('2026-11-19');
  });

  it('partitions available vs conflicted dates and ranks alternative desks', async () => {
    const store: SeatOccupancyStore = {
      async getOccupiedDates() {
        return new Map([
          ['2026-11-05', { reason: 'BOOKED', referenceId: 'bkg-1' }],
          ['2026-11-11', { reason: 'HELD', referenceId: 'hold-9' }],
        ]);
      },
      async listCandidateDesks() {
        return [
          { deskId: 'desk-A1', occupiedDates: new Set() },
          { deskId: 'desk-B2', occupiedDates: new Set(['2026-11-05']) },
        ];
      },
    };

    const result = await validateRecurringBookingSlots(
      'desk-A1',
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
      { startDate: '2026-11-02', endDate: '2026-11-15' },
      store
    );

    expect(result.requestedDates).toHaveLength(8);
    expect(result.conflictedDates).toEqual([
      { date: '2026-11-05', reason: 'BOOKED', referenceId: 'bkg-1' },
      { date: '2026-11-11', reason: 'HELD', referenceId: 'hold-9' },
    ]);
    expect(result.availableDates).toHaveLength(6);
    expect(result.alternativeDesks[0].deskId).toBe('desk-B2');
    expect(result.alternativeDesks[0].availableForAllRequestedDates).toBe(true);
  });

  it('validates payload in POST /api/seats/recurring-availability', async () => {
    const POST = createRecurringAvailabilityHandler({
      async getOccupiedDates() {
        return new Map();
      },
      async listCandidateDesks() {
        return [];
      },
    });

    const req = new NextRequest('http://localhost:3000/api/seats/recurring-availability', {
      method: 'POST',
      body: JSON.stringify({
        seatId: 'desk-10',
        rrulePattern: 'FREQ=WEEKLY;BYDAY=MO,WE',
        dateRange: { startDate: '2026-11-02', endDate: '2026-11-08' },
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.requestedDates).toEqual(['2026-11-02', '2026-11-04']);
  });
});