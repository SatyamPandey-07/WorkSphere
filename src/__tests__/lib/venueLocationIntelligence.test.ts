/**
 * Tests for venue location intelligence and neighborhood analysis.
 */

interface NeighborhoodData {
  venueId: string;
  neighborhood: string;
  walkscore: number;        // 0-100
  transitScore: number;     // 0-100
  bikeScore: number;        // 0-100
  nearbyAmenities: string[];
  crimeRating: "low" | "medium" | "high";
  footTraffic: "quiet" | "moderate" | "busy" | "very_busy";
}

function locationScore(data: NeighborhoodData): number {
  const walkScore = data.walkscore * 0.4;
  const transitScore = data.transitScore * 0.3;
  const bikeScore = data.bikeScore * 0.1;
  const amenityScore = Math.min(data.nearbyAmenities.length * 2, 15);
  const crimeScore = { low: 5, medium: 0, high: -10 }[data.crimeRating];
  return Math.round(walkScore + transitScore + bikeScore + amenityScore + crimeScore);
}

function locationTier(score: number): "urban_core" | "transit_hub" | "suburban" | "remote" {
  if (score >= 75) return "urban_core";
  if (score >= 55) return "transit_hub";
  if (score >= 35) return "suburban";
  return "remote";
}

function isIdealForRemoteWorkers(data: NeighborhoodData): boolean {
  return (
    data.walkscore >= 70 &&
    data.transitScore >= 50 &&
    data.crimeRating !== "high" &&
    data.footTraffic !== "very_busy"
  );
}

function nearbyAmenityCount(data: NeighborhoodData, amenityType: string): number {
  return data.nearbyAmenities.filter((a) => a.toLowerCase().includes(amenityType.toLowerCase())).length;
}

const DOWNTOWN: NeighborhoodData = {
  venueId: "v1", neighborhood: "Downtown",
  walkscore: 95, transitScore: 88, bikeScore: 70,
  nearbyAmenities: ["coffee shop", "gym", "pharmacy", "restaurant", "bank"],
  crimeRating: "low", footTraffic: "busy",
};

const SUBURBAN: NeighborhoodData = {
  venueId: "v2", neighborhood: "Suburb A",
  walkscore: 40, transitScore: 30, bikeScore: 50,
  nearbyAmenities: ["grocery store"],
  crimeRating: "low", footTraffic: "quiet",
};

describe("Venue location intelligence", () => {
  it("locationScore: downtown high score", () => {
    expect(locationScore(DOWNTOWN)).toBeGreaterThan(70);
  });

  it("locationScore: suburban lower score", () => {
    expect(locationScore(SUBURBAN)).toBeLessThan(locationScore(DOWNTOWN));
  });

  it("locationTier: downtown → urban_core", () => {
    expect(locationTier(locationScore(DOWNTOWN))).toBe("urban_core");
  });

  it("locationTier: suburban → suburban", () => {
    expect(locationTier(locationScore(SUBURBAN))).toBe("suburban");
  });

  it("isIdealForRemoteWorkers: downtown qualifies", () => {
    expect(isIdealForRemoteWorkers(DOWNTOWN)).toBe(true);
  });

  it("isIdealForRemoteWorkers: high crime → false", () => {
    expect(isIdealForRemoteWorkers({ ...DOWNTOWN, crimeRating: "high" })).toBe(false);
  });

  it("nearbyAmenityCount: downtown has 1 coffee shop", () => {
    expect(nearbyAmenityCount(DOWNTOWN, "coffee")).toBe(1);
  });
});
