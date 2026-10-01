import { renderHook, act, waitFor } from "@testing-library/react";
import { useTransitRouting } from "@/hooks/useTransitRouting";

describe("useTransitRouting null destination handling", () => {
  it("returns null transitRoute when destination is null", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: { lat: 40.71, lng: -74.0 }, destination: null }),
    );

    await act(async () => { await result.current.selectProfile("transit"); });

    expect(result.current.transitRoute).toBeNull();
  });

  it("returns null transitRoute when origin is null", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: null, destination: { lat: 40.71, lng: -74.0 } }),
    );

    await act(async () => { await result.current.selectProfile("transit"); });

    expect(result.current.transitRoute).toBeNull();
  });

  it("returns null transitRoute when both are null", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: null, destination: null }),
    );

    await act(async () => { await result.current.selectProfile("transit"); });

    expect(result.current.transitRoute).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("does not crash when switching to transit with null locations", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: null, destination: null }),
    );

    await expect(
      act(async () => { await result.current.selectProfile("transit"); }),
    ).resolves.not.toThrow();
  });

  it("activeProfile is updated even when locations are null", async () => {
    const { result } = renderHook(() =>
      useTransitRouting({ origin: null, destination: null }),
    );

    await act(async () => { await result.current.selectProfile("cycling"); });
    expect(result.current.activeProfile).toBe("cycling");
  });
});
