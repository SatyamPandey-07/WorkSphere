/**
 * Tests for venue eco-impact calculator for shared workspace vs home office.
 */

interface WorkspaceEcoComparison {
  userId: string;
  dailyCommuteKm: number;
  commuteMode: "walking" | "cycling" | "transit" | "car";
  workHoursAtVenue: number;
  homeOfficeEnergyKwh: number;
  venueEnergyShareKwh: number; // user's share at coworking
}

const TRANSPORT_KG_CO2_PER_KM: Record<string, number> = {
  walking: 0, cycling: 0, transit: 0.089, car: 0.192,
};

const KG_CO2_PER_KWH = 0.233;

function dailyCommuteCo2Kg(ctx: WorkspaceEcoComparison): number {
  return Math.round(ctx.dailyCommuteKm * TRANSPORT_KG_CO2_PER_KM[ctx.commuteMode] * 2 * 100) / 100; // round trip
}

function homeOfficeCo2Kg(ctx: WorkspaceEcoComparison): number {
  return Math.round(ctx.homeOfficeEnergyKwh * KG_CO2_PER_KWH * 100) / 100;
}

function venueSharCo2Kg(ctx: WorkspaceEcoComparison): number {
  return Math.round(ctx.venueEnergyShareKwh * KG_CO2_PER_KWH * 100) / 100;
}

function netCo2Difference(ctx: WorkspaceEcoComparison): number {
  const venueTotal = dailyCommuteCo2Kg(ctx) + venueSharCo2Kg(ctx);
  const homeTotal = homeOfficeCo2Kg(ctx);
  return Math.round((venueTotal - homeTotal) * 100) / 100;
}

function isVenueGreener(ctx: WorkspaceEcoComparison): boolean {
  return netCo2Difference(ctx) < 0;
}

describe("Venue eco-impact calculator", () => {
  const WALKING_CTX: WorkspaceEcoComparison = {
    userId: "u1", dailyCommuteKm: 2, commuteMode: "walking",
    workHoursAtVenue: 8, homeOfficeEnergyKwh: 3, venueEnergyShareKwh: 1.5,
  };

  const CAR_CTX: WorkspaceEcoComparison = {
    userId: "u2", dailyCommuteKm: 20, commuteMode: "car",
    workHoursAtVenue: 8, homeOfficeEnergyKwh: 3, venueEnergyShareKwh: 1.5,
  };

  it("dailyCommuteCo2Kg: walking = 0", () => {
    expect(dailyCommuteCo2Kg(WALKING_CTX)).toBe(0);
  });

  it("dailyCommuteCo2Kg: car 20km round trip", () => {
    // 20km × 2 × 0.192 = 7.68 kg
    expect(dailyCommuteCo2Kg(CAR_CTX)).toBeCloseTo(7.68, 1);
  });

  it("homeOfficeCo2Kg: 3kWh × 0.233 ≈ 0.7", () => {
    expect(homeOfficeCo2Kg(WALKING_CTX)).toBeCloseTo(0.7, 1);
  });

  it("isVenueGreener: walking → greener", () => {
    // venue: 0 (commute) + 0.35 (energy share) = 0.35 < home 0.7
    expect(isVenueGreener(WALKING_CTX)).toBe(true);
  });

  it("isVenueGreener: car commute → not greener", () => {
    // venue: 7.68 + 0.35 > home 0.7
    expect(isVenueGreener(CAR_CTX)).toBe(false);
  });

  it("netCo2Difference: negative for greener option", () => {
    expect(netCo2Difference(WALKING_CTX)).toBeLessThan(0);
  });
});
