/**
 * Tests for venue crowd density classification using area and occupancy.
 */

type DensityLevel = "empty" | "sparse" | "moderate" | "dense" | "overcrowded";

function densityPerSqFt(occupancy: number, areaSquareFeet: number): number {
  if (areaSquareFeet <= 0) return 0;
  return occupancy / areaSquareFeet;
}

function classifyDensity(
  occupancy: number,
  areaSquareFeet: number
): DensityLevel {
  const density = densityPerSqFt(occupancy, areaSquareFeet);
  if (density === 0)     return "empty";
  if (density <= 0.02)   return "sparse";
  if (density <= 0.05)   return "moderate";
  if (density <= 0.1)    return "dense";
  return "overcrowded";
}

function recommendedMaxOccupancy(areaSquareFeet: number, sqFtPerPerson = 20): number {
  return Math.floor(areaSquareFeet / sqFtPerPerson);
}

function densityAlert(
  occupancy: number,
  areaSquareFeet: number,
  sqFtPerPerson = 20
): boolean {
  return occupancy > recommendedMaxOccupancy(areaSquareFeet, sqFtPerPerson);
}

describe("Venue crowd density", () => {
  it("densityPerSqFt: 50 people in 2500 sqft = 0.02", () => {
    expect(densityPerSqFt(50, 2500)).toBe(0.02);
  });

  it("densityPerSqFt: zero area → 0", () => {
    expect(densityPerSqFt(50, 0)).toBe(0);
  });

  it("classifyDensity: 0 occupancy → empty", () => {
    expect(classifyDensity(0, 1000)).toBe("empty");
  });

  it("classifyDensity: 10 people in 1000 sqft (0.01) → sparse", () => {
    expect(classifyDensity(10, 1000)).toBe("sparse");
  });

  it("classifyDensity: 30 people in 1000 sqft (0.03) → moderate", () => {
    expect(classifyDensity(30, 1000)).toBe("moderate");
  });

  it("classifyDensity: 80 people in 1000 sqft (0.08) → dense", () => {
    expect(classifyDensity(80, 1000)).toBe("dense");
  });

  it("classifyDensity: 200 people in 1000 sqft (0.2) → overcrowded", () => {
    expect(classifyDensity(200, 1000)).toBe("overcrowded");
  });

  it("recommendedMaxOccupancy: 2000 sqft / 20 = 100 people", () => {
    expect(recommendedMaxOccupancy(2000)).toBe(100);
  });

  it("densityAlert: over recommendation → true", () => {
    expect(densityAlert(105, 2000)).toBe(true);
  });

  it("densityAlert: under recommendation → false", () => {
    expect(densityAlert(90, 2000)).toBe(false);
  });
});
