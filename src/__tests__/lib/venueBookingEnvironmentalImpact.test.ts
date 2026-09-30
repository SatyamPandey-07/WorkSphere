/**
 * Tests for venue booking environmental impact tracking.
 */

interface EnvironmentalImpact {
  bookingId: string;
  userId: string;
  venueId: string;
  transportCo2Kg: number;
  buildingCo2Kg: number;
  paperUsedGrams: number;
  waterUsedLiters: number;
  wasteGeneratedGrams: number;
}

interface EnvironmentalGoal {
  userId: string;
  monthlyTargetCo2Kg: number;
  monthlyTargetWaterLiters: number;
}

function totalCo2Kg(impacts: EnvironmentalImpact[], userId: string): number {
  return impacts
    .filter((i) => i.userId === userId)
    .reduce((s, i) => s + i.transportCo2Kg + i.buildingCo2Kg, 0);
}

function goalProgress(
  impacts: EnvironmentalImpact[],
  goal: EnvironmentalGoal,
  nowMs: number
): { co2Pct: number; waterPct: number } {
  const userImpacts = impacts.filter((i) => i.userId === goal.userId);
  const co2Used = userImpacts.reduce((s, i) => s + i.transportCo2Kg + i.buildingCo2Kg, 0);
  const waterUsed = userImpacts.reduce((s, i) => s + i.waterUsedLiters, 0);
  return {
    co2Pct: Math.round((co2Used / goal.monthlyTargetCo2Kg) * 100),
    waterPct: Math.round((waterUsed / goal.monthlyTargetWaterLiters) * 100),
  };
}

function environmentalRating(
  impact: EnvironmentalImpact,
  durationHours: number
): "excellent" | "good" | "fair" | "poor" {
  const co2PerHour = (impact.transportCo2Kg + impact.buildingCo2Kg) / durationHours;
  if (co2PerHour < 0.5) return "excellent";
  if (co2PerHour < 1.0) return "good";
  if (co2PerHour < 2.0) return "fair";
  return "poor";
}

function treeEquivalent(co2Kg: number): number {
  // Average tree absorbs 21kg CO2/year = 0.058kg/day
  return Math.round(co2Kg / 0.058);
}

const IMPACTS: EnvironmentalImpact[] = [
  { bookingId: "b1", userId: "u1", venueId: "v1", transportCo2Kg: 0.5, buildingCo2Kg: 0.3, paperUsedGrams: 10, waterUsedLiters: 5,   wasteGeneratedGrams: 50 },
  { bookingId: "b2", userId: "u1", venueId: "v1", transportCo2Kg: 0.8, buildingCo2Kg: 0.4, paperUsedGrams: 5,  waterUsedLiters: 4,   wasteGeneratedGrams: 30 },
  { bookingId: "b3", userId: "u2", venueId: "v2", transportCo2Kg: 2.0, buildingCo2Kg: 1.0, paperUsedGrams: 20, waterUsedLiters: 10,  wasteGeneratedGrams: 100 },
];

describe("Venue booking environmental impact", () => {
  it("totalCo2Kg: u1 = (0.5+0.3) + (0.8+0.4) = 2.0 kg", () => {
    expect(totalCo2Kg(IMPACTS, "u1")).toBeCloseTo(2.0);
  });

  it("goalProgress: co2 usage as % of target", () => {
    const goal: EnvironmentalGoal = { userId: "u1", monthlyTargetCo2Kg: 10, monthlyTargetWaterLiters: 100 };
    const { co2Pct } = goalProgress(IMPACTS, goal, Date.now());
    expect(co2Pct).toBe(20); // 2.0/10 = 20%
  });

  it("environmentalRating: 0.8/4h = 0.2 kg/h → excellent", () => {
    expect(environmentalRating(IMPACTS[0], 4)).toBe("excellent");
  });

  it("environmentalRating: high CO2 → poor", () => {
    expect(environmentalRating(IMPACTS[2], 1)).toBe("poor");
  });

  it("treeEquivalent: 2.0 kg = ~34 tree-days", () => {
    expect(treeEquivalent(2.0)).toBeCloseTo(34, 0);
  });
});
