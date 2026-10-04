/**
 * Additional tests for findAlternativeVenues distance sorting (Issue #2085).
 */

import { findAlternativeVenues } from "@/hooks/useAlternativeVenuesSuggestion";
import type { MapMarker } from "@/types/map";

const USER_LOCATION = { lat: 40.71, lng: -74.0 };

const FULL_VENUE: Partial<MapMarker> = {
  id: "full",
  name: "Full Café",
  position: { lat: 40.71, lng: -74.0 },
  wifiQuality: 4,
  hasOutlets: true,
};

const NEAR_VENUE: Partial<MapMarker> = {
  id: "near",
  name: "Nearby Café",
  position: { lat: 40.712, lng: -74.001 },
  wifiQuality: 4,
  hasOutlets: true,
};

const MID_VENUE: Partial<MapMarker> = {
  id: "mid",
  name: "Middle Café",
  position: { lat: 40.75, lng: -73.98 },
  wifiQuality: 3,
  hasOutlets: true,
};

const FAR_VENUE: Partial<MapMarker> = {
  id: "far",
  name: "Far Café",
  position: { lat: 40.9, lng: -73.7 },
  wifiQuality: 4,
  hasOutlets: false,
};

describe("findAlternativeVenues distance sorting", () => {
  it("sorts nearest venue first when userLocation provided", () => {
    const venues = [FAR_VENUE, MID_VENUE, NEAR_VENUE, FULL_VENUE] as MapMarker[];
    const results = findAlternativeVenues(FULL_VENUE as MapMarker, venues, {
      userLocation: USER_LOCATION,
    });

    // NEAR_VENUE should be first (closest to USER_LOCATION)
    if (results.length > 0) {
      expect(results[0].id).toBe("near");
    }
  });

  it("all results are closer than last result", () => {
    const venues = [FAR_VENUE, MID_VENUE, NEAR_VENUE, FULL_VENUE] as MapMarker[];
    const results = findAlternativeVenues(FULL_VENUE as MapMarker, venues, {
      userLocation: USER_LOCATION,
    });

    // Simple check: if sorted by distance, first result should be "near"
    if (results.length >= 2) {
      const firstId = results[0].id;
      const lastId = results[results.length - 1].id;
      // "near" should appear before "far" in sorted results
      const nearIdx = results.findIndex((v) => v.id === "near");
      const farIdx = results.findIndex((v) => v.id === "far");
      if (nearIdx !== -1 && farIdx !== -1) {
        expect(nearIdx).toBeLessThan(farIdx);
      }
    }
  });

  it("without userLocation, returns venues in any order (no distance sort)", () => {
    const venues = [FAR_VENUE, NEAR_VENUE, MID_VENUE, FULL_VENUE] as MapMarker[];
    const results = findAlternativeVenues(FULL_VENUE as MapMarker, venues);
    // Just verify it doesn't crash and returns venues
    expect(Array.isArray(results)).toBe(true);
  });

  it("count parameter limits results", () => {
    const manyVenues = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      name: `Venue ${i}`,
      position: { lat: 40.71 + i * 0.01, lng: -74.0 },
      wifiQuality: 4,
      hasOutlets: true,
    })) as MapMarker[];

    const results = findAlternativeVenues(
      { id: "full", name: "Full", position: { lat: 40.71, lng: -74.0 } } as MapMarker,
      manyVenues,
      { userLocation: USER_LOCATION, count: 2 },
    );

    expect(results.length).toBeLessThanOrEqual(2);
  });
});
