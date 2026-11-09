import { renderHook, act } from "@testing-library/react";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";

describe("useDeviceOrientation hook", () => {
  let originalDeviceOrientationEvent: any;
  let originalDeviceMotionEvent: any;

  beforeEach(() => {
    originalDeviceOrientationEvent = (window as any).DeviceOrientationEvent;
    originalDeviceMotionEvent = (window as any).DeviceMotionEvent;
  });

  afterEach(() => {
    (window as any).DeviceOrientationEvent = originalDeviceOrientationEvent;
    (window as any).DeviceMotionEvent = originalDeviceMotionEvent;
    jest.restoreAllMocks();
  });

  it("handles unsupported devices gracefully", () => {
    delete (window as any).DeviceOrientationEvent;
    delete (window as any).DeviceMotionEvent;

    const { result } = renderHook(() => useDeviceOrientation());

    expect(result.current.isSupported).toBe(false);
    expect(result.current.permissionState).toBe("unsupported");
    expect(result.current.heading).toBeNull();
  });

  it("auto-grants permission and attaches listener on standard non-iOS browsers", () => {
    const addEventListenerSpy = jest.spyOn(window, "addEventListener");

    // Standard browser with DeviceOrientationEvent but no requestPermission
    (window as any).DeviceOrientationEvent = class {};

    const { result } = renderHook(() => useDeviceOrientation());

    expect(result.current.isSupported).toBe(true);
    expect(result.current.permissionState).toBe("granted");
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "deviceorientation",
      expect.any(Function),
      true,
    );
  });

  it("handles iOS Safari permission flow (prompt -> granted)", async () => {
    const requestPermissionMock = jest.fn().mockResolvedValue("granted");
    (window as any).DeviceOrientationEvent = class {};
    (window as any).DeviceOrientationEvent.requestPermission =
      requestPermissionMock;

    const { result } = renderHook(() => useDeviceOrientation());

    // Initially in prompt state on iOS
    expect(result.current.permissionState).toBe("prompt");

    // Call requestPermission
    let granted = false;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(true);
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(result.current.permissionState).toBe("granted");
    expect(result.current.error).toBeNull();
  });

  it("handles iOS Safari permission denial", async () => {
    const requestPermissionMock = jest.fn().mockResolvedValue("denied");
    (window as any).DeviceOrientationEvent = class {};
    (window as any).DeviceOrientationEvent.requestPermission =
      requestPermissionMock;

    const { result } = renderHook(() => useDeviceOrientation());

    expect(result.current.permissionState).toBe("prompt");

    let granted = true;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(false);
    expect(result.current.permissionState).toBe("denied");
    expect(result.current.error).toContain("denied");
  });

  it("correctly extracts webkitCompassHeading on iOS", () => {
    let orientationCallback: any;
    jest.spyOn(window, "addEventListener").mockImplementation((event: string, cb: any) => {
      if (event === "deviceorientation") {
        orientationCallback = cb;
      }
    });

    (window as any).DeviceOrientationEvent = class {};

    const { result } = renderHook(() => useDeviceOrientation());

    act(() => {
      orientationCallback({
        webkitCompassHeading: 45.4,
      });
    });

    expect(result.current.heading).toBe(45.4);
  });

  it("calculates heading from alpha when webkitCompassHeading is unavailable", () => {
    let orientationCallback: any;
    jest.spyOn(window, "addEventListener").mockImplementation((event: string, cb: any) => {
      if (event === "deviceorientation") {
        orientationCallback = cb;
      }
    });

    (window as any).DeviceOrientationEvent = class {};

    const { result } = renderHook(() => useDeviceOrientation());

    act(() => {
      orientationCallback({
        alpha: 90, // Heading = (360 - 90) = 270
      });
    });

    expect(result.current.heading).toBe(270);
  });

  it("handles null alpha sensor reading by falling back gracefully to 0 heading without NaN", () => {
    let orientationCallback: any;
    jest.spyOn(window, "addEventListener").mockImplementation((event: string, cb: any) => {
      if (event === "deviceorientation") {
        orientationCallback = cb;
      }
    });

    (window as any).DeviceOrientationEvent = class {};

    const { result } = renderHook(() => useDeviceOrientation());

    act(() => {
      orientationCallback({
        alpha: null, // Device without hardware magnetometer
        webkitCompassHeading: null,
      });
    });

    expect(result.current.heading).toBe(0);
    expect(Number.isNaN(result.current.heading)).toBe(false);
  });

  it("removes event listeners on unmount", () => {
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
    (window as any).DeviceOrientationEvent = class {};

    const { unmount } = renderHook(() => useDeviceOrientation());
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "deviceorientation",
      expect.any(Function),
      true,
    );
  });
});
