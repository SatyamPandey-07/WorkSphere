import { renderHook, act } from "@testing-library/react";
import {
  useUserLocation,
  geocodePostalOrCity,
  DEFAULT_FALLBACK_LOCATION,
} from "@/hooks/useUserLocation";

// Mock fetch globally
const globalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = globalFetch;
  jest.restoreAllMocks();
});

describe("geocodePostalOrCity", () => {
  it("returns null for empty or whitespace query", async () => {
    const result = await geocodePostalOrCity("   ");
    expect(result).toBeNull();
  });

  it("resolves postal code to lat/lng coordinates via Nominatim", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          lat: "37.7749",
          lon: "-122.4194",
          display_name: "San Francisco, CA, USA",
        },
      ],
    });

    const result = await geocodePostalOrCity("94103");
    expect(result).toEqual({
      lat: 37.7749,
      lng: -122.4194,
      displayName: "San Francisco, CA, USA",
    });
  });

  it("handles fetch failure gracefully by returning null", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network failure"),
    );
    const result = await geocodePostalOrCity("Berlin");
    expect(result).toBeNull();
  });
});

describe("useUserLocation", () => {
  it("initializes with default location and prompt permission", () => {
    const { result } = renderHook(() =>
      useUserLocation({ autoRequest: false }),
    );

    expect(result.current.location).toEqual(DEFAULT_FALLBACK_LOCATION);
    expect(result.current.permissionState).toBe("prompt");
    expect(result.current.isDenied).toBe(false);
  });

  it("handles PERMISSION_DENIED (code 1) gracefully without (0, 0) coordinates", async () => {
    // Mock navigator.geolocation error
    const mockGetCurrentPosition = jest.fn((_success, error) => {
      error({
        code: 1, // PERMISSION_DENIED
        message: "User denied Geolocation",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    });

    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: mockGetCurrentPosition },
      writable: true,
      configurable: true,
    });

    // Mock IP fallback response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lat: 40.7128,
        lng: -74.006,
        city: "New York",
        region: "NY",
        country: "US",
        source: "ipwho.is",
      }),
    });

    const { result } = renderHook(() => useUserLocation({ autoRequest: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.permissionState).toBe("denied");
    expect(result.current.isDenied).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("/api/location");
    // Must not be (0, 0)
    expect(result.current.location.latitude).not.toBe(0);
    expect(result.current.location.longitude).not.toBe(0);
  });

  it("requests /api/location and consumes returned coordinates and location name on IP fallback", async () => {
    const mockGetCurrentPosition = jest.fn((_success, error) => {
      error({
        code: 1,
        message: "User denied Geolocation",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    });

    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: mockGetCurrentPosition },
      writable: true,
      configurable: true,
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lat: 40.7128,
        lng: -74.006,
        city: "New York",
        region: "NY",
        country: "US",
        source: "ipwho.is",
      }),
    });

    const { result } = renderHook(() => useUserLocation({ autoRequest: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/location");
    expect(result.current.location).toEqual({
      latitude: 40.7128,
      longitude: -74.006,
    });
    expect(result.current.locationName).toBe("New York, NY");
    expect(result.current.source).toBe("ip");
  });

  it("falls back to custom configured defaultLocation when /api/location returns server-side default response", async () => {
    const mockGetCurrentPosition = jest.fn((_success, error) => {
      error({
        code: 1,
        message: "User denied Geolocation",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    });

    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: mockGetCurrentPosition },
      writable: true,
      configurable: true,
    });

    // Mock API returning server-side static default (e.g. rate-limited or provider lookup failure)
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lat: 37.7749,
        lng: -122.4194,
        city: "San Francisco",
        region: "California",
        country: "US",
        source: "default",
      }),
    });

    const customDefault = {
      latitude: 51.5074,
      longitude: -0.1278,
    };

    const { result } = renderHook(() =>
      useUserLocation({
        autoRequest: true,
        defaultLocation: customDefault,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/location");
    // Hook must preserve custom configured defaultLocation, not server's default coordinates
    expect(result.current.location).toEqual(customDefault);
    // Source must remain "default", not "ip"
    expect(result.current.source).toBe("default");
    // Must not show server's hardcoded San Francisco name for custom coordinates
    expect(result.current.locationName).toBeNull();
  });

  it("updates coordinates when setManualLocation is called", () => {
    const { result } = renderHook(() =>
      useUserLocation({ autoRequest: false }),
    );

    act(() => {
      result.current.setManualLocation(51.5074, -0.1278, "London, UK");
    });

    expect(result.current.location).toEqual({
      latitude: 51.5074,
      longitude: -0.1278,
    });
    expect(result.current.locationName).toBe("London, UK");
    expect(result.current.source).toBe("manual");
  });

  it("resolves and sets location via resolvePostalOrCity", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          lat: "47.6062",
          lon: "-122.3321",
          display_name: "Seattle, WA, USA",
        },
      ],
    });

    const { result } = renderHook(() =>
      useUserLocation({ autoRequest: false }),
    );

    let res;
    await act(async () => {
      res = await result.current.resolvePostalOrCity("Seattle");
    });

    expect(res).toEqual({
      lat: 47.6062,
      lng: -122.3321,
      displayName: "Seattle, WA, USA",
    });
    expect(result.current.location).toEqual({
      latitude: 47.6062,
      longitude: -122.3321,
    });
    expect(result.current.locationName).toBe("Seattle, WA, USA");
  });
});
