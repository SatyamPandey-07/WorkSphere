import { NextRequest, NextResponse } from 'next/server';
import { computeRollingNoiseMetrics, type DailyNoiseReading } from '@/lib/noiseAnalytics';

export interface VenueNoiseMetricsProvider {
  getVenueReadings(venueId: string, windowDays: number): Promise<DailyNoiseReading[]>;
}

const defaultProvider: VenueNoiseMetricsProvider = {
  async getVenueReadings() {
    return [];
  },
};

export function createVenueNoiseMetricsHandler(
  provider: VenueNoiseMetricsProvider = defaultProvider
) {
  return async function GET(
    req: NextRequest,
    context: { params: Promise<{ venueId: string }> | { venueId: string } }
  ) {
    const resolvedParams = await context.params;
    const venueId = resolvedParams.venueId?.trim();
    const { searchParams } = new URL(req.url);
    const rawWindow = Number(searchParams.get('windowDays') ?? '7');
    const windowDays = Number.isFinite(rawWindow) && rawWindow > 0 ? Math.floor(rawWindow) : 7;

    if (!venueId) {
      return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    const readings = await provider.getVenueReadings(venueId, windowDays);
    const metrics = computeRollingNoiseMetrics(readings, windowDays);

    return NextResponse.json(
      {
        venueId,
        metrics,
      },
      { status: 200 }
    );
  };
}

export const GET = createVenueNoiseMetricsHandler();