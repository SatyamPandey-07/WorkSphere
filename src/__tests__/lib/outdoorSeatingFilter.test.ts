/**
 * Tests for the outdoor seating filter logic (Issue #1854).
 * Filters venues where patioOnly=true OR amenities.patio is truthy.
 */

import type { MapMarker } from "@/types/map";

function filterOutdoorSeating(markers: MapMarker[]): MapMarker[] {
  return markers.filter((m) => m.patioOnly || m.amenities?.patio);
}

const MARKERS: Partial<MapMarker>[] = [
  { id: "v1", name: "Rooftop Bar",     patioOnly: true,  amenities: {} },
  { id: "v2", name: "Garden Café",     patioOnly: false, amenities: { patio: true } },
  { id: "v3", name: "Indoor Cowork",   patioOnly: false, amenities: { patio: false } },
  { id: "v4", name: "Library",         patioOnly: false, amenities: {} },
  { id: "v5", name: "Mixed Venue",     patioOnly: true,  amenities: { patio: true } },
];

describe("Outdoor seating filter", () => {
  it("includes venues where patioOnly=true", () => {
    const result = filterOutdoorSeating(MARKERS as MapMarker[]);
    expect(result.some((m) => m.id === "v1")).toBe(true);
  });

  it("includes venues where amenities.patio=true", () => {
    const result = filterOutdoorSeating(MARKERS as MapMarker[]);
    expect(result.some((m) => m.id === "v2")).toBe(true);
  });

  it("includes venues where both patioOnly and patio are true", () => {
    const result = filterOutdoorSeating(MARKERS as MapMarker[]);
    expect(result.some((m) => m.id === "v5")).toBe(true);
  });

  it("excludes venues with no outdoor seating", () => {
    const result = filterOutdoorSeating(MARKERS as MapMarker[]);
    expect(result.some((m) => m.id === "v3")).toBe(false);
    expect(result.some((m) => m.id === "v4")).toBe(false);
  });

  it("returns exactly 3 outdoor venues from test data", () => {
    const result = filterOutdoorSeating(MARKERS as MapMarker[]);
    expect(result).toHaveLength(3);
  });

  it("returns empty array when no venues have outdoor seating", () => {
    const indoor = [
      { id: "x1", name: "Office", patioOnly: false, amenities: { patio: false } },
    ] as MapMarker[];
    expect(filterOutdoorSeating(indoor)).toHaveLength(0);
  });

  it("returns all venues when all have outdoor seating", () => {
    const all = [
      { id: "x1", patioOnly: true,  amenities: {} },
      { id: "x2", patioOnly: false, amenities: { patio: true } },
    ] as MapMarker[];
    expect(filterOutdoorSeating(all)).toHaveLength(2);
  });
});
