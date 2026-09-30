/**
 * Tests for venue WiFi band selection and optimization.
 */

type WifiBand = "2.4GHz" | "5GHz" | "6GHz";

interface WifiBandProfile {
  band: WifiBand;
  maxSpeedMbps: number;
  rangeMeters: number;
  interferenceLevel: "low" | "medium" | "high";
  latencyMs: number;
  supportedBy: "all" | "modern" | "latest";
}

const BAND_PROFILES: Record<WifiBand, WifiBandProfile> = {
  "2.4GHz": { band: "2.4GHz", maxSpeedMbps: 300,  rangeMeters: 50, interferenceLevel: "high",   latencyMs: 5,  supportedBy: "all"    },
  "5GHz":   { band: "5GHz",   maxSpeedMbps: 1300, rangeMeters: 25, interferenceLevel: "medium",  latencyMs: 3,  supportedBy: "modern" },
  "6GHz":   { band: "6GHz",   maxSpeedMbps: 9600, rangeMeters: 12, interferenceLevel: "low",     latencyMs: 1,  supportedBy: "latest" },
};

function recommendBand(
  distanceMeters: number,
  requireHighSpeed: boolean,
  deviceAge: "old" | "modern" | "latest"
): WifiBand {
  const deviceSupport: Record<string, WifiBand[]> = {
    old:    ["2.4GHz"],
    modern: ["2.4GHz", "5GHz"],
    latest: ["2.4GHz", "5GHz", "6GHz"],
  };
  const supported = deviceSupport[deviceAge];

  // Filter by range
  const inRange = supported.filter((b) => BAND_PROFILES[b].rangeMeters >= distanceMeters);
  if (inRange.length === 0) return "2.4GHz"; // fallback

  if (requireHighSpeed) {
    return inRange.reduce((best, b) =>
      BAND_PROFILES[b].maxSpeedMbps > BAND_PROFILES[best].maxSpeedMbps ? b : best
    );
  }

  // Otherwise pick lowest interference
  const interferencePriority = { low: 0, medium: 1, high: 2 };
  return inRange.reduce((best, b) =>
    interferencePriority[BAND_PROFILES[b].interferenceLevel] < interferencePriority[BAND_PROFILES[best].interferenceLevel] ? b : best
  );
}

function bandScore(band: WifiBand): number {
  const profile = BAND_PROFILES[band];
  const speedScore = Math.min(profile.maxSpeedMbps / 100, 50);
  const interferenceScore = { low: 30, medium: 20, high: 10 }[profile.interferenceLevel];
  const latencyScore = Math.max(0, 20 - profile.latencyMs * 4);
  return Math.round(speedScore + interferenceScore + latencyScore);
}

describe("Venue WiFi band selection", () => {
  it("recommendBand: close range + high speed + latest → 6GHz", () => {
    expect(recommendBand(5, true, "latest")).toBe("6GHz");
  });

  it("recommendBand: 30m + old device → 2.4GHz (only option)", () => {
    expect(recommendBand(30, true, "old")).toBe("2.4GHz");
  });

  it("recommendBand: 30m + modern + no speed req → 5GHz (lower interference than 2.4)", () => {
    expect(recommendBand(20, false, "modern")).toBe("5GHz");
  });

  it("recommendBand: 100m → fallback to 2.4GHz", () => {
    expect(recommendBand(100, true, "latest")).toBe("2.4GHz");
  });

  it("bandScore: 6GHz scores higher than 2.4GHz", () => {
    expect(bandScore("6GHz")).toBeGreaterThan(bandScore("2.4GHz"));
  });

  it("bandScore: 5GHz between 2.4GHz and 6GHz", () => {
    expect(bandScore("5GHz")).toBeGreaterThan(bandScore("2.4GHz"));
    expect(bandScore("5GHz")).toBeLessThan(bandScore("6GHz"));
  });
});
