/**
 * Tests for venue WiFi speed rating and label assignment.
 */

type WifiLabel = "no_wifi" | "slow" | "moderate" | "fast" | "ultra_fast";

function classifyWifiSpeed(mbps: number): WifiLabel {
  if (mbps <= 0)   return "no_wifi";
  if (mbps < 5)    return "slow";
  if (mbps < 25)   return "moderate";
  if (mbps < 100)  return "fast";
  return "ultra_fast";
}

function wifiScore(mbps: number): number {
  if (mbps <= 0)   return 0;
  if (mbps < 5)    return 1;
  if (mbps < 25)   return 2;
  if (mbps < 100)  return 3;
  if (mbps < 500)  return 4;
  return 5;
}

function meetsRequirement(mbps: number, requiredMbps: number): boolean {
  return mbps >= requiredMbps;
}

function averageSpeed(measurements: number[]): number {
  if (measurements.length === 0) return 0;
  return measurements.reduce((s, m) => s + m, 0) / measurements.length;
}

describe("Venue WiFi speed rating", () => {
  it("0 mbps → no_wifi", () => {
    expect(classifyWifiSpeed(0)).toBe("no_wifi");
  });

  it("negative → no_wifi", () => {
    expect(classifyWifiSpeed(-1)).toBe("no_wifi");
  });

  it("3 mbps → slow", () => {
    expect(classifyWifiSpeed(3)).toBe("slow");
  });

  it("15 mbps → moderate", () => {
    expect(classifyWifiSpeed(15)).toBe("moderate");
  });

  it("50 mbps → fast", () => {
    expect(classifyWifiSpeed(50)).toBe("fast");
  });

  it("200 mbps → ultra_fast", () => {
    expect(classifyWifiSpeed(200)).toBe("ultra_fast");
  });

  it("wifiScore: 0 mbps = 0", () => {
    expect(wifiScore(0)).toBe(0);
  });

  it("wifiScore: 600 mbps = 5", () => {
    expect(wifiScore(600)).toBe(5);
  });

  it("meetsRequirement: true when above threshold", () => {
    expect(meetsRequirement(50, 25)).toBe(true);
  });

  it("meetsRequirement: false when below threshold", () => {
    expect(meetsRequirement(10, 25)).toBe(false);
  });

  it("averageSpeed: correct average", () => {
    expect(averageSpeed([10, 20, 30])).toBeCloseTo(20);
  });

  it("averageSpeed: empty → 0", () => {
    expect(averageSpeed([])).toBe(0);
  });
});
