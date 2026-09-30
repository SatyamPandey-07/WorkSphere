/**
 * Tests for geographic venue clustering for area-based browsing.
 */

interface GeoVenue {
  venueId: string;
  lat: number;
  lng: number;
  name: string;
  category: string;
}

interface GeoCluster {
  clusterId: string;
  centerLat: number;
  centerLng: number;
  venues: GeoVenue[];
  radius: number;  // km
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clusterVenues(venues: GeoVenue[], radiusKm: number): GeoCluster[] {
  const assigned = new Set<string>();
  const clusters: GeoCluster[] = [];

  for (const venue of venues) {
    if (assigned.has(venue.venueId)) continue;

    const cluster: GeoVenue[] = [venue];
    for (const other of venues) {
      if (assigned.has(other.venueId) || other.venueId === venue.venueId) continue;
      if (haversineDistance(venue.lat, venue.lng, other.lat, other.lng) <= radiusKm) {
        cluster.push(other);
        assigned.add(other.venueId);
      }
    }
    assigned.add(venue.venueId);

    const centerLat = cluster.reduce((s, v) => s + v.lat, 0) / cluster.length;
    const centerLng = cluster.reduce((s, v) => s + v.lng, 0) / cluster.length;

    clusters.push({
      clusterId: `cluster-${venue.venueId}`,
      centerLat,
      centerLng,
      venues: cluster,
      radius: radiusKm,
    });
  }

  return clusters;
}

function venuesInArea(
  venues: GeoVenue[],
  centerLat: number,
  centerLng: number,
  radiusKm: number
): GeoVenue[] {
  return venues.filter((v) => haversineDistance(centerLat, centerLng, v.lat, v.lng) <= radiusKm);
}

const VENUES: GeoVenue[] = [
  { venueId: "v1", lat: 40.712, lng: -74.006, name: "Hub A", category: "coworking" },
  { venueId: "v2", lat: 40.713, lng: -74.007, name: "Café B", category: "cafe"      }, // very close to v1
  { venueId: "v3", lat: 40.8,   lng: -74.1,   name: "Hub C", category: "coworking" }, // far
];

describe("Venue geographic clustering", () => {
  it("haversineDistance: same point = 0", () => {
    expect(haversineDistance(40.712, -74.006, 40.712, -74.006)).toBeCloseTo(0, 3);
  });

  it("haversineDistance: v1 and v2 very close", () => {
    expect(haversineDistance(40.712, -74.006, 40.713, -74.007)).toBeLessThan(0.2);
  });

  it("clusterVenues: v1 and v2 in same cluster within 0.5km", () => {
    const clusters = clusterVenues(VENUES, 0.5);
    const clusterWith1 = clusters.find((c) => c.venues.some((v) => v.venueId === "v1"));
    expect(clusterWith1!.venues.some((v) => v.venueId === "v2")).toBe(true);
  });

  it("clusterVenues: v3 in separate cluster (too far)", () => {
    const clusters = clusterVenues(VENUES, 0.5);
    expect(clusters.length).toBeGreaterThan(1);
  });

  it("venuesInArea: 0.5km radius around v1 includes v2", () => {
    const nearby = venuesInArea(VENUES, 40.712, -74.006, 0.5);
    expect(nearby.some((v) => v.venueId === "v2")).toBe(true);
    expect(nearby.some((v) => v.venueId === "v3")).toBe(false);
  });
});
