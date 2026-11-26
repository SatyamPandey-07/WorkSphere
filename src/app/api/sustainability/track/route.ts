import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  defaultScope2Ledger,
  type PowerSample,
} from '@/lib/sustainability/scope2Ledger';

const userCumulativeOffsets = new Map<string, number>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, mode, distanceKm, co2SavedKg, venueId, region, powerSamples } = body;

    if (venueId && region && Array.isArray(powerSamples)) {
      const ledgerEntry = defaultScope2Ledger.recordCalculation(
        String(venueId),
        String(region),
        powerSamples as PowerSample[],
      );
      return NextResponse.json(
        {
          success: true,
          message: 'Scope 2 electricity ledger entry recorded.',
          ledgerEntry,
        },
        { status: 201 },
      );
    }

    if (!userId || !mode || typeof distanceKm !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Invalid telemetry payload parameters.' },
        { status: 400 }
      );
    }

    const safeSavedKg =
      typeof co2SavedKg === 'number' && Number.isFinite(co2SavedKg) && co2SavedKg >= 0
        ? co2SavedKg
        : 0;

    const recordedTelemetry = {
      id: `telemetry_${Date.now()}`,
      userId,
      mode,
      distanceKm,
      co2SavedKg: safeSavedKg,
      timestamp: new Date().toISOString(),
    };

    const previousOffset = userCumulativeOffsets.get(userId) ?? 0;
    const totalOffsetKg = Number((previousOffset + safeSavedKg).toFixed(4));
    userCumulativeOffsets.set(userId, totalOffsetKg);

    let unlockedBadge = null;
    if (totalOffsetKg >= 250) unlockedBadge = 'Emerald Eco-Nomad';
    else if (totalOffsetKg >= 100) unlockedBadge = 'Gold Eco-Nomad';
    else if (totalOffsetKg >= 50) unlockedBadge = 'Silver Eco-Nomad';
    else if (totalOffsetKg >= 10) unlockedBadge = 'Bronze Eco-Nomad';

    return NextResponse.json(
      {
        success: true,
        message: 'Sustainability telemetry tracked successfully.',
        data: recordedTelemetry,
        badgeStatus: {
          totalOffsetKg,
          unlockedBadge,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error tracking sustainability telemetry:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}