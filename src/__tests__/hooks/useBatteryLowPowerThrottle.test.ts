import { renderHook, act } from "@testing-library/react";
import {
  useBatteryLowPowerThrottle,
  DEFAULT_LOW_POWER_MESSAGE,
} from "@/hooks/useBatteryLowPowerThrottle";
import { useStrokeBuffer } from "@/lib/whiteboard/whiteboardCore";

// Mock Toast
const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

type BatteryManagerMock = {
  level: number;
  charging: boolean;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
};

function createBatteryMock(level = 0.8, charging = false): BatteryManagerMock {
  return {
    level,
    charging,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

describe("useBatteryLowPowerThrottle Hook & System Integration", () => {
  let mockBattery: BatteryManagerMock;
  let originalNavigator: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBattery = createBatteryMock(0.8, false);

    originalNavigator = global.navigator;
    Object.defineProperty(global, "navigator", {
      value: {
        ...originalNavigator,
        getBattery: jest.fn().mockResolvedValue(mockBattery),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  describe("Battery Detection & Initial States", () => {
    it("reports normal power when battery is above 20% and discharging", async () => {
      mockBattery.level = 0.8;
      mockBattery.charging = false;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });

      const { result } = hookResult;
      expect(result.current.isBatteryApiSupported).toBe(true);
      expect(result.current.isLowPowerMode).toBe(false);
      expect(result.current.batteryLevel).toBe(0.8);
      expect(result.current.isCharging).toBe(false);
      expect(result.current.syncIntervalMs).toBeCloseTo(16.67, 1);
      expect(result.current.renderFps).toBe(60);
      expect(result.current.renderIntervalMs).toBeCloseTo(16.67, 1);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("activates low power mode when initial battery is exactly 20% and discharging", async () => {
      mockBattery.level = 0.2;
      mockBattery.charging = false;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });

      const { result } = hookResult;
      expect(result.current.isBatteryApiSupported).toBe(true);
      expect(result.current.isLowPowerMode).toBe(true);
      expect(result.current.batteryLevel).toBe(0.2);
      expect(result.current.isCharging).toBe(false);
      expect(result.current.syncIntervalMs).toBe(200);
      expect(result.current.renderFps).toBe(15);
      expect(result.current.renderIntervalMs).toBeCloseTo(66.67, 1);
      expect(mockToast).toHaveBeenCalledWith(DEFAULT_LOW_POWER_MESSAGE, "warning");
    });

    it("activates low power mode when initial battery is below 20% and discharging", async () => {
      mockBattery.level = 0.15;
      mockBattery.charging = false;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });

      const { result } = hookResult;
      expect(result.current.isLowPowerMode).toBe(true);
      expect(result.current.syncIntervalMs).toBe(200);
      expect(result.current.renderFps).toBe(15);
      expect(mockToast).toHaveBeenCalledWith(DEFAULT_LOW_POWER_MESSAGE, "warning");
    });

    it("remains in normal power if battery is low (15%) but device is charging", async () => {
      mockBattery.level = 0.15;
      mockBattery.charging = true;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });

      const { result } = hookResult;
      expect(result.current.isLowPowerMode).toBe(false);
      expect(result.current.isCharging).toBe(true);
      expect(result.current.syncIntervalMs).toBeCloseTo(16.67, 1);
      expect(result.current.renderFps).toBe(60);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("handles unsupported Battery Status API gracefully without crashing", async () => {
      Object.defineProperty(global, "navigator", {
        value: {
          ...originalNavigator,
          getBattery: undefined,
        },
        writable: true,
        configurable: true,
      });

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });

      const { result } = hookResult;
      expect(result.current.isBatteryApiSupported).toBe(false);
      expect(result.current.isLowPowerMode).toBe(false);
      expect(result.current.batteryLevel).toBeNull();
      expect(result.current.syncIntervalMs).toBeCloseTo(16.67, 1);
      expect(result.current.renderFps).toBe(60);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("handles rejected getBattery() promise gracefully", async () => {
      Object.defineProperty(global, "navigator", {
        value: {
          ...originalNavigator,
          getBattery: jest.fn().mockRejectedValue(new Error("Permission denied")),
        },
        writable: true,
        configurable: true,
      });

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });

      const { result } = hookResult;
      expect(result.current.isBatteryApiSupported).toBe(false);
      expect(result.current.isLowPowerMode).toBe(false);
      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe("State Transitions & Dynamic Events", () => {
    let capturedListeners: Record<string, () => void> = {};

    beforeEach(() => {
      capturedListeners = {};
      mockBattery.addEventListener.mockImplementation((type: string, cb: () => void) => {
        capturedListeners[type] = cb;
      });
    });

    it("triggers low-power mode and notification on levelchange crossing <= 20%", async () => {
      mockBattery.level = 0.25;
      mockBattery.charging = false;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });
      const { result } = hookResult;
      expect(result.current.isLowPowerMode).toBe(false);
      expect(mockToast).not.toHaveBeenCalled();

      // Battery drops to 20%
      mockBattery.level = 0.2;
      await act(async () => {
        capturedListeners["levelchange"]?.();
      });

      expect(result.current.isLowPowerMode).toBe(true);
      expect(result.current.syncIntervalMs).toBe(200);
      expect(result.current.renderFps).toBe(15);
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(DEFAULT_LOW_POWER_MESSAGE, "warning");

      // Repeated events while still in low power do not re-trigger notification
      mockBattery.level = 0.18;
      await act(async () => {
        capturedListeners["levelchange"]?.();
      });
      expect(mockToast).toHaveBeenCalledTimes(1);
    });

    it("restores normal performance when levelchange rises above 20%", async () => {
      mockBattery.level = 0.15;
      mockBattery.charging = false;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });
      const { result } = hookResult;
      expect(result.current.isLowPowerMode).toBe(true);

      // Battery rises to 21%
      mockBattery.level = 0.21;
      await act(async () => {
        capturedListeners["levelchange"]?.();
      });

      expect(result.current.isLowPowerMode).toBe(false);
      expect(result.current.syncIntervalMs).toBeCloseTo(16.67, 1);
      expect(result.current.renderFps).toBe(60);
    });

    it("restores normal performance when charging begins (chargingchange)", async () => {
      mockBattery.level = 0.15;
      mockBattery.charging = false;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });
      const { result } = hookResult;
      expect(result.current.isLowPowerMode).toBe(true);

      // Charger plugged in
      mockBattery.charging = true;
      await act(async () => {
        capturedListeners["chargingchange"]?.();
      });

      expect(result.current.isLowPowerMode).toBe(false);
      expect(result.current.isCharging).toBe(true);
      expect(result.current.syncIntervalMs).toBeCloseTo(16.67, 1);
      expect(result.current.renderFps).toBe(60);
    });

    it("re-activates low-power mode when charging stops at low battery", async () => {
      mockBattery.level = 0.15;
      mockBattery.charging = true;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });
      const { result } = hookResult;
      expect(result.current.isLowPowerMode).toBe(false);

      // Charger unplugged
      mockBattery.charging = false;
      await act(async () => {
        capturedListeners["chargingchange"]?.();
      });

      expect(result.current.isLowPowerMode).toBe(true);
      expect(result.current.isCharging).toBe(false);
      expect(result.current.syncIntervalMs).toBe(200);
      expect(result.current.renderFps).toBe(15);
      expect(mockToast).toHaveBeenCalledWith(DEFAULT_LOW_POWER_MESSAGE, "warning");
    });

    it("allows dismissing the notification banner without disabling throttling", async () => {
      mockBattery.level = 0.15;
      mockBattery.charging = false;

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() => useBatteryLowPowerThrottle());
      });
      const { result } = hookResult;
      expect(result.current.isLowPowerMode).toBe(true);
      expect(result.current.isNotificationDismissed).toBe(false);

      // Dismiss notification
      act(() => {
        result.current.dismissNotification();
      });

      expect(result.current.isNotificationDismissed).toBe(true);
      // Throttling remains active
      expect(result.current.isLowPowerMode).toBe(true);
      expect(result.current.syncIntervalMs).toBe(200);
      expect(result.current.renderFps).toBe(15);
    });
  });

  describe("Lifecycle & Cleanup", () => {
    it("registers and cleans up event listeners on unmount", async () => {
      let unmountFn: any;
      await act(async () => {
        const { unmount } = renderHook(() => useBatteryLowPowerThrottle());
        unmountFn = unmount;
      });

      expect(mockBattery.addEventListener).toHaveBeenCalledWith(
        "levelchange",
        expect.any(Function),
      );
      expect(mockBattery.addEventListener).toHaveBeenCalledWith(
        "chargingchange",
        expect.any(Function),
      );

      unmountFn();

      expect(mockBattery.removeEventListener).toHaveBeenCalledWith(
        "levelchange",
        expect.any(Function),
      );
      expect(mockBattery.removeEventListener).toHaveBeenCalledWith(
        "chargingchange",
        expect.any(Function),
      );
    });
  });

  describe("CRDT Schedulers & Pending Edits Integration", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("preserves all pending CRDT stroke points during 5Hz throttling", () => {
      const appliedPoints: Array<{ id: string; points: number[] }> = [];
      const onApplyPoints = jest.fn((id: string, points: number[]) => {
        appliedPoints.push({ id, points: points.slice() });
      });

      // Render useStrokeBuffer with throttled interval (200ms = 5Hz)
      const { result } = renderHook(() =>
        useStrokeBuffer({
          onApplyPoints,
          throttleIntervalMs: 200,
        }),
      );

      // User performs multiple local edits rapidly
      act(() => {
        result.current.bufferStrokePoints("shape-1", [10, 20]);
        result.current.bufferStrokePoints("shape-1", [30, 40]);
        result.current.bufferStrokePoints("shape-2", [100, 200]);
      });

      // No dispatch yet (interval not elapsed)
      expect(onApplyPoints).not.toHaveBeenCalled();

      // Advance by 100ms: still within 200ms window, more points buffered
      act(() => {
        jest.advanceTimersByTime(100);
        result.current.bufferStrokePoints("shape-1", [50, 60]);
      });
      expect(onApplyPoints).not.toHaveBeenCalled();

      // Advance remaining 100ms (total 200ms): scheduled flush fires
      act(() => {
        jest.advanceTimersByTime(100);
      });

      // All points for both shapes were preserved and delivered!
      expect(onApplyPoints).toHaveBeenCalledTimes(2);
      expect(appliedPoints).toEqual([
        { id: "shape-1", points: [10, 20, 30, 40, 50, 60] },
        { id: "shape-2", points: [100, 200] },
      ]);
    });
  });
});
