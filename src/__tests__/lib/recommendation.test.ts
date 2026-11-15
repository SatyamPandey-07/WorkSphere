import { cosineSimilarity } from "@/lib/cosineSimilarity";
import { buildUserPreferenceVector } from "@/lib/preferenceVector";
import { rerankVenues } from "@/lib/recommendation";
import { Venue } from "@/components/chat/ChatMessages";

describe("recommendation math and vectors", () => {
  describe("cosineSimilarity", () => {
    it("scores identical vectors near 1", () => {
      const vec = { wifi: 1, quiet: 1, coffee: 0 };
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
    });

    it("scores orthogonal vectors near 0", () => {
      const vec1 = { wifi: 1, quiet: 0 };
      const vec2 = { wifi: 0, quiet: 1 };
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0);
    });

    it("handles zero vectors gracefully", () => {
      const vecZero = { wifi: 0, quiet: 0 };
      const vec1 = { wifi: 1, quiet: 1 };
      expect(cosineSimilarity(vecZero, vec1)).toBe(0);
      expect(cosineSimilarity(vecZero, vecZero)).toBe(0);
    });

    it("handles null, undefined, and non-object inputs safely", () => {
      expect(cosineSimilarity(null, null)).toBe(0);
      expect(cosineSimilarity(undefined, { wifi: 1 })).toBe(0);
      expect(cosineSimilarity({ wifi: 1 }, null)).toBe(0);
      expect(cosineSimilarity("not an object" as any, { wifi: 1 })).toBe(0);
    });

    it("sanitizes NaN and non-finite numbers in vector values", () => {
      const vecNaN = { wifi: NaN, quiet: Infinity, coffee: 1 };
      const vecValid = { wifi: 1, quiet: 0, coffee: 1 };
      expect(Number.isNaN(cosineSimilarity(vecNaN, vecValid))).toBe(false);
      expect(cosineSimilarity(vecNaN, vecValid)).toBeCloseTo(0.707, 2);
    });

    it("clamps floating point values strictly to [-1, 1]", () => {
      const vec = { a: 1.0000000000000002 };
      const score = cosineSimilarity(vec, vec);
      expect(score).toBeLessThanOrEqual(1);
      expect(score).toBeGreaterThanOrEqual(-1);
    });
  });

  describe("preferenceVector", () => {
    it("builds and normalizes user preference vector", () => {
      const mockHistory = [
        {
          venue: {
            id: "1",
            name: "v1",
            lat: 0,
            lng: 0,
            category: "cafe",
            wifi: true,
            noiseLevel: "quiet",
            hasOutlets: false,
          } as Venue,
          weight: 1,
        },
        {
          venue: {
            id: "2",
            name: "v2",
            lat: 0,
            lng: 0,
            category: "coworking",
            wifi: true,
            noiseLevel: "moderate",
            hasOutlets: true,
          } as Venue,
          weight: 0.5,
        },
      ];

      const vec = buildUserPreferenceVector(mockHistory);
      // wifi total weight: 1.5, max weight is 1.5 -> wifi = 1.0
      // quiet total weight: 1.0 -> quiet = 1.0 / 1.5 = 0.666
      // outlets total weight: 0.5 -> outlets = 0.5 / 1.5 = 0.333
      // coffee total weight: 1.0 -> coffee = 1.0 / 1.5 = 0.666

      expect(vec.wifi).toBeCloseTo(1.0);
      expect(vec.quiet).toBeCloseTo(0.666, 2);
      expect(vec.powerOutlets).toBeCloseTo(0.333, 2);
      expect(vec.coffee).toBeCloseTo(0.666, 2);
    });

    it("handles null, undefined, and empty history gracefully", () => {
      const emptyAggregated = {
        wifi: 0,
        quiet: 0,
        powerOutlets: 0,
        coffee: 0,
        parking: 0,
        meetingRooms: 0,
      };
      expect(buildUserPreferenceVector(null)).toEqual(emptyAggregated);
      expect(buildUserPreferenceVector(undefined)).toEqual(emptyAggregated);
      expect(buildUserPreferenceVector([])).toEqual(emptyAggregated);
    });

    it("handles corrupt items and missing venue names without throwing", () => {
      const corruptHistory: any[] = [
        null,
        undefined,
        { venue: null },
        {
          venue: {
            id: "no-name",
            category: "coworking",
            wifi: true,
            noiseLevel: "quiet",
          },
          weight: 1.0,
        },
      ];

      const vec = buildUserPreferenceVector(corruptHistory);
      expect(vec.wifi).toBe(1.0);
      expect(vec.quiet).toBe(1.0);
      expect(vec.coffee).toBe(0);
    });

    it("sanitizes NaN, negative, and missing weights safely", () => {
      const historyWithBadWeights = [
        {
          venue: {
            id: "1",
            name: "Good Cafe",
            category: "cafe",
            wifi: true,
          } as Venue,
          weight: 1.0,
        },
        {
          venue: {
            id: "2",
            name: "NaN Weight Place",
            wifi: true,
          } as Venue,
          weight: NaN,
        },
        {
          venue: {
            id: "3",
            name: "Negative Weight Place",
            wifi: true,
          } as Venue,
          weight: -5,
        },
        {
          venue: {
            id: "4",
            name: "Unspecified Weight Place",
            noiseLevel: "quiet",
          } as Venue,
          weight: undefined as any,
        },
      ];

      const vec = buildUserPreferenceVector(historyWithBadWeights);
      expect(Number.isNaN(vec.wifi)).toBe(false);
      expect(vec.wifi).toBe(1.0);
      expect(vec.quiet).toBe(1.0);
    });
  });

  describe("rerankVenues", () => {
    it("reranks venues based on similarity and flags recommended", () => {
      const userVec = { wifi: 1, quiet: 1, powerOutlets: 1, coffee: 1 };

      const v1 = {
        id: "1",
        name: "Cafe",
        lat: 0,
        lng: 0,
        category: "cafe",
        wifi: true,
        noiseLevel: "quiet",
        hasOutlets: true,
      } as Venue;
      const v2 = {
        id: "2",
        name: "Park",
        lat: 0,
        lng: 0,
        category: "park",
        wifi: false,
        noiseLevel: "quiet",
        hasOutlets: false,
      } as Venue;
      const v3 = {
        id: "3",
        name: "NoWifiTech",
        lat: 0,
        lng: 0,
        category: "coworking",
        wifi: false,
        noiseLevel: "moderate",
        hasOutlets: true,
      } as Venue;

      const reranked = rerankVenues([v2, v3, v1], userVec, 0.85);

      expect(reranked[0].id).toBe("1");
      expect(reranked[0].isRecommended).toBe(true); // Exact match -> score 1

      expect(reranked[1].isRecommended).toBe(false);
      expect(reranked[2].isRecommended).toBe(false);
    });

    it("returns original order if user vector is all zeros", () => {
      const userVec = { wifi: 0, quiet: 0 };
      const v1 = {
        id: "1",
        name: "v1",
        lat: 0,
        lng: 0,
        category: "cafe",
      } as Venue;
      const v2 = {
        id: "2",
        name: "v2",
        lat: 0,
        lng: 0,
        category: "cafe",
      } as Venue;

      const reranked = rerankVenues([v1, v2], userVec);
      expect(reranked[0].id).toBe("1");
      expect(reranked[1].id).toBe("2");
    });

    it("handles nullish venues and user vectors gracefully", () => {
      expect(rerankVenues(null, {})).toEqual([]);
      expect(rerankVenues(undefined, {})).toEqual([]);

      const v = { id: "1", name: "v" } as Venue;
      expect(rerankVenues([v], null)).toHaveLength(1);
      expect(rerankVenues([v], undefined)).toHaveLength(1);
    });

    it("breaks ties deterministically using secondary score and tertiary ID", () => {
      const userVec = { wifi: 1 };
      const vA = { id: "venue-b", name: "B", wifi: true, score: 4.5 } as Venue;
      const vB = { id: "venue-a", name: "A", wifi: true, score: 4.5 } as Venue;
      const vC = { id: "venue-c", name: "C", wifi: true, score: 4.8 } as Venue;

      const reranked = rerankVenues([vA, vB, vC], userVec);
      expect(reranked[0].id).toBe("venue-c");
      expect(reranked[1].id).toBe("venue-a");
      expect(reranked[2].id).toBe("venue-b");
    });
  });
});
