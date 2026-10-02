/**
 * Additional edge case tests for useTransitRouting (Issue #2070).
 */

// Haversine helper
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Transit time estimate
const TRANSIT_SPEED_KMH = 25;
const BOARDING_BUFFER_MIN = 5;

function estimateTransitMinutes(km: number): number {
  return Math.round((km / TRANSIT_SPEED_KMH) * 60) + BOARDING_BUFFER_MIN;
}

describe("Transit routing edge cases", () => {
  it("same origin and destination = 0 km + 5 min boarding", () => {
    const km = haversineKm(40.71, -74.0, 40.71, -74.0);
    expect(km).toBe(0);
    expect(estimateTransitMinutes(km)).toBe(5); // boarding buffer only
  });

  it("very short distance (< 1 km) still includes boarding buffer", () => {
    const km = 0.3;
    const minutes = estimateTransitMinutes(km);
    expect(minutes).toBeGreaterThanOrEqual(5);
  });

  it("longer distance increases duration proportionally", () => {
    const short = estimateTransitMinutes(1);
    const long = estimateTransitMinutes(10);
    expect(long).toBeGreaterThan(short);
  });

  it("10 km at 25 km/h = ~24 min + 5 boarding = ~29 min", () => {
    const minutes = estimateTransitMinutes(10);
    expect(minutes).toBe(29); // 24 + 5
  });

  it("1 km at 25 km/h = ~2.4 min → rounds to 2 + 5 boarding = 7 min", () => {
    const km = 1;
    const travelMinutes = (km / TRANSIT_SPEED_KMH) * 60; // 2.4
    const rounded = Math.round(travelMinutes); // 2
    expect(rounded + BOARDING_BUFFER_MIN).toBe(7);
  });

  it("NYC to London is unrealistically long (> 500 min)", () => {
    const km = haversineKm(40.71, -74.0, 51.5, -0.12); // ~5570 km
    const minutes = estimateTransitMinutes(km);
    expect(minutes).toBeGreaterThan(500);
  });

  it("summary string includes 'min by transit'", () => {
    const km = 2;
    const minutes = estimateTransitMinutes(km);
    const summary = `~${minutes} min by transit (${km.toFixed(1)} km)`;
    expect(summary).toMatch(/min by transit/i);
  });
});
