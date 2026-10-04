/**
 * Tests for venue booking geo-fencing and location-aware triggers.
 */

interface GeoFence {
  id: string;
  venueId: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  triggerType: "entry" | "exit" | "both";
  active: boolean;
}

interface LocationEvent {
  userId: string;
  lat: number;
  lng: number;
  timestamp: number;
  accuracy: number;  // meters
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function isInsideFence(fence: GeoFence, event: LocationEvent): boolean {
  const dist = haversineMeters(fence.centerLat, fence.centerLng, event.lat, event.lng);
  return dist <= fence.radiusMeters;
}

function activeFences(fences: GeoFence[]): GeoFence[] {
  return fences.filter((f) => f.active);
}

function fencesForVenue(fences: GeoFence[], venueId: string): GeoFence[] {
  return fences.filter((f) => f.venueId === venueId);
}

function triggeredFences(
  fences: GeoFence[],
  event: LocationEvent
): GeoFence[] {
  return activeFences(fences).filter((f) => isInsideFence(f, event));
}

function proximityCategory(distanceMeters: number): "on_site" | "nearby" | "approaching" | "far" {
  if (distanceMeters <= 50)   return "on_site";
  if (distanceMeters <= 200)  return "nearby";
  if (distanceMeters <= 1000) return "approaching";
  return "far";
}

const FENCE: GeoFence = {
  id: "f1", venueId: "v1", centerLat: 51.5074, centerLng: -0.1278,
  radiusMeters: 100, triggerType: "entry", active: true,
};

const INSIDE_EVENT: LocationEvent  = { userId: "u1", lat: 51.5074, lng: -0.1278, timestamp: 1_700_000_000_000, accuracy: 5 };
const OUTSIDE_EVENT: LocationEvent = { userId: "u1", lat: 51.5200, lng: -0.1278, timestamp: 1_700_000_000_000, accuracy: 5 };

describe("Geo-fencing and location-aware triggers", () => {
  it("isInsideFence: user at center → inside", () => {
    expect(isInsideFence(FENCE, INSIDE_EVENT)).toBe(true);
  });

  it("isInsideFence: user far away → outside", () => {
    expect(isInsideFence(FENCE, OUTSIDE_EVENT)).toBe(false);
  });

  it("triggeredFences: inside user triggers fence", () => {
    expect(triggeredFences([FENCE], INSIDE_EVENT).length).toBe(1);
  });

  it("triggeredFences: outside user triggers nothing", () => {
    expect(triggeredFences([FENCE], OUTSIDE_EVENT).length).toBe(0);
  });

  it("proximityCategory: 30m → on_site", () => {
    expect(proximityCategory(30)).toBe("on_site");
  });

  it("proximityCategory: 500m → approaching", () => {
    expect(proximityCategory(500)).toBe("approaching");
  });

  it("activeFences: inactive fence not returned", () => {
    const inactive = { ...FENCE, active: false };
    expect(activeFences([inactive]).length).toBe(0);
  });
});
