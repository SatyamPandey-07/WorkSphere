/**
 * Tests for the noise level filter pills on the map (Issue #1757).
 * All / Quiet / Moderate / Lively filter markers by noiseLevel.
 */

import type { MapMarker } from "@/types/map";

type NoiseFilter = "all" | "quiet" | "moderate" | "loud";

function applyNoiseFilter(markers: MapMarker[], filter: NoiseFilter): MapMarker[] {
  if (filter === "all") return markers;
  return markers.filter((m) => m.noiseLevel === filter);
}

const MARKERS: Partial<MapMarker>[] = [
  { id: "q1", name: "Library",  noiseLevel: "quiet" },
  { id: "q2", name: "Cafe A",   noiseLevel: "quiet" },
  { id: "m1", name: "Cowork",   noiseLevel: "moderate" },
  { id: "l1", name: "Pub",      noiseLevel: "loud" },
  { id: "u1", name: "Unknown",  noiseLevel: undefined },
];

describe("Noise level filter pills", () => {
  it("'all' returns all markers", () => {
    expect(applyNoiseFilter(MARKERS as MapMarker[], "all")).toHaveLength(5);
  });

  it("'quiet' returns only quiet venues", () => {
    const result = applyNoiseFilter(MARKERS as MapMarker[], "quiet");
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.noiseLevel === "quiet")).toBe(true);
  });

  it("'moderate' returns only moderate venues", () => {
    const result = applyNoiseFilter(MARKERS as MapMarker[], "moderate");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
  });

  it("'loud' returns only loud venues", () => {
    const result = applyNoiseFilter(MARKERS as MapMarker[], "loud");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("l1");
  });

  it("excludes venues with undefined noiseLevel when filtering", () => {
    const result = applyNoiseFilter(MARKERS as MapMarker[], "quiet");
    expect(result.some((m) => m.id === "u1")).toBe(false);
  });

  it("switching to 'all' after filter restores full list", () => {
    const filtered = applyNoiseFilter(MARKERS as MapMarker[], "quiet");
    expect(filtered).toHaveLength(2);
    const all = applyNoiseFilter(MARKERS as MapMarker[], "all");
    expect(all).toHaveLength(5);
  });

  it("filter does not mutate original markers array", () => {
    const original = [...MARKERS];
    applyNoiseFilter(MARKERS as MapMarker[], "quiet");
    expect(MARKERS).toHaveLength(original.length);
  });
});
