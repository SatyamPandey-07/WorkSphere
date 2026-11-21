import { NextRequest, NextResponse } from 'next/server';
import { computeRollingNoiseMetrics, type DailyNoiseReading } from '@/lib/noiseAnalytics';

export interface NoiseForecastProvider {
  getReadingsForVenue(venueId: string, windowDays: number): Promise<DailyNoiseReading[]>;
}

const defaultProvider: NoiseForecastProvider = {
  async getReadingsForVenue() {
    return [];
  },
};

export function createNoiseForecastHandler(provider: NoiseForecastProvider = defaultProvider) {
  return async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get('venueId')?.trim();
    const rawWindow = Number(searchParams.get('windowDays') ?? '7');
    const windowDays = Number.isFinite(rawWindow) && rawWindow > 0 ? Math.floor(rawWindow) : 7;

    if (!venueId) {
      return NextResponse.json({ error: 'venueId query parameter is required' }, { status: 400 });
    }

    const readings = await provider.getReadingsForVenue(venueId, windowDays);
    const metrics = computeRollingNoiseMetrics(readings, windowDays);

    return NextResponse.json(
      {
        venueId,
        forecastAverageDb: metrics.windowAverageDb,
        activeSampleAverageDb: metrics.activeSampleAverageDb,
        windowDays: metrics.windowDays,
        activeDays: metrics.activeDays,
        sampleCount: metrics.sampleCount,
        coverageRatio: metrics.coverageRatio,
        operatingHoursWeightedDb: metrics.operatingHoursWeightedDb,
      },
      { status: 200 }
    );
  };
}

export const GET = createNoiseForecastHandler();