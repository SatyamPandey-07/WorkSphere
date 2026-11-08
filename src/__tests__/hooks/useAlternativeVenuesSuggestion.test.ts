import { findAlternativeVenues } from "@/hooks/useAlternativeVenuesSuggestion";
import { type MapMarker } from "@/types/map";

function makeVenue(id: string, overrides: Partial<MapMarker> = {}): MapMarker {
  return {
    id,
    name: `Venue ${id}`,
    position: { lat: 40.71 + Math.random() * 0.01, lng: -74.0 + Math.random() * 0.01 },
    category: "cafe",
    wifiQuality: 4,
    hasOutlets: true,
    amenities: { wifi: true, outlets: true, quiet: false },
    ...overrides,
  };
}

const fullVenue = makeVenue("full", { wifiQuality: 4, hasOutlets: true });
const nearCafe = makeVenue("near-cafe", {
  position: { lat: 40.711, lng: -74.001 },
  wifiQuality: 4,
  hasOutlets: true,
});
const farCafe = makeVenue("far-cafe", {
  position: { lat: 40.8, lng: -73.9 },
  wifiQuality: 4,
  hasOutlets: true,
});
const noOutletCafe = makeVenue("no-outlet", { hasOutlets: false, wifiQuality: 3 });

const allVenues = [fullVenue, nearCafe, farCafe, noOutletCafe];

describe("findAlternativeVenues", () => {
  it("excludes the full venue from results", () => {
    const results = findAlternativeVenues(fullVenue, allVenues);
    expect(results.some((v) => v.id === fullVenue.id)).toBe(false);
  });

  it("returns up to count alternatives (default 3)", () => {
    const results = findAlternativeVenues(fullVenue, allVenues);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("respects a custom count", () => {
    const manyVenues = Array.from({ length: 10 }, (_, i) => makeVenue(`v${i}`));
    const results = findAlternativeVenues(fullVenue, [fullVenue, ...manyVenues], { count: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("sorts by distance from userLocation when provided", () => {
    const userLocation = { lat: 40.711, lng: -74.001 };
    const results = findAlternativeVenues(fullVenue, allVenues, { userLocation });

    // nearCafe is at (40.711, -74.001) — closest to userLocation
    if (results.length >= 2) {
      expect(results[0].id).toBe("near-cafe");
    }
  });

  it("includes venues with similar amenities (WiFi within 1 level)", () => {
    const results = findAlternativeVenues(fullVenue, allVenues);
    // noOutletCafe has wifiQuality=3 which is within 1 of fullVenue's 4
    expect(results.some((v) => v.id === "no-outlet")).toBe(true);
  });

  it("returns empty array when no other venues exist", () => {
    const results = findAlternativeVenues(fullVenue, [fullVenue]);
    expect(results).toHaveLength(0);
  });

  it("handles empty allVenues array", () => {
    expect(() => findAlternativeVenues(fullVenue, [])).not.toThrow();
    expect(findAlternativeVenues(fullVenue, [])).toHaveLength(0);
  });
});
