import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, mode, distanceKm, co2SavedKg } = body;

    if (!userId || !mode || typeof distanceKm !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Invalid telemetry payload parameters.' },
        { status: 400 }
      );
    }

    // 1. Persist telemetry to database (Simulated database write)
    /*
    await db.sustainabilityTelemetry.create({
      data: { userId, mode, distanceKm, co2SavedKg },
    });
    */

    const recordedTelemetry = {
      id: `telemetry_${Date.now()}`,
      userId,
      mode,
      distanceKm,
      co2SavedKg,
      timestamp: new Date().toISOString(),
    };

    // 2. Check for cumulative milestone badges (Bronze, Silver, Gold, Emerald)
    // Simulated cumulative offset check
    const totalOffsetKg = 125.5; // Example fetched from DB
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