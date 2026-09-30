/**
 * Tests for per-visit carbon footprint estimation.
 */

interface VisitCarbonFactors {
  distanceKm: number;
  transportMode: "walking" | "cycling" | "public_transit" | "car" | "rideshare";
  stayHours: number;
  venueSqFt: number;
}

const TRANSPORT_KG_CO2_PER_KM: Record<VisitCarbonFactors["transportMode"], number> = {
  walking:        0.0,
  cycling:        0.0,
  public_transit: 0.089,
  car:            0.192,
  rideshare:      0.15,
};

const BUILDING_KG_CO2_PER_SQFT_HOUR = 0.001;

function transportEmissions(factors: VisitCarbonFactors): number {
  return factors.distanceKm * TRANSPORT_KG_CO2_PER_KM[factors.transportMode] * 2; // round trip
}

function buildingEmissions(factors: VisitCarbonFactors, occupancy: number): number {
  if (occupancy <= 0) return 0;
  const totalBuildingKg = factors.venueSqFt * BUILDING_KG_CO2_PER_SQFT_HOUR * factors.stayHours;
  return totalBuildingKg / occupancy;
}

function totalVisitEmissions(factors: VisitCarbonFactors, occupancy: number): number {
  return transportEmissions(factors) + buildingEmissions(factors, occupancy);
}

function emissionsLabel(kgCo2: number): "low" | "medium" | "high" {
  if (kgCo2 < 0.5) return "low";
  if (kgCo2 < 2.0) return "medium";
  return "high";
}

const FACTORS: VisitCarbonFactors = {
  distanceKm: 5, transportMode: "car", stayHours: 3, venueSqFt: 2000,
};

describe("Per-visit carbon footprint", () => {
  it("transportEmissions: 5km car round trip", () => {
    expect(transportEmissions(FACTORS)).toBeCloseTo(5 * 0.192 * 2);
  });

  it("transportEmissions: walking = 0", () => {
    expect(transportEmissions({ ...FACTORS, transportMode: "walking" })).toBe(0);
  });

  it("buildingEmissions: 10 occupants, 2000 sqft, 3h", () => {
    const expected = 2000 * 0.001 * 3 / 10;
    expect(buildingEmissions(FACTORS, 10)).toBeCloseTo(expected);
  });

  it("buildingEmissions: 0 occupancy → 0", () => {
    expect(buildingEmissions(FACTORS, 0)).toBe(0);
  });

  it("totalVisitEmissions: transport + building", () => {
    const total = totalVisitEmissions(FACTORS, 10);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(5); // reasonable range
  });

  it("emissionsLabel: 0.2 → low", () => {
    expect(emissionsLabel(0.2)).toBe("low");
  });

  it("emissionsLabel: 1.0 → medium", () => {
    expect(emissionsLabel(1.0)).toBe("medium");
  });

  it("emissionsLabel: 3.0 → high", () => {
    expect(emissionsLabel(3.0)).toBe("high");
  });
});
