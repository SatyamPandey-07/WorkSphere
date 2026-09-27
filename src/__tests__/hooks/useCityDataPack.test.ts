import { renderHook, act, waitFor } from "@testing-library/react";
import { useCityDataPack } from "@/hooks/useCityDataPack";

// Mock offlineStorage
jest.mock("@/lib/offlineStorage", () => ({
  saveVenueOffline: jest.fn().mockResolvedValue(undefined),
}));

const mockVenues = [
  { id: "v1", name: "Café A", latitude: 48.85, longitude: 2.34 },
  { id: "v2", name: "Café B", latitude: 48.86, longitude: 2.35 },
];

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ venues: mockVenues }),
  });
});

describe("useCityDataPack", () => {
  it("starts with status='idle'", () => {
    const { result } = renderHook(() => useCityDataPack());
    expect(result.current.status).toBe("idle");
    expect(result.current.downloadedCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("sets status to 'downloading' while fetching", async () => {
    // Delay the fetch response
    global.fetch = jest.fn().mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() =>
        resolve({ ok: true, json: async () => ({ venues: mockVenues }) }), 100),
      ),
    );

    const { result } = renderHook(() => useCityDataPack());

    act(() => {
      result.current.downloadCityPack("Paris", { lat: 48.85, lng: 2.35 });
    });

    expect(result.current.status).toBe("downloading");
  });

  it("sets status to 'complete' after successful download", async () => {
    const { result } = renderHook(() => useCityDataPack());

    await act(async () => {
      await result.current.downloadCityPack("Paris", { lat: 48.85, lng: 2.35 });
    });

    expect(result.current.status).toBe("complete");
    expect(result.current.downloadedCount).toBe(mockVenues.length);
    expect(result.current.totalCount).toBe(mockVenues.length);
  });

  it("calls saveVenueOffline for each venue", async () => {
    const { saveVenueOffline } = require("@/lib/offlineStorage");
    const { result } = renderHook(() => useCityDataPack());

    await act(async () => {
      await result.current.downloadCityPack("Paris", { lat: 48.85, lng: 2.35 });
    });

    expect(saveVenueOffline).toHaveBeenCalledTimes(mockVenues.length);
  });

  it("sets status to 'error' when fetch fails", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("Network error"));
    const { result } = renderHook(() => useCityDataPack());

    await act(async () => {
      await result.current.downloadCityPack("NYC", { lat: 40.71, lng: -74.0 });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/network error/i);
  });

  it("sets status to 'error' when API returns non-OK status", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const { result } = renderHook(() => useCityDataPack());

    await act(async () => {
      await result.current.downloadCityPack("Tokyo", { lat: 35.68, lng: 139.69 });
    });

    expect(result.current.status).toBe("error");
  });
});
