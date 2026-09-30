/**
 * Tests for venue lighting condition classification for remote workers.
 */

type LightingCondition = "dim" | "adequate" | "bright" | "glare_risk";

interface LightingReport {
  naturalLightLux: number;
  artificialLightLux: number;
  windowFacing: "north" | "south" | "east" | "west" | "none";
  hasGlareShielding: boolean;
}

function totalLux(report: LightingReport): number {
  return report.naturalLightLux + report.artificialLightLux;
}

function classifyLighting(report: LightingReport): LightingCondition {
  const lux = totalLux(report);
  if (lux < 100) return "dim";
  if (lux > 1000 && !report.hasGlareShielding) return "glare_risk";
  if (lux < 300) return "adequate";
  return "bright";
}

function isGoodForVideoCall(report: LightingReport): boolean {
  const lux = totalLux(report);
  const cond = classifyLighting(report);
  return lux >= 200 && cond !== "glare_risk";
}

function lightingScore(report: LightingReport): number {
  const lux = totalLux(report);
  if (lux < 100) return 1;
  if (lux < 300) return 3;
  if (lux > 1000 && !report.hasGlareShielding) return 2; // glare penalty
  return 5;
}

describe("Venue lighting conditions", () => {
  it("totalLux sums natural + artificial", () => {
    const r: LightingReport = { naturalLightLux: 200, artificialLightLux: 300, windowFacing: "south", hasGlareShielding: false };
    expect(totalLux(r)).toBe(500);
  });

  it("classifyLighting: dim < 100 lux", () => {
    const r: LightingReport = { naturalLightLux: 30, artificialLightLux: 50, windowFacing: "north", hasGlareShielding: false };
    expect(classifyLighting(r)).toBe("dim");
  });

  it("classifyLighting: adequate 100-299 lux", () => {
    const r: LightingReport = { naturalLightLux: 150, artificialLightLux: 100, windowFacing: "none", hasGlareShielding: false };
    expect(classifyLighting(r)).toBe("adequate");
  });

  it("classifyLighting: bright 300-999 lux", () => {
    const r: LightingReport = { naturalLightLux: 400, artificialLightLux: 200, windowFacing: "south", hasGlareShielding: true };
    expect(classifyLighting(r)).toBe("bright");
  });

  it("classifyLighting: glare risk > 1000 without shielding", () => {
    const r: LightingReport = { naturalLightLux: 900, artificialLightLux: 300, windowFacing: "south", hasGlareShielding: false };
    expect(classifyLighting(r)).toBe("glare_risk");
  });

  it("isGoodForVideoCall: adequate light and no glare → true", () => {
    const r: LightingReport = { naturalLightLux: 150, artificialLightLux: 100, windowFacing: "north", hasGlareShielding: false };
    expect(isGoodForVideoCall(r)).toBe(true);
  });

  it("isGoodForVideoCall: glare risk → false", () => {
    const r: LightingReport = { naturalLightLux: 900, artificialLightLux: 300, windowFacing: "south", hasGlareShielding: false };
    expect(isGoodForVideoCall(r)).toBe(false);
  });

  it("lightingScore: dim → 1", () => {
    const r: LightingReport = { naturalLightLux: 50, artificialLightLux: 30, windowFacing: "none", hasGlareShielding: false };
    expect(lightingScore(r)).toBe(1);
  });

  it("lightingScore: bright with shielding → 5", () => {
    const r: LightingReport = { naturalLightLux: 400, artificialLightLux: 200, windowFacing: "south", hasGlareShielding: true };
    expect(lightingScore(r)).toBe(5);
  });
});
