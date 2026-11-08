import { calculateCommuteEtaMinutes, TRANSIT_SPEED_MAP } from "@/components/hud/MachAirspeedTape";

describe("MachAirspeedTape Velocity and ETA calculations", () => {
  it("calculates commute ETA correctly for pedestrian velocity", () => {
    // 3 km at 15 knots (15 * 1.852 = 27.78 km/h) -> 3 / 27.78 * 60 = 6.48 -> 6 min
    const eta = calculateCommuteEtaMinutes(3, 15);
    expect(eta).toBe(6);
  });

  it("calculates commute ETA correctly for high speed rail", () => {
    // 50 km at 300 knots (300 * 1.852 = 555.6 km/h) -> 50 / 555.6 * 60 = 5.4 -> 5 min
    const eta = calculateCommuteEtaMinutes(50, 300);
    expect(eta).toBe(5);
  });

  it("handles zero or negative distance gracefully", () => {
    expect(calculateCommuteEtaMinutes(0, 45)).toBe(0);
    expect(calculateCommuteEtaMinutes(-5, 45)).toBe(0);
  });

  it("has calibrated stall and Vne limits for each transit mode", () => {
    expect(TRANSIT_SPEED_MAP.walking.stallSpeed).toBeLessThan(TRANSIT_SPEED_MAP.walking.defaultKnots);
    expect(TRANSIT_SPEED_MAP.walking.vneSpeed).toBeGreaterThan(TRANSIT_SPEED_MAP.walking.defaultKnots);

    expect(TRANSIT_SPEED_MAP.cycling.stallSpeed).toBeLessThan(TRANSIT_SPEED_MAP.cycling.defaultKnots);
    expect(TRANSIT_SPEED_MAP.cycling.vneSpeed).toBeGreaterThan(TRANSIT_SPEED_MAP.cycling.defaultKnots);

    expect(TRANSIT_SPEED_MAP.metro.stallSpeed).toBeLessThan(TRANSIT_SPEED_MAP.metro.defaultKnots);
    expect(TRANSIT_SPEED_MAP.metro.vneSpeed).toBeGreaterThan(TRANSIT_SPEED_MAP.metro.defaultKnots);

    expect(TRANSIT_SPEED_MAP.high_speed_rail.stallSpeed).toBeLessThan(TRANSIT_SPEED_MAP.high_speed_rail.defaultKnots);
    expect(TRANSIT_SPEED_MAP.high_speed_rail.vneSpeed).toBeGreaterThan(TRANSIT_SPEED_MAP.high_speed_rail.defaultKnots);
  });
});
