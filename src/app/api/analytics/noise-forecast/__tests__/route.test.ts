import { NextRequest } from 'next/server';
import { createNoiseForecastHandler } from '../route';
import { createVenueNoiseMetricsHandler } from '@/app/api/venues/[venueId]/noise-metrics/route';

describe('Rolling noise window normalization (#9165)', () => {
  it('normalizes 7-day forecast over full window rather than only active days', async () => {
    const handler = createNoiseForecastHandler({
      getReadingsForVenue: async () => [
        { date: '2026-11-15', decibels: 42, operatingHours: 4 },
        { date: '2026-11-18', decibels: 48, operatingHours: 8 },
      ],
    });

    const req = new NextRequest('http://localhost:3000/api/analytics/noise-forecast?venueId=v-1');
    const res = await handler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.windowDays).toBe(7);
    expect(body.activeDays).toBe(2);
    expect(body.sampleCount).toBe(2);
    expect(body.forecastAverageDb).toBe(12.86);
    expect(body.activeSampleAverageDb).toBe(45);
    expect(body.operatingHoursWeightedDb).toBe(46);
  });

  it('returns structured rolling metrics for venue noise-metrics route', async () => {
    const handler = createVenueNoiseMetricsHandler({
      getVenueReadings: async () => [{ date: '2026-11-20', decibels: 35 }],
    });

    const req = new NextRequest('http://localhost:3000/api/venues/quiet-cafe/noise-metrics');
    const res = await handler(req, { params: { venueId: 'quiet-cafe' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.venueId).toBe('quiet-cafe');
    expect(body.metrics.windowDays).toBe(7);
    expect(body.metrics.activeDays).toBe(1);
    expect(body.metrics.windowAverageDb).toBe(5);
    expect(body.metrics.activeSampleAverageDb).toBe(35);
  });
});