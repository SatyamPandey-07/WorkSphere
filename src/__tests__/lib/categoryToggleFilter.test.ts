/**
 * Tests for the category toggle filter pills on the map (Issue #2089).
 * All / Café / Library / Coworking filter markers by category.
 */

import type { MapMarker } from "@/types/map";

function applyCategoryFilter(markers: MapMarker[], filter: string): MapMarker[] {
  if (filter === "all") return markers;
  return markers.filter((m) => m.category?.toLowerCase() === filter);
}

const MARKERS: Partial<MapMarker>[] = [
  { id: "c1", name: "Daily Grind",    category: "cafe" },
  { id: "c2", name: "Roasted Bean",   category: "cafe" },
  { id: "l1", name: "City Library",   category: "library" },
  { id: "w1", name: "WeWork Hub",     category: "coworking" },
  { id: "x1", name: "Unnamed",        category: undefined },
];

describe("Category filter pills", () => {
  it("'all' returns all markers including undefined category", () => {
    expect(applyCategoryFilter(MARKERS as MapMarker[], "all")).toHaveLength(5);
  });

  it("'cafe' returns only café venues", () => {
    const result = applyCategoryFilter(MARKERS as MapMarker[], "cafe");
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.category === "cafe")).toBe(true);
  });

  it("'library' returns only library venues", () => {
    const result = applyCategoryFilter(MARKERS as MapMarker[], "library");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("l1");
  });

  it("'coworking' returns only coworking venues", () => {
    const result = applyCategoryFilter(MARKERS as MapMarker[], "coworking");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("w1");
  });

  it("unknown category filter returns empty array", () => {
    const result = applyCategoryFilter(MARKERS as MapMarker[], "gym");
    expect(result).toHaveLength(0);
  });

  it("case-insensitive category matching", () => {
    const mixedCase = [{ id: "c1", name: "Cafe", category: "Cafe" }] as MapMarker[];
    const result = applyCategoryFilter(mixedCase, "cafe");
    expect(result).toHaveLength(1);
  });

  it("switching between filters correctly updates results", () => {
    const cafeResult = applyCategoryFilter(MARKERS as MapMarker[], "cafe");
    const libResult = applyCategoryFilter(MARKERS as MapMarker[], "library");
    expect(cafeResult).not.toEqual(libResult);
    expect(cafeResult.length).toBeGreaterThan(libResult.length);
  });
});
