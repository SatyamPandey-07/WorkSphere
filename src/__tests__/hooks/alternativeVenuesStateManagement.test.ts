import { renderHook, act } from "@testing-library/react";
import { useAlternativeVenuesSuggestion } from "@/hooks/useAlternativeVenuesSuggestion";
import type { MapMarker } from "@/types/map";

function makeVenue(id: string): MapMarker {
  return {
    id,
    name: `Venue ${id}`,
    position: { lat: 40.71, lng: -74.0 },
    category: "cafe",
    wifiQuality: 4,
    hasOutlets: true,
    amenities: { wifi: true, outlets: true, quiet: false },
  };
}

describe("useAlternativeVenuesSuggestion state management", () => {
  it("starts with isShowing=false and empty alternatives", () => {
    const { result } = renderHook(() => useAlternativeVenuesSuggestion());
    expect(result.current.isShowing).toBe(false);
    expect(result.current.alternatives).toHaveLength(0);
    expect(result.current.fullVenueId).toBeNull();
  });

  it("triggerAlternatives sets isShowing=true with results", () => {
    const { result } = renderHook(() => useAlternativeVenuesSuggestion());
    const fullVenue = makeVenue("full");
    const otherVenues = [makeVenue("v1"), makeVenue("v2"), makeVenue("v3")];

    act(() => {
      result.current.triggerAlternatives(fullVenue, [fullVenue, ...otherVenues]);
    });

    expect(result.current.isShowing).toBe(true);
    expect(result.current.alternatives.length).toBeGreaterThan(0);
  });

  it("triggerAlternatives stores fullVenueId", () => {
    const { result } = renderHook(() => useAlternativeVenuesSuggestion());
    const fullVenue = makeVenue("full-123");
    const others = [makeVenue("v1"), makeVenue("v2")];

    act(() => {
      result.current.triggerAlternatives(fullVenue, [fullVenue, ...others]);
    });

    expect(result.current.fullVenueId).toBe("full-123");
  });

  it("dismiss() resets state", () => {
    const { result } = renderHook(() => useAlternativeVenuesSuggestion());
    const fullVenue = makeVenue("full");
    const others = [makeVenue("v1"), makeVenue("v2")];

    act(() => {
      result.current.triggerAlternatives(fullVenue, [fullVenue, ...others]);
    });

    expect(result.current.isShowing).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.isShowing).toBe(false);
    expect(result.current.alternatives).toHaveLength(0);
    expect(result.current.fullVenueId).toBeNull();
  });

  it("alternatives does not include the full venue itself", () => {
    const { result } = renderHook(() => useAlternativeVenuesSuggestion());
    const fullVenue = makeVenue("full");
    const others = [makeVenue("v1"), makeVenue("v2"), makeVenue("v3")];

    act(() => {
      result.current.triggerAlternatives(fullVenue, [fullVenue, ...others]);
    });

    expect(result.current.alternatives.some((v) => v.id === "full")).toBe(false);
  });
});
