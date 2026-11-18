import { renderHook, act } from "@testing-library/react";
import {
  useThrottledGeolocation,
  calculateHaversineDistanceMeters,
  evaluatePositionThrottle,
  DEFAULT_DISTANCE_THRESHOLD_METERS,
  DEFAULT_VELOCITY_THRESHOLD_MPS,
} from "@/hooks/useThrottledGeolocation";

function createMockPosition(
  lat: number,
  lng: number,
  speed: number | null = 0,
  timestamp: number = Date.now()
): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed,
    },
    timestamp,
  } as GeolocationPosition;
}

describe("useThrottledGeolocation and Battery Conserving Filter", () => {
  describe("calculateHaversineDistanceMeters", () => {
    it("returns 0 for identical coordinates", () => {
      expect(calculateHaversineDistanceMeters(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
    });

    it("calculates short distances in meters accurately", () => {
      // 0.0001 deg latitude delta is approximately 11.1 meters
      const distance = calculateHaversineDistanceMeters(37.7749, -122.4194, 37.775, -122.4194);
      expect(distance).toBeGreaterThan(10);
      expect(distance).toBeLessThan(12);
    });

    it("handles invalid or non-finite inputs safely", () => {
      expect(calculateHaversineDistanceMeters(NaN, 0, 10, 10)).toBe(0);
      expect(calculateHaversineDistanceMeters(0, Infinity, 10, 10)).toBe(0);
    });
  });

  describe("evaluatePositionThrottle", () => {
    it("never throttles the initial position reading", () => {
      const pos1 = createMockPosition(37.7749, -122.4194, 0);
      const evalResult = evaluatePositionThrottle(null, pos1);

      expect(evalResult.shouldThrottle).toBe(false);
      expect(evalResult.displacementMeters).toBe(0);
    });

    it("throttles updates when displacement < 15m and velocity is near zero (stationary desk)", () => {
      const pos1 = createMockPosition(37.7749, -122.4194, 0, 1000);
      // Small displacement ~5 meters
      const pos2 = createMockPosition(37.77494, -122.4194, 0.2, 2000);

      const evalResult = evaluatePositionThrottle(pos1, pos2, {
        distanceThresholdMeters: 15,
        velocityThresholdMetersPerSec: 1.5,
        stationaryVelocityThreshold: 0.5,
        throttleIntervalMs: 30000,
        lastEmittedTime: 1000,
      });

      expect(evalResult.displacementMeters).toBeLessThan(15);
      expect(evalResult.velocity).toBeLessThanOrEqual(0.5);
      expect(evalResult.shouldThrottle).toBe(true);
      expect(evalResult.isHighPrecision).toBe(false);
    });

    it("automatically restores high-precision tracking when velocity exceeds 1.5 m/s", () => {
      const pos1 = createMockPosition(37.7749, -122.4194, 0, 1000);
      // User walks or drives away (speed = 2.0 m/s > 1.5 m/s threshold)
      const pos2 = createMockPosition(37.77495, -122.4194, 2.0, 2000);

      const evalResult = evaluatePositionThrottle(pos1, pos2, {
        velocityThresholdMetersPerSec: 1.5,
      });

      expect(evalResult.shouldThrottle).toBe(false);
      expect(evalResult.isHighPrecision).toBe(true);
      expect(evalResult.velocity).toBeGreaterThanOrEqual(1.5);
    });

    it("does not throttle when displacement exceeds 15 meters", () => {
      const pos1 = createMockPosition(37.7749, -122.4194, 0, 1000);
      // Displacement of ~30 meters
      const pos2 = createMockPosition(37.7752, -122.4194, 0, 2000);

      const evalResult = evaluatePositionThrottle(pos1, pos2, {
        distanceThresholdMeters: 15,
      });

      expect(evalResult.displacementMeters).toBeGreaterThanOrEqual(15);
      expect(evalResult.shouldThrottle).toBe(false);
    });
  });

  describe("useThrottledGeolocation Hook", () => {
    let watchSuccessCallback: ((pos: GeolocationPosition) => void) | null = null;
    let watchErrorCallback: ((err: GeolocationPositionError) => void) | null = null;
    let clearWatchMock: jest.Mock;

    beforeEach(() => {
      watchSuccessCallback = null;
      watchErrorCallback = null;
      clearWatchMock = jest.fn();

      Object.defineProperty(navigator, "geolocation", {
        value: {
          watchPosition: jest.fn((success, error) => {
            watchSuccessCallback = success;
            watchErrorCallback = error;
            return 999;
          }),
          clearWatch: clearWatchMock,
        },
        writable: true,
        configurable: true,
      });
    });

    it("registers watchPosition and clears watch on unmount", () => {
      const { unmount } = renderHook(() => useThrottledGeolocation());

      expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
      unmount();
      expect(clearWatchMock).toHaveBeenCalledWith(999);
    });

    it("emits initial position and throttles stationary jitter", () => {
      const { result } = renderHook(() =>
        useThrottledGeolocation({
          distanceThresholdMeters: 15,
          velocityThresholdMetersPerSec: 1.5,
        })
      );

      const pos1 = createMockPosition(37.7749, -122.4194, 0, 1000);

      act(() => {
        watchSuccessCallback?.(pos1);
      });

      expect(result.current.position).toEqual(pos1);
      expect(result.current.isThrottled).toBe(false);
      expect(result.current.emittedUpdatesCount).toBe(1);

      // Stationary update (< 15m, 0.1 m/s)
      const pos2 = createMockPosition(37.77492, -122.4194, 0.1, 2000);
      act(() => {
        watchSuccessCallback?.(pos2);
      });

      expect(result.current.isThrottled).toBe(true);
      expect(result.current.droppedUpdatesCount).toBe(1);
      expect(result.current.emittedUpdatesCount).toBe(1);

      // Fast movement update (> 1.5 m/s)
      const pos3 = createMockPosition(37.7755, -122.4194, 2.5, 3000);
      act(() => {
        watchSuccessCallback?.(pos3);
      });

      expect(result.current.isThrottled).toBe(false);
      expect(result.current.isHighPrecision).toBe(true);
      expect(result.current.emittedUpdatesCount).toBe(2);
    });
  });
});
