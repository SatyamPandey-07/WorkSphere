import { renderHook, act } from "@testing-library/react";
import { useArrivalDetection } from "@/hooks/useArrivalDetection";
import { Vector3 } from "@/types/ar";

describe("useArrivalDetection", () => {
  let watchPositionSuccessCallback: any = null;
  let watchPositionErrorCallback: any = null;
  const mockWatchId = 999;

  let mockDevice: any;
  let advertisementCallback: any = null;

  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      }),
    ) as any;

    watchPositionSuccessCallback = null;
    watchPositionErrorCallback = null;
    advertisementCallback = null;

    const mockGeolocation = {
      watchPosition: jest.fn().mockImplementation((success, error) => {
        watchPositionSuccessCallback = success;
        watchPositionErrorCallback = error;
        return mockWatchId;
      }),
      clearWatch: jest.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
      writable: true,
    });

    mockDevice = {
      addEventListener: jest.fn().mockImplementation((event, callback) => {
        if (event === "advertisementreceived") {
          advertisementCallback = callback;
        }
      }),
      removeEventListener: jest.fn(),
      watchAdvertisements: jest.fn().mockResolvedValue(undefined),
    };

    const mockBluetooth = {
      requestDevice: jest.fn().mockResolvedValue(mockDevice),
    };
    Object.defineProperty(global.navigator, "bluetooth", {
      value: mockBluetooth,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("Vector Mode (Legacy)", () => {
    it("returns false initially when threshold not met", () => {
      const current: Vector3 = { x: 0, y: 0, z: 0 };
      const target: Vector3 = { x: 10, y: 0, z: 0 };
      const { result } = renderHook(() =>
        useArrivalDetection(current, target, 2.0),
      );
      expect(result.current).toBe(false);
    });

    it("returns true when within threshold", () => {
      const current: Vector3 = { x: 1.5, y: 0, z: 0 };
      const target: Vector3 = { x: 2.0, y: 0, z: 0 };
      const { result } = renderHook(() =>
        useArrivalDetection(current, target, 1.0),
      );
      expect(result.current).toBe(true);
    });
  });

  describe("Geofencing & Bluetooth Mode", () => {
    const venueOptions = {
      venueId: "venue_123",
      latitude: 40.7128,
      longitude: -74.006,
      geofenceRadius: 50,
      beacon: {
        uuid: "12345678-1234-1234-1234-123456789abc",
        name: "WorkSphere_Beacon",
        minRssi: -85,
      },
    };

    it("returns initial states correctly", () => {
      const { result } = renderHook(() => useArrivalDetection(venueOptions));
      expect(result.current.arrived).toBe(false);
      expect(result.current.inGeofence).toBe(false);
      expect(result.current.beaconDetected).toBe(false);
      expect(result.current.checkedIn).toBe(false);
      expect(result.current.distanceToVenue).toBeNull();
    });

    it("detects entering and leaving geofence via Geolocation Watch API", () => {
      const onArrivedSpy = jest.fn();
      const { result } = renderHook(() =>
        useArrivalDetection({ ...venueOptions, onArrived: onArrivedSpy }),
      );

      // Simulate being 100 meters away
      act(() => {
        watchPositionSuccessCallback({
          coords: {
            latitude: 40.7137,
            longitude: -74.006,
            accuracy: 5,
          },
        });
      });

      expect(result.current.inGeofence).toBe(false);
      expect(result.current.arrived).toBe(false);

      // Simulate entering geofence (approx 5.5 meters away)
      act(() => {
        watchPositionSuccessCallback({
          coords: {
            latitude: 40.71285,
            longitude: -74.006,
            accuracy: 5,
          },
        });
      });

      expect(result.current.inGeofence).toBe(true);
      expect(result.current.arrived).toBe(true);
      expect(onArrivedSpy).toHaveBeenCalledTimes(1);

      // Simulate leaving geofence
      act(() => {
        watchPositionSuccessCallback({
          coords: {
            latitude: 40.715,
            longitude: -74.006,
            accuracy: 5,
          },
        });
      });

      expect(result.current.inGeofence).toBe(false);
      expect(result.current.arrived).toBe(false);
    });

    it("scans and validates BLE beacon signal strength (RSSI)", async () => {
      const { result } = renderHook(() => useArrivalDetection(venueOptions));

      let scanPromise: any;
      act(() => {
        scanPromise = result.current.scanBluetooth();
      });

      await act(async () => {
        await scanPromise;
      });

      expect((navigator as any).bluetooth.requestDevice).toHaveBeenCalled();
      expect(mockDevice.watchAdvertisements).toHaveBeenCalled();

      // Weak RSSI (-95)
      act(() => {
        advertisementCallback({ rssi: -95 });
      });

      expect(result.current.rssi).toBe(-95);
      expect(result.current.beaconDetected).toBe(false);
      expect(result.current.arrived).toBe(false);

      // Strong RSSI (-70)
      act(() => {
        advertisementCallback({ rssi: -70 });
      });

      expect(result.current.rssi).toBe(-70);
      expect(result.current.beaconDetected).toBe(true);
      expect(result.current.arrived).toBe(true);
    });

    it("performs one-tap manual check-in confirmation", async () => {
      const onCheckedInSpy = jest.fn();
      const { result } = renderHook(() =>
        useArrivalDetection({ ...venueOptions, onCheckedIn: onCheckedInSpy }),
      );

      let checkInPromise: any;
      act(() => {
        checkInPromise = result.current.confirmCheckIn();
      });

      expect(result.current.isCheckingIn).toBe(true);

      await act(async () => {
        await checkInPromise;
      });

      expect(result.current.isCheckingIn).toBe(false);
      expect(result.current.checkedIn).toBe(true);
      expect(onCheckedInSpy).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/bookings/venue_123/check-in",
        expect.any(Object),
      );
    });

    it("handles geolocation error gracefully", () => {
      const { result } = renderHook(() => useArrivalDetection(venueOptions));

      act(() => {
        watchPositionErrorCallback({
          message: "User denied location authorization",
        });
      });

      expect(result.current.error).toBe(
        "Geolocation error: User denied location authorization",
      );
    });

    it("incorporates altitude delta for high-altitude geofence calculations", () => {
      const highAltitudeOptions = {
        ...venueOptions,
        altitude: 1500,
      };

      const { result } = renderHook(() =>
        useArrivalDetection(highAltitudeOptions),
      );

      act(() => {
        watchPositionSuccessCallback({
          coords: {
            latitude: 40.7128,
            longitude: -74.006,
            altitude: 1550,
            accuracy: 5,
          },
        });
      });

      expect(result.current.distanceToVenue).toBeCloseTo(50);
      expect(result.current.inGeofence).toBe(true);

      act(() => {
        watchPositionSuccessCallback({
          coords: {
            latitude: 40.7128,
            longitude: -74.006,
            altitude: 1560,
            accuracy: 5,
          },
        });
      });

      expect(result.current.distanceToVenue).toBeCloseTo(60);
      expect(result.current.inGeofence).toBe(false);
    });

    it("falls back to 2D distance calculation when user altitude is not available", () => {
      const highAltitudeOptions = {
        ...venueOptions,
        altitude: 1500,
      };

      const { result } = renderHook(() =>
        useArrivalDetection(highAltitudeOptions),
      );

      act(() => {
        watchPositionSuccessCallback({
          coords: {
            latitude: 40.7128,
            longitude: -74.006,
            altitude: null,
            accuracy: 5,
          },
        });
      });

      expect(result.current.distanceToVenue).toBeCloseTo(0);
      expect(result.current.inGeofence).toBe(true);
    });
  });
});
