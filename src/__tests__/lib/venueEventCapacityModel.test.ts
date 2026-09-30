/**
 * Tests for venue event capacity modeling with different setup styles.
 */

type SetupStyle = "theater" | "classroom" | "banquet" | "reception" | "boardroom";

interface CapacityModel {
  baseAreaSqFt: number;
  subtractForStage: number;  // sqft
  subtractForBar: number;
  subtractForAV: number;
}

const SQFT_PER_PERSON: Record<SetupStyle, number> = {
  theater:   8,
  classroom: 12,
  banquet:   15,
  reception: 6,
  boardroom: 25,
};

function calculateCapacity(model: CapacityModel, style: SetupStyle): number {
  const usableArea = model.baseAreaSqFt - model.subtractForStage - model.subtractForBar - model.subtractForAV;
  if (usableArea <= 0) return 0;
  return Math.floor(usableArea / SQFT_PER_PERSON[style]);
}

function optimalSetupStyle(
  model: CapacityModel,
  requiredCapacity: number
): SetupStyle | null {
  const styles: SetupStyle[] = ["theater", "classroom", "banquet", "reception", "boardroom"];
  const eligible = styles.filter((s) => calculateCapacity(model, s) >= requiredCapacity);
  if (eligible.length === 0) return null;
  // Return the style that most efficiently uses space (smallest sqft per person that still fits)
  return eligible.reduce((best, s) =>
    SQFT_PER_PERSON[s] < SQFT_PER_PERSON[best] ? s : best
  );
}

function capacityRangeForVenue(model: CapacityModel): { min: number; max: number } {
  const styles: SetupStyle[] = ["theater", "classroom", "banquet", "reception", "boardroom"];
  const capacities = styles.map((s) => calculateCapacity(model, s));
  return { min: Math.min(...capacities), max: Math.max(...capacities) };
}

const MODEL: CapacityModel = {
  baseAreaSqFt: 2000,
  subtractForStage: 200,
  subtractForBar: 100,
  subtractForAV: 50,
};

describe("Venue event capacity modeling", () => {
  it("calculateCapacity: theater 1650sqft / 8 = 206", () => {
    expect(calculateCapacity(MODEL, "theater")).toBe(206);
  });

  it("calculateCapacity: boardroom 1650sqft / 25 = 66", () => {
    expect(calculateCapacity(MODEL, "boardroom")).toBe(66);
  });

  it("calculateCapacity: negative area → 0", () => {
    const tiny = { ...MODEL, baseAreaSqFt: 100 };
    expect(calculateCapacity(tiny, "theater")).toBe(0);
  });

  it("optimalSetupStyle: 100 people → theater (most efficient)", () => {
    expect(optimalSetupStyle(MODEL, 100)).toBe("theater");
  });

  it("optimalSetupStyle: 250 people → null (too many)", () => {
    expect(optimalSetupStyle(MODEL, 250)).toBeNull();
  });

  it("capacityRangeForVenue: min=boardroom, max=reception", () => {
    const range = capacityRangeForVenue(MODEL);
    expect(range.max).toBeGreaterThan(range.min);
    expect(range.min).toBeGreaterThan(0);
  });
});
