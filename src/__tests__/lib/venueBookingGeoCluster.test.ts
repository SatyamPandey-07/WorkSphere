/**
 * Tests for venue geographic clustering and region analytics.
 */

interface VenueLocation {
  id: string;
  lat: number;
  lng: number;
  city: string;
  country: string;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

function venuesWithinRadius(
  center: VenueLocation,
  venues: VenueLocation[],
  radiusKm: number
): VenueLocation[] {
  return venues.filter((v) =>
    v.id !== center.id && haversineKm(center.lat, center.lng, v.lat, v.lng) <= radiusKm
  );
}

function centroid(venues: VenueLocation[]): { lat: number; lng: number } | null {
  if (venues.length === 0) return null;
  return {
    lat: Math.round((venues.reduce((s, v) => s + v.lat, 0) / venues.length) * 10000) / 10000,
    lng: Math.round((venues.reduce((s, v) => s + v.lng, 0) / venues.length) * 10000) / 10000,
  };
}

function venuesByCountry(venues: VenueLocation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of venues) counts[v.country] = (counts[v.country] ?? 0) + 1;
  return counts;
}

function nearestVenue(target: VenueLocation, venues: VenueLocation[]): VenueLocation | null {
  const others = venues.filter((v) => v.id !== target.id);
  if (others.length === 0) return null;
  return others.reduce((nearest, v) => {
    const d = haversineKm(target.lat, target.lng, v.lat, v.lng);
    const dNearest = haversineKm(target.lat, target.lng, nearest.lat, nearest.lng);
    return d < dNearest ? v : nearest;
  }, others[0]);
}

const VENUES: VenueLocation[] = [
  { id: "v1", lat: 51.5074,  lng: -0.1278,  city: "London",    country: "UK" },
  { id: "v2", lat: 51.5080,  lng: -0.1265,  city: "London",    country: "UK" },
  { id: "v3", lat: 48.8566,  lng: 2.3522,   city: "Paris",     country: "FR" },
  { id: "v4", lat: 52.5200,  lng: 13.4050,  city: "Berlin",    country: "DE" },
];

describe("Venue geographic clustering", () => {
  it("haversineKm: same point → 0", () => {
    expect(haversineKm(51.5074, -0.1278, 51.5074, -0.1278)).toBe(0);
  });

  it("venuesWithinRadius: London venues within 1km of v1", () => {
    const nearby = venuesWithinRadius(VENUES[0], VENUES, 1);
    expect(nearby.map((v) => v.id)).toContain("v2");
    expect(nearby.map((v) => v.id)).not.toContain("v3");
  });

  it("centroid: returns lat/lng", () => {
    const c = centroid(VENUES);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeGreaterThan(0);
  });

  it("venuesByCountry: 2 UK venues", () => {
    expect(venuesByCountry(VENUES).UK).toBe(2);
  });

  it("nearestVenue: nearest to v1 is v2", () => {
    expect(nearestVenue(VENUES[0], VENUES)?.id).toBe("v2");
  });
});
