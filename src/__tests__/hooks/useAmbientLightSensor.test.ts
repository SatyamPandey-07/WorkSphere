import { renderHook, act } from "@testing-library/react";
import {
  useAmbientLightSensor,
  isAmbientLightSensorSupported,
  DEFAULT_LOW_LUX_THRESHOLD,
  DEFAULT_DEBOUNCE_DELAY_MS,
} from "@/hooks/useAmbientLightSensor";

const mockSetTheme = jest.fn();
const mockSetHighContrast = jest.fn();

jest.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: mockSetTheme,
    toggleTheme: jest.fn(),
    highContrast: false,
    setHighContrast: mockSetHighContrast,
    toggleHighContrast: jest.fn(),
  }),
}));

class MockAmbientLightSensor extends EventTarget {
  illuminance: number | null = null;
  hasReading = false;
  activated = false;
  options?: { frequency?: number };
  start = jest.fn(() => {
    this.activated = true;
  });
  stop = jest.fn(() => {
    this.activated = false;
  });

  constructor(options?: { frequency?: number }) {
    super();
    this.options = options;
  }

  emitReading(lux: number) {
    this.illuminance = lux;
    this.hasReading = true;
    this.dispatchEvent(new Event("reading"));
  }

  emitError(message = "Sensor error") {
    const errorEvent = new Event("error");
    Object.defineProperty(errorEvent, "error", {
      value: new Error(message),
    });
    this.dispatchEvent(errorEvent);
  }
}

class MockPermissionStatus extends EventTarget {
  state: PermissionState;
  onchange: (() => void) | null = null;

  constructor(state: PermissionState = "granted") {
    super();
    this.state = state;
  }

  setState(newState: PermissionState) {
    this.state = newState;
    if (this.onchange) this.onchange();
    this.dispatchEvent(new Event("change"));
  }
}

describe("useAmbientLightSensor", () => {
  let mockSensorInstance: MockAmbientLightSensor;
  let mockPermissionStatus: MockPermissionStatus;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockPermissionStatus = new MockPermissionStatus("granted");

    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: jest.fn().mockResolvedValue(mockPermissionStatus),
      },
    });

    (window as any).AmbientLightSensor = jest.fn((options) => {
      mockSensorInstance = new MockAmbientLightSensor(options);
      return mockSensorInstance;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (window as any).AmbientLightSensor;
    Reflect.deleteProperty(navigator, "permissions");
  });

  describe("Feature Detection and Defaults", () => {
    it("reports isSupported=true when window.AmbientLightSensor is available", () => {
      expect(isAmbientLightSensorSupported()).toBe(true);
      const { result } = renderHook(() => useAmbientLightSensor({ autoStart: false }));
      expect(result.current.isSupported).toBe(true);
      expect(result.current.illuminance).toBeNull();
      expect(result.current.debouncedLux).toBeNull();
      expect(result.current.isLowLight).toBe(false);
      expect(DEFAULT_LOW_LUX_THRESHOLD).toBe(15);
      expect(DEFAULT_DEBOUNCE_DELAY_MS).toBe(5000);
    });

    it("reports isSupported=false when window.AmbientLightSensor is missing", () => {
      delete (window as any).AmbientLightSensor;
      expect(isAmbientLightSensorSupported()).toBe(false);

      const { result } = renderHook(() => useAmbientLightSensor({ autoStart: false }));
      expect(result.current.isSupported).toBe(false);
    });
  });

  describe("Permission Guards", () => {
    it("queries permissions API and starts sensor if granted", async () => {
      const { result } = renderHook(() => useAmbientLightSensor());

      await act(async () => {
        jest.runAllTimers();
      });

      expect(navigator.permissions.query).toHaveBeenCalledWith({
        name: "ambient-light-sensor",
      });
      expect(result.current.permissionState).toBe("granted");
      expect(result.current.isActive).toBe(true);
      expect(mockSensorInstance.start).toHaveBeenCalledTimes(1);
    });

    it("does not start sensor and sets error if permission is denied", async () => {
      mockPermissionStatus.state = "denied";

      const { result } = renderHook(() => useAmbientLightSensor());

      await act(async () => {
        jest.runAllTimers();
      });

      expect(result.current.permissionState).toBe("denied");
      expect(result.current.isActive).toBe(false);
      expect(result.current.error).toMatch(/permission is denied/i);
    });

    it("stops sensor and sets error if permission changes to denied dynamically", async () => {
      const { result } = renderHook(() => useAmbientLightSensor());

      await act(async () => {
        jest.runAllTimers();
      });

      expect(result.current.isActive).toBe(true);

      act(() => {
        mockPermissionStatus.setState("denied");
      });

      expect(result.current.permissionState).toBe("denied");
      expect(result.current.isActive).toBe(false);
      expect(result.current.error).toMatch(/permission was denied/i);
      expect(mockSensorInstance.stop).toHaveBeenCalled();
    });
  });

  describe("Debouncing and Automated Theme Shifting", () => {
    it("updates raw illuminance immediately but debounces theme switch over 5 seconds", async () => {
      const onLuxChange = jest.fn();
      const onDebouncedLuxChange = jest.fn();
      const onLowLight = jest.fn();

      const { result } = renderHook(() =>
        useAmbientLightSensor({
          onLuxChange,
          onDebouncedLuxChange,
          onLowLight,
        }),
      );

      await act(async () => {
        jest.runAllTimers();
      });

      // Lux drops to 10 lux (below 15 lux)
      act(() => {
        mockSensorInstance.emitReading(10);
      });

      expect(result.current.illuminance).toBe(10);
      expect(onLuxChange).toHaveBeenCalledWith(10);
      // Immediately, debounced value and theme switch should NOT have executed yet
      expect(result.current.debouncedLux).toBeNull();
      expect(result.current.isLowLight).toBe(false);
      expect(mockSetTheme).not.toHaveBeenCalled();
      expect(mockSetHighContrast).not.toHaveBeenCalled();

      // Advance time by 3 seconds (3000ms < 5000ms)
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(result.current.debouncedLux).toBeNull();
      expect(mockSetTheme).not.toHaveBeenCalled();

      // Advance remaining 2 seconds (reaching 5000ms)
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(result.current.debouncedLux).toBe(10);
      expect(result.current.isLowLight).toBe(true);
      expect(onDebouncedLuxChange).toHaveBeenCalledWith(10);
      expect(onLowLight).toHaveBeenCalledWith(10);
      expect(mockSetTheme).toHaveBeenCalledWith("dark");
      expect(mockSetHighContrast).toHaveBeenCalledWith(true);
    });

    it("prevents theme flicker when lux drops briefly and recovers before 5 seconds (shadow test)", async () => {
      const { result } = renderHook(() => useAmbientLightSensor());

      await act(async () => {
        jest.runAllTimers();
      });

      // Ambient light at 100 lux (bright cafe)
      act(() => {
        mockSensorInstance.emitReading(100);
      });

      // Stabilize initial bright light
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      mockSetTheme.mockClear();
      mockSetHighContrast.mockClear();

      // A person walks by or hand casts a shadow: dips to 5 lux
      act(() => {
        mockSensorInstance.emitReading(5);
      });

      expect(result.current.illuminance).toBe(5);

      // Shadow lasts only 2 seconds, then hand moves away back to 100 lux
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      act(() => {
        mockSensorInstance.emitReading(100);
      });

      // Advance time by another 5 seconds
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      // Dark mode must NOT have been triggered because the shadow was transient (< 5s)
      expect(mockSetTheme).not.toHaveBeenCalledWith("dark");
      expect(mockSetHighContrast).not.toHaveBeenCalledWith(true);
      expect(result.current.isLowLight).toBe(false);
    });

    it("switches back to light mode when ambient light increases above threshold for 5 seconds", async () => {
      const onBrightLight = jest.fn();
      const { result } = renderHook(() =>
        useAmbientLightSensor({ onBrightLight }),
      );

      await act(async () => {
        jest.runAllTimers();
      });

      // Starts in dark environment
      act(() => {
        mockSensorInstance.emitReading(8);
      });
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(mockSetTheme).toHaveBeenCalledWith("dark");
      expect(mockSetHighContrast).toHaveBeenCalledWith(true);
      expect(result.current.isLowLight).toBe(true);

      mockSetTheme.mockClear();
      mockSetHighContrast.mockClear();

      // Light turned on or sun rises: 200 lux
      act(() => {
        mockSensorInstance.emitReading(200);
      });
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(mockSetTheme).toHaveBeenCalledWith("light");
      expect(mockSetHighContrast).toHaveBeenCalledWith(false);
      expect(result.current.isLowLight).toBe(false);
      expect(onBrightLight).toHaveBeenCalledWith(200);
    });

    it("respects autoSwitchTheme=false", async () => {
      const { result } = renderHook(() =>
        useAmbientLightSensor({ autoSwitchTheme: false }),
      );

      await act(async () => {
        jest.runAllTimers();
      });

      act(() => {
        mockSensorInstance.emitReading(5);
      });
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.debouncedLux).toBe(5);
      expect(result.current.isLowLight).toBe(true);
      expect(mockSetTheme).not.toHaveBeenCalled();
      expect(mockSetHighContrast).not.toHaveBeenCalled();
    });
  });

  describe("Lifecycle and Error Handling", () => {
    it("stops sensor and clears timers on unmount", async () => {
      const { unmount } = renderHook(() => useAmbientLightSensor());

      await act(async () => {
        jest.runAllTimers();
      });

      expect(mockSensorInstance.activated).toBe(true);

      unmount();

      expect(mockSensorInstance.stop).toHaveBeenCalled();
    });

    it("captures sensor error events and sets error state", async () => {
      const { result } = renderHook(() => useAmbientLightSensor());

      await act(async () => {
        jest.runAllTimers();
      });

      act(() => {
        mockSensorInstance.emitError("Hardware sensor malfunction");
      });

      expect(result.current.error).toBe("Hardware sensor malfunction");
      expect(result.current.isActive).toBe(false);
    });
  });
});
