import { renderHook, act, waitFor } from "@testing-library/react";
import { useTransitRouting } from "@/hooks/useTransitRouting";

const ORIGIN = { lat: 40.7128, lng: -74.006 };
const DEST = { lat: 40.758, lng: -73.985 };

describe("useTransitRouting", () => {
  it("starts with 'walking' profile", () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: ORIGIN, destination: DEST }),
    );
    expect(result.current.activeProfile).toBe("walking");
    expect(result.current.transitRoute).toBeNull();
  });

  it("returns null transitRoute for non-transit profiles", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: ORIGIN, destination: DEST }),
    );

    await act(async () => { await result.current.selectProfile("cycling"); });
    expect(result.current.transitRoute).toBeNull();
    expect(result.current.activeProfile).toBe("cycling");
  });

  it("estimates transitRoute for 'transit' profile", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: ORIGIN, destination: DEST }),
    );

    await act(async () => { await result.current.selectProfile("transit"); });

    await waitFor(() => {
      expect(result.current.transitRoute).not.toBeNull();
    });

    expect(result.current.transitRoute!.profile).toBe("transit");
    expect(result.current.transitRoute!.durationMinutes).toBeGreaterThan(0);
    expect(result.current.transitRoute!.distanceKm).toBeGreaterThan(0);
    expect(result.current.transitRoute!.summary).toMatch(/min by transit/i);
  });

  it("includes 5-minute boarding buffer in duration", async () => {
    // Very close points: straight-line < 1 km
    const veryClose = { lat: 40.712, lng: -74.005 };
    const { result } = renderHook(() =>
      useTransitRouting({ origin: ORIGIN, destination: veryClose }),
    );

    await act(async () => { await result.current.selectProfile("transit"); });
    await waitFor(() => {
      expect(result.current.transitRoute).not.toBeNull();
    });

    // Even for very short distances, duration should be at least 5 minutes
    expect(result.current.transitRoute!.durationMinutes).toBeGreaterThanOrEqual(5);
  });

  it("returns null when origin is null", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: null, destination: DEST }),
    );

    await act(async () => { await result.current.selectProfile("transit"); });
    expect(result.current.transitRoute).toBeNull();
  });

  it("clears transit route when switching away from transit", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: ORIGIN, destination: DEST }),
    );

    await act(async () => { await result.current.selectProfile("transit"); });
    await waitFor(() => { expect(result.current.transitRoute).not.toBeNull(); });

    await act(async () => { await result.current.selectProfile("walking"); });
    expect(result.current.transitRoute).toBeNull();
  });
});
