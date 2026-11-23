import {
  DEFAULT_MAX_TELEMETRY_AGE_MS,
  evaluateVenueConcierge,
} from '@/lib/ai/autonomousConciergeEngine';
import {
  GET,
  POST,
  setConciergeTelemetryProvider,
} from '@/app/api/ai/concierge/route';

describe('AI Concierge trusted telemetry & override enforcement', () => {
  const nowMs = new Date('2026-11-22T16:40:00.000Z').getTime();

  afterEach(() => {
    setConciergeTelemetryProvider(null);
    delete process.env.ALLOW_AI_CONCIERGE_SIMULATION;
    delete process.env.AI_CONCIERGE_SIMULATION_KEY;
  });

  it('marks telemetry unavailable and withholds recommendations when readings are missing', () => {
    const res = evaluateVenueConcierge({
      venueId: 'venue-1',
      readings: [],
      sessions: [],
      nowMs,
    });

    expect(res.telemetryStatus).toBe('unavailable');
    expect(res.recommendations).toEqual([]);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('rejects stale readings, invalid measurements, and cross-venue data', () => {
    const res = evaluateVenueConcierge({
      venueId: 'venue-1',
      nowMs,
      readings: [
        {
          venueId: 'venue-1',
          zoneId: 'quiet-zone',
          metric: 'co2',
          value: 1450,
          recordedAt: new Date(nowMs - 30_000).toISOString(),
        },
        {
          venueId: 'venue-1',
          zoneId: 'quiet-zone',
          metric: 'co2',
          value: 1900,
          recordedAt: new Date(nowMs - DEFAULT_MAX_TELEMETRY_AGE_MS - 5_000).toISOString(),
        },
        {
          venueId: 'venue-1',
          zoneId: 'quiet-zone',
          metric: 'temperature',
          value: 250,
          recordedAt: new Date(nowMs - 10_000).toISOString(),
        },
        {
          venueId: 'venue-2',
          zoneId: 'quiet-zone',
          metric: 'noiseDb',
          value: 95,
          recordedAt: new Date(nowMs - 10_000).toISOString(),
        },
      ],
      sessions: [
        { venueId: 'venue-1', userId: 'u1', zoneId: 'quiet-zone', active: true },
        { venueId: 'venue-2', userId: 'u2', zoneId: 'quiet-zone', active: true },
      ],
    });

    expect(res.validReadingCount).toBe(1);
    expect(res.rejectedReadingCount).toBe(3);
    expect(res.telemetryStatus).toBe('degraded');
    expect(res.activeMemberCount).toBe(1);
  });

  it('requires venueId and blocks unauthorized client overrides with 403', async () => {
    const missingVenue = await GET(new Request('http://localhost/api/ai/concierge'));
    expect(missingVenue.status).toBe(400);

    const forbiddenPost = await POST(
      new Request('http://localhost/api/ai/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: 'venue-1',
          readings: [
            {
              venueId: 'venue-1',
              metric: 'co2',
              value: 400,
              recordedAt: new Date(nowMs).toISOString(),
            },
          ],
        }),
      })
    );
    expect(forbiddenPost.status).toBe(403);
  });

  it('returns 503 when telemetry provider fails', async () => {
    setConciergeTelemetryProvider({
      loadVenueTelemetry: async () => {
        throw new Error('TELEMETRY_DOWN');
      },
    });

    const res = await GET(
      new Request('http://localhost/api/ai/concierge?venueId=venue-1')
    );
    expect(res.status).toBe(503);
  });
});