import { NextRequest } from 'next/server';
import {
  computeEnhancedNoiseAnalytics,
  computePercentile,
} from './noiseAnalytics';
import { createVenueNoiseMetricsHandler } from '@/app/api/venues/[venueId]/noise-metrics/route';

describe('Noise percentile & quiet-hour analytics', () => {
  it('handles empty and single-reading inputs safely without NaN', () => {
    expect(computePercentile([], 50)).toBe(0);
    expect(computePercentile([], 90)).toBe(0);
    expect(computePercentile([44], 50)).toBe(44);
    expect(computePercentile([44], 90)).toBe(44);

    const emptyAnalytics = computeEnhancedNoiseAnalytics([], 7);
    expect(Number.isNaN(emptyAnalytics.p50Db)).toBe(false);
    expect(Number.isNaN(emptyAnalytics.p90Db)).toBe(false);
    expect(emptyAnalytics.quietHours.isQuietWindowAvailable).toBe(false);
  });

  it('computes p50, p90, and quiet-hour availability across skewed morning vs rush readings', async () => {
    const readings = [
      { date: '2026-11-20', decibels: 41, hour: 9 },
      { date: '2026-11-20', decibels: 43, hour: 10 },
      { date: '2026-11-20', decibels: 54, hour: 14 },
      { date: '2026-11-20', decibels: 72, hour: 18 },
      { date: '2026-11-20', decibels: 76, hour: 19 },
    ];

    const analytics = computeEnhancedNoiseAnalytics(readings, 7);
    expect(analytics.p50Db).toBe(54);
    expect(analytics.p90Db).toBe(74.4);
    expect(analytics.quietHours.averageDb).toBe(42);
    expect(analytics.quietHours.isQuietWindowAvailable).toBe(true);
    expect(analytics.timeOfDayBuckets.EVENING.averageDb).toBe(74);

    const handler = createVenueNoiseMetricsHandler({
      getVenueReadings: async () => readings,
    });

    const req = new NextRequest('http://localhost:3000/api/venues/cafe-1/noise-metrics');
    const res = await handler(req, { params: { venueId: 'cafe-1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.metrics.sampleCount).toBe(5);
    expect(body.p50Db).toBe(54);
    expect(body.p90Db).toBe(74.4);
    expect(body.quietHours.isQuietWindowAvailable).toBe(true);
  });
});