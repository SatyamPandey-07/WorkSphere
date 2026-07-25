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
  });
});
