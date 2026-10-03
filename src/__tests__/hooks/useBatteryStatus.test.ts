import { renderHook, act } from "@testing-library/react";
import { useBatteryStatus } from "@/hooks/useBatteryStatus";

// Mock the Battery Status API
type BatteryManagerMock = {
  level: number;
  charging: boolean;
  dischargingTime: number;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  onlevelchange: null;
  onchargingchange: null;
  onchargingtimechange: null;
  ondischargingtimechange: null;
};

let mockBattery: BatteryManagerMock;

function createBatteryMock(
  level = 1.0,
  charging = true,
  dischargingTime = Infinity,
): BatteryManagerMock {
  return {
    level,
    charging,
    dischargingTime,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    onlevelchange: null,
    onchargingchange: null,
    onchargingtimechange: null,
    ondischargingtimechange: null,
  };
}

beforeEach(() => {
  mockBattery = createBatteryMock();

  Object.defineProperty(navigator, "getBattery", {
    value: () => Promise.resolve(mockBattery),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useBatteryStatus", () => {
  it("returns isSupported=true when getBattery is available", async () => {
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.isSupported).toBe(true);
  });

  it("returns isSupported=false when getBattery is unavailable", async () => {
    Object.defineProperty(navigator, "getBattery", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.isSupported).toBe(false);
  });

  it("returns current battery level", async () => {
    mockBattery = createBatteryMock(0.75, true);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.level).toBe(0.75);
  });

  it("returns charging=true when charging", async () => {
    mockBattery = createBatteryMock(0.5, true);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.charging).toBe(true);
  });

  it("returns isLow=true when level ≤ 20% and not charging", async () => {
    mockBattery = createBatteryMock(0.18, false);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.isLow).toBe(true);
  });

  it("returns isLow=false when level > 20%", async () => {
    mockBattery = createBatteryMock(0.5, false);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.isLow).toBe(false);
  });

  it("returns isLow=false when charging even if level ≤ 20%", async () => {
    mockBattery = createBatteryMock(0.15, true);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.isLow).toBe(false);
  });

  it("returns isPanic=true when level ≤ 10% and not charging", async () => {
    mockBattery = createBatteryMock(0.08, false);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.isPanic).toBe(true);
  });

  it("returns isPanic=false when level > 10%", async () => {
    mockBattery = createBatteryMock(0.25, false);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.isPanic).toBe(false);
  });

  it("returns dischargingTime=null when Infinity", async () => {
    mockBattery = createBatteryMock(0.8, false, Infinity);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(result.current.dischargingTime).toBeNull();
  });

  it("registers level, charging, and dischargingTime event listeners", async () => {
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});
    expect(mockBattery.addEventListener).toHaveBeenCalledWith("levelchange", expect.any(Function));
    expect(mockBattery.addEventListener).toHaveBeenCalledWith("chargingchange", expect.any(Function));
    expect(mockBattery.addEventListener).toHaveBeenCalledWith("dischargingtimechange", expect.any(Function));
  });

  it("removes event listeners using the registered handler when unmounted", async () => {
    const { unmount } = renderHook(() => useBatteryStatus());
    await act(async () => {});

    const registeredHandler = mockBattery.addEventListener.mock.calls[0][1];
    expect(typeof registeredHandler).toBe("function");

    unmount();

    expect(mockBattery.removeEventListener).toHaveBeenCalledWith("levelchange", registeredHandler);
    expect(mockBattery.removeEventListener).toHaveBeenCalledWith("chargingchange", registeredHandler);
    expect(mockBattery.removeEventListener).toHaveBeenCalledWith("dischargingtimechange", registeredHandler);
  });

  it("updates battery state when battery event listener is triggered", async () => {
    mockBattery = createBatteryMock(0.8, true);
    const { result } = renderHook(() => useBatteryStatus());
    await act(async () => {});

    expect(result.current.level).toBe(0.8);

    // Simulate battery drain event
    const registeredHandler = mockBattery.addEventListener.mock.calls[0][1];
    mockBattery.level = 0.15;
    mockBattery.charging = false;

    await act(async () => {
      registeredHandler();
    });

    expect(result.current.level).toBe(0.15);
    expect(result.current.isLow).toBe(true);
  });

  it("does not attach listeners if unmounted before getBattery resolves", async () => {
    let resolvePromise: (b: BatteryManagerMock) => void = () => {};
    const deferredPromise = new Promise<BatteryManagerMock>((resolve) => {
      resolvePromise = resolve;
    });

    Object.defineProperty(navigator, "getBattery", {
      value: () => deferredPromise,
      writable: true,
      configurable: true,
    });

    const { unmount } = renderHook(() => useBatteryStatus());

    // Unmount while promise is pending
    unmount();

    // Now resolve the promise
    await act(async () => {
      resolvePromise(mockBattery);
    });

    expect(mockBattery.addEventListener).not.toHaveBeenCalled();
  });
});
