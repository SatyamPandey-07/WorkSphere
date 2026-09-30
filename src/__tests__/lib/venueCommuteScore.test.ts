/**
 * Tests for venue commute score calculation.
 */

interface CommuteData {
  venueId: string;
  userId: string;
  homeLocation: { lat: number; lng: number };
  venueLocation: { lat: number; lng: number };
  preferredMode: "walking" | "cycling" | "transit" | "car";
}

const COMMUTE_SPEEDS_KPH: Record<string, number> = {
  walking: 5, cycling: 15, transit: 30, car: 40,
};

const COMMUTE_EMISSIONS_KG_PER_KM: Record<string, number> = {
  walking: 0, cycling: 0, transit: 0.089, car: 0.192,
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function commuteMinutes(data: CommuteData): number {
  const distKm = haversineKm(data.homeLocation.lat, data.homeLocation.lng, data.venueLocation.lat, data.venueLocation.lng);
  const speed = COMMUTE_SPEEDS_KPH[data.preferredMode];
  return Math.ceil((distKm / speed) * 60);
}

function commuteEmissionsKg(data: CommuteData): number {
  const distKm = haversineKm(data.homeLocation.lat, data.homeLocation.lng, data.venueLocation.lat, data.venueLocation.lng);
  return Math.round(distKm * COMMUTE_EMISSIONS_KG_PER_KM[data.preferredMode] * 100) / 100;
}

function commuteScore(data: CommuteData): number {
  const minutes = commuteMinutes(data);
  const emissions = commuteEmissionsKg(data);
  let score = 100;
  score -= Math.min(minutes * 2, 60); // penalize time
  score -= Math.min(emissions * 50, 30); // penalize emissions
  return Math.max(0, score);
}

describe("Venue commute score", () => {
  const NEARBY: CommuteData = {
    venueId: "v1", userId: "u1",
    homeLocation:  { lat: 40.712, lng: -74.006 },
    venueLocation: { lat: 40.714, lng: -74.007 },
    preferredMode: "walking",
  };

  const FAR_CAR: CommuteData = {
    venueId: "v2", userId: "u1",
    homeLocation:  { lat: 40.712, lng: -74.006 },
    venueLocation: { lat: 40.8,   lng: -74.1   },
    preferredMode: "car",
  };

  it("commuteMinutes: walking nearby → fast", () => {
    expect(commuteMinutes(NEARBY)).toBeLessThan(10);
  });

  it("commuteMinutes: car far → more minutes", () => {
    expect(commuteMinutes(FAR_CAR)).toBeGreaterThan(commuteMinutes(NEARBY));
  });

  it("commuteEmissionsKg: walking → 0", () => {
    expect(commuteEmissionsKg(NEARBY)).toBe(0);
  });

  it("commuteEmissionsKg: car → positive", () => {
    expect(commuteEmissionsKg(FAR_CAR)).toBeGreaterThan(0);
  });

  it("commuteScore: nearby walking → high score", () => {
    expect(commuteScore(NEARBY)).toBeGreaterThan(80);
  });

  it("commuteScore: far car → lower score", () => {
    expect(commuteScore(FAR_CAR)).toBeLessThan(commuteScore(NEARBY));
  });
});
