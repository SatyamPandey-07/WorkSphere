import { NextRequest, NextResponse } from 'next/server';
import {
  validateRecurringBookingSlots,
  type SeatOccupancyStore,
} from '@/features/seats/recurringBookingService';

const defaultStore: SeatOccupancyStore = {
  async getOccupiedDates() {
    return new Map();
  },
  async listCandidateDesks() {
    return [];
  },
};

export function createRecurringAvailabilityHandler(store: SeatOccupancyStore = defaultStore) {
  return async function POST(req: NextRequest) {
    try {
      const body = await req.json();
      const seatId = typeof body?.seatId === 'string' ? body.seatId.trim() : '';
      const rrulePattern =
        typeof body?.rrulePattern === 'string' ? body.rrulePattern.trim() : '';
      const startDate =
        typeof body?.dateRange?.startDate === 'string' ? body.dateRange.startDate.trim() : '';
      const endDate =
        typeof body?.dateRange?.endDate === 'string' ? body.dateRange.endDate.trim() : '';

      if (!seatId || !rrulePattern || !startDate || !endDate) {
        return NextResponse.json(
          {
            error:
              'seatId, rrulePattern, and dateRange (startDate, endDate) are required',
          },
          { status: 400 }
        );
      }

      const validation = await validateRecurringBookingSlots(
        seatId,
        rrulePattern,
        { startDate, endDate },
        store
      );

      return NextResponse.json(validation, { status: 200 });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to validate recurring booking slots';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}

export const POST = createRecurringAvailabilityHandler();