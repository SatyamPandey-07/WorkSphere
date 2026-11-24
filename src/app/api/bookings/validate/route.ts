import { NextRequest, NextResponse } from 'next/server';
import {
  calculatePassExpiration,
  isValidIanaTimezone,
} from '@/lib/bookings/dateUtils';

export interface ValidateBookingPayload {
  startDate: string;
  durationDays?: number;
  venueTimezone?: string;
  now?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<ValidateBookingPayload>;

    if (!body.startDate) {
      return NextResponse.json(
        { error: 'startDate is required' },
        { status: 400 }
      );
    }

    const venueTimezone = body.venueTimezone ?? 'UTC';
    if (!isValidIanaTimezone(venueTimezone)) {
      return NextResponse.json(
        { error: `Invalid venueTimezone: ${venueTimezone}` },
        { status: 400 }
      );
    }

    const durationDays = body.durationDays ?? 1;
    const expiresAt = calculatePassExpiration(
      body.startDate,
      durationDays,
      venueTimezone
    );

    const referenceNow = body.now ? new Date(body.now) : new Date();
    if (Number.isNaN(referenceNow.getTime())) {
      return NextResponse.json(
        { error: 'Invalid now timestamp' },
        { status: 400 }
      );
    }

    const isValid = referenceNow.getTime() <= expiresAt.getTime();

    return NextResponse.json({
      isValid,
      venueTimezone,
      durationDays: Math.max(1, Math.floor(durationDays)),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to validate booking pass';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
