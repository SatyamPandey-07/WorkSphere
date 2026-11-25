import { POST } from '@/app/api/routing/multimodal/route';
import { NextRequest } from 'next/server';

describe('POST /api/routing/multimodal', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (console.warn as jest.Mock).mockRestore?.();
  });

  test('returns 400 when coordinates are missing', async () => {
    const req = new NextRequest('http://localhost/api/routing/multimodal', {
      method: 'POST',
      body: JSON.stringify({ startLat: 28.6139 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing coordinates');
  });

  test('returns 200 with fallback route and isEstimated: true when external routing returns 503', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'Service Unavailable' }),
    });

    const req = new NextRequest('http://localhost/api/routing/multimodal', {
      method: 'POST',
      body: JSON.stringify({
        startLat: 28.6139,
        startLng: 77.209,
        endLat: 28.7041,
        endLng: 77.1025,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.isEstimated).toBe(true);
    expect(data.route.isEstimated).toBe(true);
    expect(data.route.fallbackReason).toBe('SERVICE_UNAVAILABLE_503');
    expect(data.route.totalDurationSeconds).toBeGreaterThan(0);
  });

  test('returns 200 with fallback route and isEstimated: true when external routing times out', async () => {
    const abortErr = new Error('Request timed out');
    abortErr.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortErr);

    const req = new NextRequest('http://localhost/api/routing/multimodal', {
      method: 'POST',
      body: JSON.stringify({
        startLat: 28.6139,
        startLng: 77.209,
        endLat: 28.7041,
        endLng: 77.1025,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.isEstimated).toBe(true);
    expect(data.route.fallbackReason).toBe('TIMEOUT');
  });
});
