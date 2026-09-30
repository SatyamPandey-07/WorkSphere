/**
 * Tests for map routing to venue (travel time estimation).
 */

type TransportMode = "walking" | "cycling" | "transit" | "driving";

const SPEED_KPH: Record<TransportMode, number> = {
  walking: 5,
  cycling: 15,
  transit: 25,
  driving: 40,
};

function estimatedTravelMinutes(
  distanceKm: number,
  mode: TransportMode,
  trafficMultiplier = 1.0
): number {
  const speed = SPEED_KPH[mode] / trafficMultiplier;
  return Math.ceil((distanceKm / speed) * 60);
}

function fastestMode(distanceKm: number): TransportMode {
  const modes: TransportMode[] = ["driving", "transit", "cycling", "walking"];
  return modes.reduce((fastest, mode) => {
    return estimatedTravelMinutes(distanceKm, mode) <
      estimatedTravelMinutes(distanceKm, fastest)
      ? mode
      : fastest;
  });
}

function isWalkable(distanceKm: number, maxMinutes = 20): boolean {
  return estimatedTravelMinutes(distanceKm, "walking") <= maxMinutes;
}

function formatTravelTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

describe("Venue map routing", () => {
  it("walking 1km: ~12 min", () => {
    expect(estimatedTravelMinutes(1, "walking")).toBe(12);
  });

  it("driving 10km: ~15 min", () => {
    expect(estimatedTravelMinutes(10, "driving")).toBe(15);
  });

  it("traffic multiplier increases time", () => {
    const normal  = estimatedTravelMinutes(10, "driving", 1.0);
    const traffic = estimatedTravelMinutes(10, "driving", 2.0);
    expect(traffic).toBeGreaterThan(normal);
  });

  it("fastestMode: 10km → driving", () => {
    expect(fastestMode(10)).toBe("driving");
  });

  it("isWalkable: 1km → true (12 min)", () => {
    expect(isWalkable(1)).toBe(true);
  });

  it("isWalkable: 3km → false (~36 min)", () => {
    expect(isWalkable(3)).toBe(false);
  });

  it("formatTravelTime: 45 → '45 min'", () => {
    expect(formatTravelTime(45)).toBe("45 min");
  });

  it("formatTravelTime: 90 → '1h 30min'", () => {
    expect(formatTravelTime(90)).toBe("1h 30min");
  });

  it("formatTravelTime: 120 → '2h'", () => {
    expect(formatTravelTime(120)).toBe("2h");
  });
});
