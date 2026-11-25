import {
  calculateEcoRoute,
  calculateDirectHaversineFallback,
  areValidCoordinates,
  DEFAULT_WALKING_SPEED_KMH,
} from '@/lib/routing/ecoRoutingEngine';

describe('ecoRoutingEngine', () => {
  const originalFetch = global.fetch;
  const start = { lat: 28.6139, lng: 77.209 }; // New Delhi
  const end = { lat: 28.7041, lng: 77.1025 }; // North Delhi (~14.2 km)

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (console.warn as jest.Mock).mockRestore?.();
  });

  describe('areValidCoordinates', () => {
    test('returns true for valid coordinates', () => {
      expect(areValidCoordinates({ lat: 28.6139, lng: 77.209 })).toBe(true);
      expect(areValidCoordinates({ lat: 0, lng: 0 })).toBe(true);
      expect(areValidCoordinates({ lat: -90, lng: 180 })).toBe(true);
    });

    test('returns false for invalid coordinates', () => {
      expect(areValidCoordinates(null)).toBe(false);
      expect(areValidCoordinates(undefined)).toBe(false);
      expect(areValidCoordinates({ lat: NaN, lng: 77.209 })).toBe(false);
      expect(areValidCoordinates({ lat: 100, lng: 77.209 })).toBe(false);
      expect(areValidCoordinates({ lat: 28.6139, lng: 200 })).toBe(false);
    });
  });

  describe('calculateDirectHaversineFallback', () => {
    test('calculates straight-line distance and walking time correctly', () => {
      const result = calculateDirectHaversineFallback(start, end, 'walking', DEFAULT_WALKING_SPEED_KMH);

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackReason).toBe('ROUTING_SERVICE_UNAVAILABLE');
      expect(result.mode).toBe('walking');
      expect(result.distanceMeters).toBeGreaterThan(13000);
      expect(result.distanceMeters).toBeLessThan(16000);

      // Duration: 14000m / (4.8 km/h / 3.6 = 1.333 m/s) ~ 10500s (~2.9 hours)
      expect(result.durationSeconds).toBeGreaterThan(9000);
      expect(result.durationSeconds).toBeLessThan(12000);
      expect(result.path).toEqual([start, end]);
    });
  });

  describe('calculateEcoRoute with external routing provider scenarios', () => {
    test('returns accurate provider route when API call succeeds (200 OK)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          routes: [
            {
              distance: 14500,
              duration: 10800,
              geometry: {
                coordinates: [
                  [77.209, 28.6139],
                  [77.15, 28.65],
                  [77.1025, 28.7041],
                ],
              },
            },
          ],
        }),
      });

      const result = await calculateEcoRoute(start, end);

      expect(result.isEstimated).toBe(false);
      expect(result.distanceMeters).toBe(14500);
      expect(result.durationSeconds).toBe(10800);
      expect(result.path.length).toBe(3);
      expect(result.path[0]).toEqual({ lat: 28.6139, lng: 77.209 });
    });

    test('returns direct Haversine fallback when API responds with 503 Service Unavailable', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable' }),
      });

      const result = await calculateEcoRoute(start, end);

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackReason).toBe('SERVICE_UNAVAILABLE_503');
      expect(result.distanceMeters).toBeGreaterThan(13000);
      expect(result.durationSeconds).toBeGreaterThan(0);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('503'),
        expect.any(Object)
      );
    });

    test('returns direct Haversine fallback when API responds with 504 Gateway Timeout', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 504,
        json: async () => ({ error: 'Gateway Timeout' }),
      });

      const result = await calculateEcoRoute(start, end);

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackReason).toBe('GATEWAY_TIMEOUT_504');
      expect(result.distanceMeters).toBeGreaterThan(13000);
      expect(result.durationSeconds).toBeGreaterThan(0);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('504'),
        expect.any(Object)
      );
    });

    test('returns direct Haversine fallback when fetch throws network timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted due to timeout');
      abortError.name = 'AbortError';

      global.fetch = jest.fn().mockRejectedValue(abortError);

      const result = await calculateEcoRoute(start, end);

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackReason).toBe('TIMEOUT');
      expect(result.distanceMeters).toBeGreaterThan(13000);
      expect(result.durationSeconds).toBeGreaterThan(0);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('TIMEOUT')
      );
    });

    test('returns direct Haversine fallback when fetch throws general network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await calculateEcoRoute(start, end);

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackReason).toBe('NETWORK_ERROR');
      expect(result.distanceMeters).toBeGreaterThan(13000);
      expect(result.durationSeconds).toBeGreaterThan(0);
    });

    test('returns direct Haversine fallback when external provider returns empty routes array', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          routes: [],
        }),
      });

      const result = await calculateEcoRoute(start, end);

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackReason).toBe('NO_ROUTES_RETURNED');
      expect(result.distanceMeters).toBeGreaterThan(13000);
    });

    test('handles identical start and destination without network call', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      const samePoint = { lat: 28.6139, lng: 77.209 };
      const result = await calculateEcoRoute(samePoint, samePoint);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.isEstimated).toBe(false);
      expect(result.distanceMeters).toBe(0);
      expect(result.durationSeconds).toBe(0);
      expect(result.path).toEqual([samePoint]);
    });

    test('throws error for invalid coordinates without crashing network logic', async () => {
      await expect(
        calculateEcoRoute({ lat: NaN, lng: 0 }, end)
      ).rejects.toThrow('Invalid or missing coordinates');
    });
  });
});
