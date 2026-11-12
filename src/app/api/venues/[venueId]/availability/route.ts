import { NextRequest, NextResponse } from 'next/server';
import { getOrSetVenueAvailability } from '@/lib/cache/venueAvailabilityCache';

export async function GET(
  request: NextRequest,
  { params }: { params: { venueId: string } }
) {
  const venueId = params.venueId;
  const startTime = performance.now();

  try {
    // Simulate expensive database availability query protected by XFetch & single-flight
    const availabilityData = await getOrSetVenueAvailability(
      `venue_availability:${venueId}`,
      async () => {
        // Simulated latency for heavy PostgreSQL query joining bookings and geofences
        await new Promise((resolve) => setTimeout(resolve, 80));

        return {
          venueId,
          totalDesks: 120,
          availableDesks: 42,
          quietPodsOpen: 8,
          timestamp: new Date().toISOString(),
        };
      },
      60 // 60 seconds TTL
    );

    const duration = performance.now() - startTime;

    const response = NextResponse.json(
      {
        success: true,
        data: availabilityData,
      },
      { status: 200 }
    );

    response.headers.set('X-Response-Time', `${duration.toFixed(2)}ms`);
    response.headers.set('X-Cache', duration < 20 ? 'HIT' : 'MISS/REVALIDATED');
    return response;
  } catch (error) {
    console.error('Error fetching venue availability:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}