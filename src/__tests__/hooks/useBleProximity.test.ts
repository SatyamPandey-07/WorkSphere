import { renderHook, act } from "@testing-library/react";
import {
  useBleProximity,
  estimateRssiDistance,
  computeEmaRssi,
  isBluetoothApiSupported,
  DEFAULT_REFERENCE_RSSI,
  DEFAULT_PATH_LOSS_EXPONENT,
  DEFAULT_SMOOTHING_FACTOR,
} from "@/hooks/useBleProximity";

describe("useBleProximity Hook & RSSI Distance Estimation (#9611)", () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  describe("1. Math & Estimation Functions", () => {
    it("estimates distance accurately from RSSI using log-distance path loss", () => {
      // At RSSI = referenceRssi (-59), distance should be exactly 1.0 meter
      const at1Meter = estimateRssiDistance(-59, -59, 2.5);
      expect(at1Meter).toBe(1);

      // At RSSI = -65, reference = -59, n = 2.0 -> 10 ^ (( -59 - (-65) ) / 20 ) = 10 ^ 0.3 = ~1.995m -> 2.0m
      const dist2m = estimateRssiDistance(-65, -59, 2.0);
      expect(dist2m).toBe(2);

      // Distance increases as RSSI gets weaker (more negative)
      const distWeak = estimateRssiDistance(-85, -59, 2.5);
      expect(distWeak).toBeGreaterThan(5);
    });

    it("rejects invalid or unphysical RSSI and calibration parameters safely", () => {
      expect(estimateRssiDistance(null)).toBeNull();
      expect(estimateRssiDistance(undefined)).toBeNull();
      expect(estimateRssiDistance(NaN)).toBeNull();
      expect(estimateRssiDistance(Infinity)).toBeNull();
      expect(estimateRssiDistance(-59, -59, 0)).toBeNull(); // n cannot be <= 0
      expect(estimateRssiDistance(-59, -59, -1)).toBeNull();
      expect(estimateRssiDistance(-200)).toBeNull(); // Out of reasonable BLE range (< -120)
      expect(estimateRssiDistance(50)).toBeNull(); // Out of reasonable BLE range (> +20)
    });

    it("computes Exponential Moving Average (EMA) smoothing correctly", () => {
      // First sample initializes EMA directly
      const firstSample = computeEmaRssi(-60, null, 0.25);
      expect(firstSample).toBe(-60);

      // Next sample smooths: 0.25 * (-70) + 0.75 * (-60) = -17.5 - 45 = -62.5
      const secondSample = computeEmaRssi(-70, firstSample, 0.25);
      expect(secondSample).toBe(-62.5);

      // Out of bounds sample is rejected and retains previous EMA
      const invalidSample = computeEmaRssi(-500, secondSample, 0.25);
      expect(invalidSample).toBe(-62.5);
    });
  });

  describe("2. Browser Capability Detection", () => {
    it("returns unsupported when navigator.bluetooth is missing", () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        writable: true,
        configurable: true,
      });

      expect(isBluetoothApiSupported()).toBe(false);

      const { result } = renderHook(() => useBleProximity());
      expect(result.current.isSupported).toBe(false);
      expect(result.current.status).toBe("unsupported");
    });

    it("returns supported when navigator.bluetooth.requestDevice is present", () => {
      Object.defineProperty(global, "navigator", {
        value: {
          bluetooth: {
            requestDevice: jest.fn(),
          },
        },
        writable: true,
        configurable: true,
      });

      expect(isBluetoothApiSupported()).toBe(true);

      const { result } = renderHook(() => useBleProximity());
      expect(result.current.isSupported).toBe(true);
      expect(result.current.status).toBe("idle");
    });
  });

  describe("3. BLE Scanning & Proximity Lifecycle", () => {
    let mockDevice: any;
    let mockRequestDevice: jest.Mock;
    let eventListeners: Record<string, ((e: any) => void)[]>;

    beforeEach(() => {
      eventListeners = {};
      mockDevice = {
        id: "beacon-worksphere-01",
        name: "WorkSphere Hub Beacon",
        addEventListener: jest.fn((event: string, cb: (e: any) => void) => {
          if (!eventListeners[event]) eventListeners[event] = [];
          eventListeners[event].push(cb);
        }),
        removeEventListener: jest.fn((event: string, cb: (e: any) => void) => {
          if (eventListeners[event]) {
            eventListeners[event] = eventListeners[event].filter((l) => l !== cb);
          }
        }),
        watchAdvertisements: jest.fn().mockResolvedValue(undefined),
        unwatchAdvertisements: jest.fn().mockResolvedValue(undefined),
        gatt: {
          connected: false,
          connect: jest.fn().mockResolvedValue({}),
          disconnect: jest.fn(),
        },
      };

      mockRequestDevice = jest.fn().mockResolvedValue(mockDevice);

      Object.defineProperty(global, "navigator", {
        value: {
          bluetooth: {
            requestDevice: mockRequestDevice,
          },
        },
        writable: true,
        configurable: true,
      });
    });

    it("does not start scanning or prompt for permissions automatically on mount", () => {
      renderHook(() => useBleProximity());
      expect(mockRequestDevice).not.toHaveBeenCalled();
    });

    it("initiates device request and sets status on user-invoked startScanning", async () => {
      const { result } = renderHook(() => useBleProximity());

      await act(async () => {
        await result.current.startScanning();
      });

      expect(mockRequestDevice).toHaveBeenCalledTimes(1);
      expect(mockDevice.watchAdvertisements).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("connected");
    });

    it("handles incoming advertisement RSSI packets with smoothing and distance estimation", async () => {
      const { result } = renderHook(() =>
        useBleProximity({
          referenceRssi: -59,
          pathLossExponent: 2.0,
          smoothingFactor: 0.5,
          nearbyThresholdMeters: 3.0,
        }),
      );

      await act(async () => {
        await result.current.startScanning();
      });

      const adListeners = eventListeners["advertisementreceived"] || [];
      expect(adListeners.length).toBeGreaterThan(0);

      // Simulate first advertisement received: -59 dBm (1 meter -> nearby)
      await act(async () => {
        adListeners[0]({ rssi: -59 });
      });

      expect(result.current.rawRssi).toBe(-59);
      expect(result.current.rssi).toBe(-59);
      expect(result.current.distance).toBe(1);
      expect(result.current.status).toBe("nearby");
      expect(result.current.beacon?.name).toBe("WorkSphere Hub Beacon");

      // Simulate second advertisement: -75 dBm -> smoothed RSSI moves, distance increases
      await act(async () => {
        adListeners[0]({ rssi: -75 });
      });

      expect(result.current.rawRssi).toBe(-75);
      expect(result.current.rssi).toBe(-67); // 0.5 * (-75) + 0.5 * (-59) = -67
      expect(result.current.distance).toBeGreaterThan(1.5);
    });

    it("handles user cancelling Bluetooth device selector gracefully", async () => {
      const notFoundErr = new Error("User cancelled the requestDevice() chooser.");
      notFoundErr.name = "NotFoundError";
      mockRequestDevice.mockRejectedValueOnce(notFoundErr);

      const { result } = renderHook(() => useBleProximity());

      await act(async () => {
        await result.current.startScanning();
      });

      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBeNull();
    });

    it("handles permission denial gracefully with clear error message", async () => {
      const securityErr = new Error("Bluetooth permission was denied.");
      securityErr.name = "SecurityError";
      mockRequestDevice.mockRejectedValueOnce(securityErr);

      const { result } = renderHook(() => useBleProximity());

      await act(async () => {
        await result.current.startScanning();
      });

      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBe("Bluetooth access permission was denied.");
    });

    it("handles GATT disconnection event by updating status and resetting smoothing", async () => {
      const { result } = renderHook(() => useBleProximity());

      await act(async () => {
        await result.current.startScanning();
      });

      const adListeners = eventListeners["advertisementreceived"] || [];
      await act(async () => {
        adListeners[0]({ rssi: -59 });
      });
      expect(result.current.rssi).toBe(-59);

      // Trigger disconnection event
      const disconnectListeners = eventListeners["gattserverdisconnected"] || [];
      expect(disconnectListeners.length).toBeGreaterThan(0);

      await act(async () => {
        disconnectListeners[0]({});
      });

      expect(result.current.status).toBe("searching");
      expect(result.current.rssi).toBeNull();
      expect(result.current.distance).toBeNull();
    });

    it("cleans up listeners and connections on stopScanning and on unmount", async () => {
      const { result, unmount } = renderHook(() => useBleProximity());

      await act(async () => {
        await result.current.startScanning();
      });

      expect(mockDevice.addEventListener).toHaveBeenCalled();

      act(() => {
        result.current.stopScanning();
      });

      expect(mockDevice.removeEventListener).toHaveBeenCalled();
      expect(result.current.status).toBe("idle");

      // Re-scan and unmount
      await act(async () => {
        await result.current.startScanning();
      });

      unmount();
      expect(mockDevice.removeEventListener).toHaveBeenCalled();
    });
  });
});
