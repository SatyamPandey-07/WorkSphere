import {
  venueToVector,
  venuesToVectors,
  deduplicateVectors,
  padWithNeutralVectors,
} from "../../../lib/kmeans/vectorUtils";
import { KMEANS_DIMENSIONS } from "../../../lib/kmeans/types";

describe("Venue-to-Vector Utilities", () => {
  describe("venueToVector", () => {
    it("converts a full venue to a normalized vector", () => {
      const venue = {
        wifiQuality: 8,
        hasOutlets: true,
        outletDensity: "every_table",
        noiseLevel: "quiet",
        hasErgonomic: true,
        hasPhoneBooths: false,
        hasNoMusic: true,
        hasQuietZone: true,
        hasAncHeadsetRental: false,
        lighting: "bright",
        currentOccupancy: 30,
        rating: 4.5,
      };

      const vector = venueToVector(venue);
      expect(vector.wifiQuality).toBeCloseTo(0.8, 5);
      expect(vector.hasOutlets).toBe(1);
      expect(vector.outletDensity).toBeCloseTo(1.0, 5);
      expect(vector.noiseLevel).toBeCloseTo(1.0, 5);
      expect(vector.hasErgonomic).toBe(1);
      expect(vector.hasPhoneBooths).toBe(0);
      expect(vector.hasNoMusic).toBe(1);
      expect(vector.hasQuietZone).toBe(1);
      expect(vector.hasAncHeadsetRental).toBe(0);
      expect(vector.lighting).toBeCloseTo(1.0, 5);
      expect(vector.currentOccupancy).toBeCloseTo(0.3, 5);
      expect(vector.rating).toBeCloseTo(0.9, 5);
    });

    it("uses default values for missing fields", () => {
      const vector = venueToVector({});
      expect(vector.wifiQuality).toBeCloseTo(0.5, 5);
      expect(vector.hasOutlets).toBe(0);
      expect(vector.noiseLevel).toBeCloseTo(0.5, 5);
      expect(vector.rating).toBeCloseTo(0.6, 5);
    });

    it("handles null values gracefully", () => {
      const vector = venueToVector({
        wifiQuality: null,
        hasOutlets: null,
        noiseLevel: null,
        rating: null,
      });
      expect(vector.wifiQuality).toBeCloseTo(0.5, 5);
      expect(vector.hasOutlets).toBe(0);
      expect(vector.noiseLevel).toBeCloseTo(0.5, 5);
      expect(vector.rating).toBeCloseTo(0.6, 5);
    });

    it("normalizes all dimensions to [0, 1]", () => {
      const venue = {
        wifiQuality: 10,
        hasOutlets: true,
        outletDensity: "every_table",
        noiseLevel: "loud",
        hasErgonomic: true,
        hasPhoneBooths: true,
        hasNoMusic: true,
        hasQuietZone: true,
        hasAncHeadsetRental: true,
        lighting: "dim",
        currentOccupancy: 100,
        rating: 5,
      };
      const vector = venueToVector(venue);
      for (const dim of KMEANS_DIMENSIONS) {
        expect(vector[dim]).toBeGreaterThanOrEqual(0);
        expect(vector[dim]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("venuesToVectors", () => {
    it("converts multiple venues", () => {
      const venues = [
        { id: "v1", wifiQuality: 8, hasOutlets: true },
        { id: "v2", wifiQuality: 2, hasOutlets: false },
      ];
      const result = venuesToVectors(venues);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("v1");
      expect(result[1].id).toBe("v2");
    });

    it("skips venues without IDs", () => {
      const venues = [
        { id: "v1", wifiQuality: 8 },
        { id: "", wifiQuality: 2 },
      ];
      expect(venuesToVectors(venues)).toHaveLength(1);
    });

    it("returns empty array for empty input", () => {
      expect(venuesToVectors([])).toEqual([]);
    });
  });

  describe("deduplicateVectors", () => {
    it("removes duplicate vectors", () => {
      const items = [
        { id: "a", vector: venueToVector({ wifiQuality: 8 }) },
        { id: "b", vector: venueToVector({ wifiQuality: 8 }) },
        { id: "c", vector: venueToVector({ wifiQuality: 2 }) },
      ];
      const result = deduplicateVectors(items);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a");
      expect(result[1].id).toBe("c");
    });
  });

  describe("padWithNeutralVectors", () => {
    it("returns same array if already has enough vectors", () => {
      const vectors = [venueToVector({ wifiQuality: 8 })];
      expect(padWithNeutralVectors(vectors, 1)).toHaveLength(1);
    });

    it("pads with neutral vectors to reach target count", () => {
      expect(
        padWithNeutralVectors([venueToVector({ wifiQuality: 8 })], 5),
      ).toHaveLength(5);
    });

    it("neutral vectors are in valid range", () => {
      const result = padWithNeutralVectors([], 10);
      expect(result).toHaveLength(10);
      for (const v of result) {
        for (const dim of KMEANS_DIMENSIONS) {
          expect(v[dim]).toBeGreaterThanOrEqual(0);
          expect(v[dim]).toBeLessThanOrEqual(1);
        }
      }
    });

    it("is deterministic", () => {
      expect(padWithNeutralVectors([], 5)).toEqual(
        padWithNeutralVectors([], 5),
      );
    });
  });
});
