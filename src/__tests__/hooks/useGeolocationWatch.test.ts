import { renderHook, act } from "@testing-library/react";
import { useGeolocationWatch } from "@/hooks/useGeolocationWatch";

function makeMockPosition(lat = 40.71, lng = -74.0): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  } as GeolocationPosition;
}

let watchPositionCallback: ((pos: GeolocationPosition) => void) | null = null;
let watchPositionErrorCallback: ((err: GeolocationPositionError) => void) | null = null;
let watchId = 1;

beforeEach(() => {
  watchPositionCallback = null;
  watchPositionErrorCallback = null;

  Object.defineProperty(navigator, "geolocation", {
    value: {
      watchPosition: jest.fn((success, error) => {
        watchPositionCallback = success;
        watchPositionErrorCallback = error;
        return watchId++;
      }),
      clearWatch: jest.fn(),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useGeolocationWatch", () => {
  it("starts with null position and 'prompt' permission", () => {
    const { result } = renderHook(() => useGeolocationWatch());
    expect(result.current.position).toBeNull();
    expect(result.current.permissionState).toBe("prompt");
    expect(result.current.error).toBeNull();
  });

  it("calls watchPosition on mount", () => {
    renderHook(() => useGeolocationWatch());
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("updates position when watchPosition fires success", () => {
    const { result } = renderHook(() => useGeolocationWatch());
    const mockPos = makeMockPosition();

    act(() => {
      watchPositionCallback!(mockPos);
    });

    expect(result.current.position).toEqual(mockPos);
    expect(result.current.permissionState).toBe("granted");
  });

  it("calls onPosition callback with new position", () => {
    const onPosition = jest.fn();
    renderHook(() => useGeolocationWatch(onPosition));
    const mockPos = makeMockPosition(51.5, -0.1);

    act(() => {
      watchPositionCallback!(mockPos);
    });

    expect(onPosition).toHaveBeenCalledWith(mockPos);
  });

  it("updates error and permissionState='denied' on permission error", () => {
    const { result } = renderHook(() => useGeolocationWatch());
    const mockError = {
      code: 1, // PERMISSION_DENIED
      message: "Permission denied",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;

    act(() => {
      watchPositionErrorCallback!(mockError);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.permissionState).toBe("denied");
  });

  it("calls clearWatch on unmount", () => {
    const { unmount } = renderHook(() => useGeolocationWatch());
    unmount();
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledTimes(1);
  });
});
