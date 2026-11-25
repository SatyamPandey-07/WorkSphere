import {
  MeetingOptimizer,
  type CandidateVenue,
} from "@/core/ai/MeetingOptimizer";

describe("MeetingOptimizer Pareto Frontier Deterministic Tie-Breaking (#10426)", () => {
  let optimizer: MeetingOptimizer;

  beforeEach(() => {
    optimizer = new MeetingOptimizer("dummy-groq-key");
  });

  describe("Equal Scores & Multi-Tier Tie-Breaking Precedence", () => {
    it("breaks ties by individual objective priority when aggregate totals are equal", () => {
      // Both have total score = 180 (70 + 60 + 50 vs 65 + 65 + 50)
      const venueA: CandidateVenue = {
        id: "v-higher-travel",
        name: "Higher Travel Venue",
        travelFairness: 70,
        wifiReliability: 60,
        acousticQuietness: 50,
      };
      const venueB: CandidateVenue = {
        id: "v-lower-travel",
        name: "Lower Travel Venue",
        travelFairness: 65,
        wifiReliability: 65,
        acousticQuietness: 50,
      };

      const result = optimizer.rankVenuesPareto([venueB, venueA]);
      expect(result.paretoFrontier).toHaveLength(2);
      // travelFairness takes precedence in tie-breaking
      expect(result.paretoFrontier[0].id).toBe("v-higher-travel");
      expect(result.paretoFrontier[1].id).toBe("v-lower-travel");
    });

    it("breaks ties by secondary objective (wifiReliability) when total and travelFairness match", () => {
      // Both have total score = 200, travelFairness = 80
      const venueA: CandidateVenue = {
        id: "v-higher-wifi",
        name: "Higher WiFi Venue",
        travelFairness: 80,
        wifiReliability: 70,
        acousticQuietness: 50,
      };
      const venueB: CandidateVenue = {
        id: "v-lower-wifi",
        name: "Lower WiFi Venue",
        travelFairness: 80,
        wifiReliability: 60,
        acousticQuietness: 60,
      };

      const result = optimizer.rankVenuesPareto([venueB, venueA]);
      expect(result.paretoFrontier).toHaveLength(2);
      expect(result.paretoFrontier[0].id).toBe("v-higher-wifi");
      expect(result.paretoFrontier[1].id).toBe("v-lower-wifi");
    });

    it("uses stable identifier tie-breaking when all objective scores are identical", () => {
      const venue1: CandidateVenue = {
        id: "zeta-venue",
        name: "Zeta Cowork",
        travelFairness: 80,
        wifiReliability: 80,
        acousticQuietness: 80,
      };
      const venue2: CandidateVenue = {
        id: "alpha-venue",
        name: "Alpha Cowork",
        travelFairness: 80,
        wifiReliability: 80,
        acousticQuietness: 80,
      };

      const result = optimizer.rankVenuesPareto([venue1, venue2]);
      expect(result.paretoFrontier).toHaveLength(2);
      // "alpha-venue" precedes "zeta-venue" via localeCompare
      expect(result.paretoFrontier[0].id).toBe("alpha-venue");
      expect(result.paretoFrontier[1].id).toBe("zeta-venue");
    });
  });

  describe("Non-Dominated Trade-Off Preservation", () => {
    it("preserves non-dominated candidates even when one has a lower aggregate score", () => {
      // venue-extreme-quiet has lower aggregate (10 + 10 + 95 = 115) than venue-balanced (40 + 40 + 40 = 120),
      // but venue-balanced does not dominate it because 95 > 40 on acousticQuietness
      const venueExtremeQuiet: CandidateVenue = {
        id: "v-quiet",
        name: "Quiet Library",
        travelFairness: 10,
        wifiReliability: 10,
        acousticQuietness: 95,
      };
      const venueBalanced: CandidateVenue = {
        id: "v-balanced",
        name: "Balanced Space",
        travelFairness: 40,
        wifiReliability: 40,
        acousticQuietness: 40,
      };

      const result = optimizer.rankVenuesPareto([venueExtremeQuiet, venueBalanced]);
      expect(result.paretoFrontier).toHaveLength(2);
      const frontierIds = result.paretoFrontier.map((v) => v.id);
      expect(frontierIds).toContain("v-quiet");
      expect(frontierIds).toContain("v-balanced");
      expect(result.dominatedVenues).toHaveLength(0);
    });
  });

  describe("Missing and Invalid Objective Value Sanitization", () => {
    it("safely coerces null, undefined, NaN, and non-numeric values to 0", () => {
      expect(optimizer.sanitizeObjective(undefined)).toBe(0);
      expect(optimizer.sanitizeObjective(null)).toBe(0);
      expect(optimizer.sanitizeObjective(NaN)).toBe(0);
      expect(optimizer.sanitizeObjective("invalid-string")).toBe(0);
      expect(optimizer.sanitizeObjective(Infinity)).toBe(0);
      expect(optimizer.sanitizeObjective(75.5)).toBe(75.5);
    });

    it("correctly allows valid candidates to dominate candidates with invalid/missing metrics", () => {
      const venueInvalid: CandidateVenue = {
        id: "v-missing",
        name: "Missing Data Venue",
        travelFairness: undefined,
        wifiReliability: NaN,
        acousticQuietness: null as any,
      };
      const venueValid: CandidateVenue = {
        id: "v-valid",
        name: "Valid Minimal Venue",
        travelFairness: 1,
        wifiReliability: 1,
        acousticQuietness: 1,
      };

      const result = optimizer.rankVenuesPareto([venueInvalid, venueValid]);
      expect(result.paretoFrontier.map((v) => v.id)).toEqual(["v-valid"]);
      expect(result.dominatedVenues.map((v) => v.id)).toEqual(["v-missing"]);
    });
  });

  describe("Permutation Independence & Stable Ordering", () => {
    it("guarantees identical Pareto ranking across all input permutations", () => {
      const candidates: CandidateVenue[] = [
        { id: "c1", name: "C1", travelFairness: 90, wifiReliability: 50, acousticQuietness: 70 },
        { id: "c2", name: "C2", travelFairness: 60, wifiReliability: 95, acousticQuietness: 75 },
        { id: "c3", name: "C3", travelFairness: 50, wifiReliability: 50, acousticQuietness: 50 }, // Dominated
        { id: "c4", name: "C4", travelFairness: 75, wifiReliability: 75, acousticQuietness: 85 },
        { id: "c5", name: "C5", travelFairness: 75, wifiReliability: 75, acousticQuietness: 85 }, // Duplicate scores of C4
      ];

      // Multiple permutations of the candidate array
      const perm1 = [...candidates];
      const perm2 = [candidates[4], candidates[2], candidates[0], candidates[3], candidates[1]];
      const perm3 = [candidates[1], candidates[3], candidates[4], candidates[0], candidates[2]];

      const res1 = optimizer.rankVenuesPareto(perm1);
      const res2 = optimizer.rankVenuesPareto(perm2);
      const res3 = optimizer.rankVenuesPareto(perm3);

      expect(res1.paretoFrontier.map((v) => v.id)).toEqual(res2.paretoFrontier.map((v) => v.id));
      expect(res2.paretoFrontier.map((v) => v.id)).toEqual(res3.paretoFrontier.map((v) => v.id));

      expect(res1.dominatedVenues.map((v) => v.id)).toEqual(res2.dominatedVenues.map((v) => v.id));
      expect(res1.rankedVenues.map((v) => v.id)).toEqual(res2.rankedVenues.map((v) => v.id));
    });
  });
});
