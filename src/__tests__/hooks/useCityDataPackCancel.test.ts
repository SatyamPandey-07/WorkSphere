import { renderHook, act, waitFor } from "@testing-library/react";
import { useCityDataPack } from "@/hooks/useCityDataPack";

// Mock with a controllable delay
const resolveDelay = { value: 0 };
global.fetch = jest.fn().mockImplementation(
  () => new Promise((resolve) => setTimeout(() => resolve({
    ok: true,
    json: async () => ({
      venues: Array.from({ length: 5 }, (_, i) => ({
        id: `v${i}`, name: `Venue ${i}`, latitude: 40.71, longitude: -74.0
      }))
    })
  }), resolveDelay.value)),
);

jest.mock("@/lib/offlineStorage", () => ({
  saveVenueOffline: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resolveDelay.value = 0;
});

describe("useCityDataPack cancel", () => {
  it("cancel() sets status back to 'idle'", async () => {
    resolveDelay.value = 100; // slow fetch
    const { result } = renderHook(() => useCityDataPack());

    // Start download
    const downloadPromise = act(async () => {
      result.current.downloadCityPack("NYC", { lat: 40.71, lng: -74.0 });
    });

    // Cancel while downloading
    act(() => { result.current.cancel(); });

    expect(result.current.status).toBe("idle");
    await downloadPromise;
  });

  it("cancel() can be called before starting download", () => {
    const { result } = renderHook(() => useCityDataPack());
    expect(() => act(() => { result.current.cancel(); })).not.toThrow();
    expect(result.current.status).toBe("idle");
  });

  it("starting a new download after cancel works", async () => {
    resolveDelay.value = 0;
    const { result } = renderHook(() => useCityDataPack());

    act(() => { result.current.cancel(); }); // pre-cancel

    await act(async () => {
      await result.current.downloadCityPack("Berlin", { lat: 52.52, lng: 13.4 });
    });

    expect(result.current.status).toBe("complete");
  });
});
