import {
  MeetingOptimizer,
  type CandidateVenue,
} from "@/core/ai/MeetingOptimizer";

describe("MeetingOptimizer Multi-Objective Pareto Frontier Ranking", () => {
  let optimizer: MeetingOptimizer;

  beforeEach(() => {
    optimizer = new MeetingOptimizer("dummy-groq-key");
  });

  it("1. filters strictly dominated venues correctly", () => {
    const venues: CandidateVenue[] = [
      {
        id: "venue-superior",
        name: "Superior Cowork",
        travelFairness: 90,
        wifiReliability: 95,
        acousticQuietness: 85,
      },
      {
        id: "venue-inferior",
        name: "Inferior Cowork",
        travelFairness: 80,
        wifiReliability: 90,
        acousticQuietness: 80,
      },
    ];

    const result = optimizer.rankVenuesPareto(venues);

    // venue-superior strictly dominates venue-inferior across all 3 objectives
    expect(result.paretoFrontier.map((v) => v.id)).toEqual(["venue-superior"]);
    expect(result.dominatedVenues.map((v) => v.id)).toEqual(["venue-inferior"]);
    expect(result.rankedVenues[0].id).toBe("venue-superior");
  });

  it("2. preserves non-dominated venues on the Pareto frontier when trade-offs exist", () => {
    const venues: CandidateVenue[] = [
      {
        id: "venue-travel",
        name: "Travel Focused",
        travelFairness: 95,
        wifiReliability: 80,
        acousticQuietness: 70,
      },
      {
        id: "venue-wifi",
        name: "WiFi Focused",
        travelFairness: 75,
        wifiReliability: 98,
        acousticQuietness: 75,
      },
      {
        id: "venue-quiet",
        name: "Quiet Focused",
        travelFairness: 70,
        wifiReliability: 80,
        acousticQuietness: 95,
      },
      {
        id: "venue-dominated",
        name: "Dominated Hub",
        travelFairness: 60,
        wifiReliability: 70,
        acousticQuietness: 65,
      },
    ];

    const result = optimizer.rankVenuesPareto(venues);

    // venue-travel, venue-wifi, and venue-quiet each excel in one dimension, none dominates another
    expect(result.paretoFrontier).toHaveLength(3);
    const frontierIds = result.paretoFrontier.map((v) => v.id);
    expect(frontierIds).toContain("venue-travel");
    expect(frontierIds).toContain("venue-wifi");
    expect(frontierIds).toContain("venue-quiet");
    expect(frontierIds).not.toContain("venue-dominated");

    expect(result.dominatedVenues.map((v) => v.id)).toContain("venue-dominated");
  });

  it("3. handles equal-score venues with deterministic tie-breaking by ID", () => {
    const venues: CandidateVenue[] = [
      {
        id: "venue-b",
        name: "Venue B",
        travelFairness: 80,
        wifiReliability: 80,
        acousticQuietness: 80,
      },
      {
        id: "venue-a",
        name: "Venue A",
        travelFairness: 80,
        wifiReliability: 80,
        acousticQuietness: 80,
      },
    ];

    const result = optimizer.rankVenuesPareto(venues);

    // Identical scores across all 3 objectives: neither strictly dominates the other
    expect(result.paretoFrontier).toHaveLength(2);
    // Deterministic tie-breaker orders venue-a before venue-b by localeCompare
    expect(result.paretoFrontier[0].id).toBe("venue-a");
    expect(result.paretoFrontier[1].id).toBe("venue-b");
  });

  it("4. evaluates multiple objective trade-offs and missing values safely", () => {
    const venues: CandidateVenue[] = [
      {
        id: "venue-missing-scores",
        name: "Incomplete Venue",
        travelFairness: undefined,
        wifiReliability: NaN,
        acousticQuietness: 50,
      },
      {
        id: "venue-valid",
        name: "Complete Venue",
        travelFairness: 60,
        wifiReliability: 60,
        acousticQuietness: 60,
      },
    ];

    const result = optimizer.rankVenuesPareto(venues);

    // Incomplete venue defaults NaN/undefined to 0, which is strictly dominated by Complete Venue
    expect(result.paretoFrontier.map((v) => v.id)).toEqual(["venue-valid"]);
    expect(result.dominatedVenues.map((v) => v.id)).toEqual(["venue-missing-scores"]);
  });

  it("5. produces identical results across repeated runs regardless of input order", () => {
    const venuesA: CandidateVenue[] = [
      { id: "v1", name: "V1", travelFairness: 90, wifiReliability: 70, acousticQuietness: 80 },
      { id: "v2", name: "V2", travelFairness: 85, wifiReliability: 85, acousticQuietness: 75 },
      { id: "v3", name: "V3", travelFairness: 60, wifiReliability: 60, acousticQuietness: 60 },
      { id: "v4", name: "V4", travelFairness: 70, wifiReliability: 95, acousticQuietness: 85 },
    ];

    // Permute input order
    const venuesB = [venuesA[3], venuesA[0], venuesA[2], venuesA[1]];

    const resultA = optimizer.rankVenuesPareto(venuesA);
    const resultB = optimizer.rankVenuesPareto(venuesB);

    expect(resultA.paretoFrontier.map((v) => v.id)).toEqual(
      resultB.paretoFrontier.map((v) => v.id),
    );
    expect(resultA.dominatedVenues.map((v) => v.id)).toEqual(
      resultB.dominatedVenues.map((v) => v.id),
    );
    expect(resultA.rankedVenues.map((v) => v.id)).toEqual(
      resultB.rankedVenues.map((v) => v.id),
    );
  });
});
