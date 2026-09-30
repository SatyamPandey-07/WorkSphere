/**
 * Tests for venue sustainability/green score calculation.
 */

interface SustainabilityFeatures {
  solarPowered: boolean;
  rainwaterHarvesting: boolean;
  ledLighting: boolean;
  recyclingProgram: boolean;
  greenCertified: boolean;
  evCharging: boolean;
  bicycleParkingAvailable: boolean;
}

const SUSTAINABILITY_WEIGHTS: Record<keyof SustainabilityFeatures, number> = {
  solarPowered:            25,
  rainwaterHarvesting:     15,
  ledLighting:             10,
  recyclingProgram:        10,
  greenCertified:          20,
  evCharging:              10,
  bicycleParkingAvailable: 10,
};

function sustainabilityScore(features: SustainabilityFeatures): number {
  return (Object.entries(features) as [keyof SustainabilityFeatures, boolean][])
    .filter(([, v]) => v)
    .reduce((sum, [k]) => sum + SUSTAINABILITY_WEIGHTS[k], 0);
}

function sustainabilityGrade(score: number): "E" | "D" | "C" | "B" | "A" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  if (score >= 20) return "D";
  return "E";
}

const NO_FEATURES: SustainabilityFeatures = {
  solarPowered: false, rainwaterHarvesting: false, ledLighting: false,
  recyclingProgram: false, greenCertified: false, evCharging: false, bicycleParkingAvailable: false,
};

describe("Venue sustainability score", () => {
  it("no features → 0", () => {
    expect(sustainabilityScore(NO_FEATURES)).toBe(0);
  });

  it("solar only → 25", () => {
    expect(sustainabilityScore({ ...NO_FEATURES, solarPowered: true })).toBe(25);
  });

  it("solar + greenCertified → 45", () => {
    expect(sustainabilityScore({ ...NO_FEATURES, solarPowered: true, greenCertified: true })).toBe(45);
  });

  it("all features → 100", () => {
    const all: SustainabilityFeatures = {
      solarPowered: true, rainwaterHarvesting: true, ledLighting: true,
      recyclingProgram: true, greenCertified: true, evCharging: true, bicycleParkingAvailable: true,
    };
    expect(sustainabilityScore(all)).toBe(100);
  });

  it("grade E for score < 20", () => {
    expect(sustainabilityGrade(15)).toBe("E");
  });

  it("grade D for 20–39", () => {
    expect(sustainabilityGrade(25)).toBe("D");
  });

  it("grade C for 40–59", () => {
    expect(sustainabilityGrade(45)).toBe("C");
  });

  it("grade B for 60–79", () => {
    expect(sustainabilityGrade(70)).toBe("B");
  });

  it("grade A for ≥ 80", () => {
    expect(sustainabilityGrade(85)).toBe("A");
  });
});
