import { NextRequest, NextResponse } from 'next/server';
import {
  expandRecurringDates,
  validateRecurringBookingSlots,
  type DateRangeInput,
  type SeatOccupancyStore,
} from '@/features/seats/recurringBookingService';
import { defaultRecurringSeriesManager } from '@/features/seats/recurringSeriesStore';
import { MAX_RECURRING_OCCURRENCES } from '@/lib/booking/recurrence';

const ALTERNATIVE_SEARCH_DAYS = 365;

interface SuggestedAlternative {
  conflictingDate: string;
  suggestedDate: string;
}

function getAlternativeSearchEndDate(endDate: string): string {
  const maxDate = Date.UTC(9999, 11, 31);
  const endTime = Date.parse(`${endDate}T00:00:00.000Z`);
  const targetTime = Math.min(
    endTime + ALTERNATIVE_SEARCH_DAYS * 24 * 60 * 60 * 1000,
    maxDate,
  );
  return new Date(targetTime).toISOString().slice(0, 10);
}

async function suggestAlternativeDates(
  seatId: string,
  rrulePattern: string,
  dateRange: DateRangeInput,
  requestedDates: string[],
  conflictedDates: Array<{ date: string }>,
  store: SeatOccupancyStore,
): Promise<SuggestedAlternative[]> {
  if (conflictedDates.length === 0 || requestedDates.length === 0) return [];

  const searchEndDate = getAlternativeSearchEndDate(dateRange.endDate);
  const isMonthly = /(?:^|;)\s*FREQ\s*=\s*MONTHLY(?:;|$)/i.test(rrulePattern);
  const anchorDate = isMonthly
    ? dateRange.startDate
    : requestedDates[requestedDates.length - 1];
  const candidates = expandRecurringDates(rrulePattern, {
    startDate: anchorDate,
    endDate: searchEndDate,
  })
    .filter((date) => date > dateRange.endDate)
    .slice(0, MAX_RECURRING_OCCURRENCES);

  if (candidates.length === 0) return [];

  const occupiedDates = await store.getOccupiedDates(seatId, candidates);
  const usedDates = new Set<string>();
  const suggestions: SuggestedAlternative[] = [];

  for (const conflict of conflictedDates) {
    const suggestedDate = candidates.find(
      (date) => !occupiedDates.has(date) && !usedDates.has(date),
    );
    if (!suggestedDate) continue;

    usedDates.add(suggestedDate);
    suggestions.push({
      conflictingDate: conflict.date,
      suggestedDate,
    });
  }

  return suggestions;
}

export function createRecurringAvailabilityHandler(
  store: SeatOccupancyStore = defaultRecurringSeriesManager
) {
  return async function POST(req: NextRequest) {
    try {
      const body = await req.json();
      const dryRun =
        req.nextUrl.searchParams.get('dryRun')?.trim().toLowerCase() === 'true' ||
        body?.dryRun === true;
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

      const suggestedAlternatives = dryRun
        ? await suggestAlternativeDates(
            seatId,
            rrulePattern,
            { startDate, endDate },
            validation.requestedDates,
            validation.conflictedDates,
            store,
          )
        : [];

      return NextResponse.json(
        dryRun
          ? {
              ...validation,
              conflictingDates: validation.conflictedDates.map(
                (conflict) => conflict.date
              ),
              suggestedAlternatives,
            }
          : validation,
        { status: 200 }
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to validate recurring booking slots';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}

export const POST = createRecurringAvailabilityHandler();