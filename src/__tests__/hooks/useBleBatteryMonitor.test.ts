import { renderHook, act } from "@testing-library/react";
import {
  useBleBatteryMonitor,
  parseBatteryLevel,
  BATTERY_SERVICE_UUID,
  DEFAULT_LOW_BATTERY_THRESHOLD,
} from "@/hooks/useBleBatteryMonitor";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

function createDataView(value: number): DataView {
  const buffer = new ArrayBuffer(1);
  const view = new DataView(buffer);
  view.setUint8(0, value);
  return view;
}

describe("useBleBatteryMonitor", () => {
  let mockDevice: any;
  let mockServer: any;
  let mockService: any;
  let mockCharacteristic: any;
  let charListeners: Record<string, ((ev: any) => void)[]>;
  let deviceListeners: Record<string, ((ev: any) => void)[]>;

  beforeEach(() => {
    jest.clearAllMocks();
    charListeners = {};
    deviceListeners = {};

    mockCharacteristic = {
      value: createDataView(80),
      readValue: jest.fn().mockResolvedValue(createDataView(80)),
      startNotifications: jest.fn().mockResolvedValue(undefined),
      stopNotifications: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn((event, cb) => {
        if (!charListeners[event]) charListeners[event] = [];
        charListeners[event].push(cb);
      }),
      removeEventListener: jest.fn((event, cb) => {
        if (charListeners[event]) {
          charListeners[event] = charListeners[event].filter((fn) => fn !== cb);
        }
      }),
    };

    mockService = {
      getCharacteristic: jest.fn().mockResolvedValue(mockCharacteristic),
    };

    mockServer = {
      connected: true,
      connect: jest.fn().mockResolvedValue(mockServer),
      disconnect: jest.fn(() => {
        mockServer.connected = false;
      }),
      getPrimaryService: jest.fn().mockResolvedValue(mockService),
    };

    mockDevice = {
      id: "ble-mouse-01",
      name: "Ergonomic Vertical Mouse",
      gatt: mockServer,
      addEventListener: jest.fn((event, cb) => {
        if (!deviceListeners[event]) deviceListeners[event] = [];
        deviceListeners[event].push(cb);
      }),
      removeEventListener: jest.fn((event, cb) => {
        if (deviceListeners[event]) {
          deviceListeners[event] = deviceListeners[event].filter((fn) => fn !== cb);
        }
      }),
    };

    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: {
        requestDevice: jest.fn().mockResolvedValue(mockDevice),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "bluetooth");
  });

  describe("parseBatteryLevel utility", () => {
    it("extracts uint8 battery level from valid DataView", () => {
      expect(parseBatteryLevel(createDataView(100))).toBe(100);
      expect(parseBatteryLevel(createDataView(15))).toBe(15);
      expect(parseBatteryLevel(createDataView(0))).toBe(0);
    });

    it("throws an error when given an empty or invalid DataView", () => {
      const emptyView = new DataView(new ArrayBuffer(0));
      expect(() => parseBatteryLevel(emptyView)).toThrow(
        /Invalid DataView: cannot parse battery level/,
      );
    });
  });

  describe("Initial State and Browser Support", () => {
    it("reports isSupported=true when navigator.bluetooth is available", () => {
      const { result } = renderHook(() => useBleBatteryMonitor());
      expect(result.current.isSupported).toBe(true);
      expect(result.current.batteryLevel).toBeNull();
      expect(result.current.isConnected).toBe(false);
      expect(result.current.isConnecting).toBe(false);
      expect(result.current.isLowBattery).toBe(false);
      expect(result.current.deviceName).toBeNull();
      expect(result.current.deviceId).toBeNull();
    });

    it("reports isSupported=false when navigator.bluetooth is missing", () => {
      Reflect.deleteProperty(navigator, "bluetooth");
      const { result } = renderHook(() => useBleBatteryMonitor());
      expect(result.current.isSupported).toBe(false);
    });
  });

  describe("Device Connection and GATT Discovery", () => {
    it("connects to device, retrieves Battery Service and initial level", async () => {
      const { result } = renderHook(() => useBleBatteryMonitor());

      await act(async () => {
        await result.current.connect();
      });

      expect(navigator.bluetooth.requestDevice).toHaveBeenCalledTimes(1);
      expect(mockServer.connect).toHaveBeenCalledTimes(1);
      expect(mockServer.getPrimaryService).toHaveBeenCalledWith(BATTERY_SERVICE_UUID);
      expect(mockCharacteristic.readValue).toHaveBeenCalledTimes(1);
      expect(mockCharacteristic.startNotifications).toHaveBeenCalledTimes(1);

      expect(result.current.isConnected).toBe(true);
      expect(result.current.isConnecting).toBe(false);
      expect(result.current.batteryLevel).toBe(80);
      expect(result.current.isLowBattery).toBe(false);
      expect(result.current.deviceName).toBe("Ergonomic Vertical Mouse");
      expect(result.current.deviceId).toBe("ble-mouse-01");
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("handles requestDevice rejection gracefully and sets error", async () => {
      (navigator.bluetooth.requestDevice as jest.Mock).mockRejectedValueOnce(
        new Error("User cancelled device chooser"),
      );

      const { result } = renderHook(() => useBleBatteryMonitor());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBe("User cancelled device chooser");
    });

    it("handles unsupported browser error on connect", async () => {
      Reflect.deleteProperty(navigator, "bluetooth");
      const { result } = renderHook(() => useBleBatteryMonitor());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.error).toMatch(/Web Bluetooth is not supported/);
    });
  });

  describe("Battery Characteristic Notifications and Low-Charge Alerts", () => {
    it("updates battery level on characteristic notification", async () => {
      const onBatteryLevelChange = jest.fn();
      const { result } = renderHook(() =>
        useBleBatteryMonitor({ onBatteryLevelChange }),
      );

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.batteryLevel).toBe(80);

      // Simulate notification event with new battery level = 65%
      await act(async () => {
        mockCharacteristic.value = createDataView(65);
        const event = { target: mockCharacteristic } as any;
        charListeners["characteristicvaluechanged"]?.forEach((cb) => cb(event));
      });

      expect(result.current.batteryLevel).toBe(65);
      expect(result.current.isLowBattery).toBe(false);
      expect(onBatteryLevelChange).toHaveBeenCalledWith(65);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("triggers low-battery toast warning when initial level is <= 15%", async () => {
      mockCharacteristic.readValue.mockResolvedValueOnce(createDataView(14));
      const onLowBattery = jest.fn();

      const { result } = renderHook(() =>
        useBleBatteryMonitor({ onLowBattery }),
      );

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.batteryLevel).toBe(14);
      expect(result.current.isLowBattery).toBe(true);
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining("14%"),
        "warning",
      );
      expect(onLowBattery).toHaveBeenCalledWith(14, "Ergonomic Vertical Mouse");
    });

    it("triggers toast alert when battery level drops to <= 15% threshold", async () => {
      const onLowBattery = jest.fn();
      const { result } = renderHook(() =>
        useBleBatteryMonitor({ onLowBattery }),
      );

      await act(async () => {
        await result.current.connect();
      });

      expect(mockToast).not.toHaveBeenCalled();

      // Drops to 15%
      await act(async () => {
        mockCharacteristic.value = createDataView(15);
        const event = { target: mockCharacteristic } as any;
        charListeners["characteristicvaluechanged"]?.forEach((cb) => cb(event));
      });

      expect(result.current.batteryLevel).toBe(15);
      expect(result.current.isLowBattery).toBe(true);
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining("15%"),
        "warning",
      );
      expect(onLowBattery).toHaveBeenCalledWith(15, "Ergonomic Vertical Mouse");

      // Further drop to 10% should not spam duplicate toast without charging
      await act(async () => {
        mockCharacteristic.value = createDataView(10);
        const event = { target: mockCharacteristic } as any;
        charListeners["characteristicvaluechanged"]?.forEach((cb) => cb(event));
      });

      expect(result.current.batteryLevel).toBe(10);
      expect(mockToast).toHaveBeenCalledTimes(1);

      // Recharges above 15% to 50%
      await act(async () => {
        mockCharacteristic.value = createDataView(50);
        const event = { target: mockCharacteristic } as any;
        charListeners["characteristicvaluechanged"]?.forEach((cb) => cb(event));
      });

      expect(result.current.batteryLevel).toBe(50);
      expect(result.current.isLowBattery).toBe(false);

      // Drops again to 12% -> should trigger alert again
      await act(async () => {
        mockCharacteristic.value = createDataView(12);
        const event = { target: mockCharacteristic } as any;
        charListeners["characteristicvaluechanged"]?.forEach((cb) => cb(event));
      });

      expect(result.current.batteryLevel).toBe(12);
      expect(result.current.isLowBattery).toBe(true);
      expect(mockToast).toHaveBeenCalledTimes(2);
      expect(mockToast).toHaveBeenLastCalledWith(
        expect.stringContaining("12%"),
        "warning",
      );
    });

    it("respects custom low battery threshold and autoAlert=false", async () => {
      const onLowBattery = jest.fn();
      const { result } = renderHook(() =>
        useBleBatteryMonitor({
          threshold: 20,
          autoAlert: false,
          onLowBattery,
        }),
      );

      await act(async () => {
        await result.current.connect();
      });

      // Drops to 18% (<= 20)
      await act(async () => {
        mockCharacteristic.value = createDataView(18);
        const event = { target: mockCharacteristic } as any;
        charListeners["characteristicvaluechanged"]?.forEach((cb) => cb(event));
      });

      expect(result.current.batteryLevel).toBe(18);
      expect(result.current.isLowBattery).toBe(true);
      expect(onLowBattery).toHaveBeenCalledWith(18, "Ergonomic Vertical Mouse");
      // autoAlert is false, so toast should not be called
      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe("Disconnection and Cleanup", () => {
    it("handles manual disconnect and clears state", async () => {
      const { result } = renderHook(() => useBleBatteryMonitor());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.isConnected).toBe(true);

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.batteryLevel).toBeNull();
      expect(mockServer.disconnect).toHaveBeenCalled();
    });

    it("handles gattserverdisconnected event and fires onDisconnect callback", async () => {
      const onDisconnect = jest.fn();
      const { result } = renderHook(() =>
        useBleBatteryMonitor({ onDisconnect }),
      );

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.isConnected).toBe(true);

      // Trigger peripheral disconnection event
      act(() => {
        const event = new Event("gattserverdisconnected");
        deviceListeners["gattserverdisconnected"]?.forEach((cb) => cb(event));
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.batteryLevel).toBeNull();
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });

    it("cleans up resources on unmount", async () => {
      const { result, unmount } = renderHook(() => useBleBatteryMonitor());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.isConnected).toBe(true);

      unmount();

      expect(mockCharacteristic.removeEventListener).toHaveBeenCalledWith(
        "characteristicvaluechanged",
        expect.any(Function),
      );
      expect(mockDevice.removeEventListener).toHaveBeenCalledWith(
        "gattserverdisconnected",
        expect.any(Function),
      );
    });
  });
});
