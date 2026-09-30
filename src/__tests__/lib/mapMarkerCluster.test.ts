/**
 * Tests for map venue marker clustering by proximity.
 */

interface Marker {
  id: string;
  lat: number;
  lng: number;
}

function distanceDeg(a: Marker, b: Marker): number {
  return Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2);
}

function clusterMarkers(markers: Marker[], radiusDeg: number): Marker[][] {
  const visited = new Set<string>();
  const clusters: Marker[][] = [];

  for (const marker of markers) {
    if (visited.has(marker.id)) continue;
    const cluster = markers.filter((m) => distanceDeg(marker, m) <= radiusDeg);
    cluster.forEach((m) => visited.add(m.id));
    clusters.push(cluster);
  }
  return clusters;
}

function clusterCentroid(cluster: Marker[]): { lat: number; lng: number } {
  const lat = cluster.reduce((s, m) => s + m.lat, 0) / cluster.length;
  const lng = cluster.reduce((s, m) => s + m.lng, 0) / cluster.length;
  return { lat, lng };
}

const MARKERS: Marker[] = [
  { id: "m1", lat: 40.0, lng: -74.0 },
  { id: "m2", lat: 40.001, lng: -74.0 },   // very close to m1
  { id: "m3", lat: 41.0, lng: -75.0 },     // far away
];

describe("Map marker clustering", () => {
  it("nearby markers form one cluster", () => {
    const clusters = clusterMarkers([MARKERS[0], MARKERS[1]], 0.01);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it("distant markers form separate clusters", () => {
    const clusters = clusterMarkers(MARKERS, 0.01);
    expect(clusters).toHaveLength(2);
  });

  it("each marker appears in exactly one cluster", () => {
    const clusters = clusterMarkers(MARKERS, 0.01);
    const allIds = clusters.flat().map((m) => m.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("empty markers → empty clusters", () => {
    expect(clusterMarkers([], 0.01)).toHaveLength(0);
  });

  it("single marker → single cluster", () => {
    const clusters = clusterMarkers([MARKERS[0]], 0.01);
    expect(clusters).toHaveLength(1);
    expect(clusters[0][0].id).toBe("m1");
  });

  it("centroid of 2 markers", () => {
    const c = clusterCentroid([MARKERS[0], MARKERS[1]]);
    expect(c.lat).toBeCloseTo(40.0005);
    expect(c.lng).toBeCloseTo(-74.0);
  });

  it("centroid of single marker equals that marker", () => {
    const c = clusterCentroid([MARKERS[2]]);
    expect(c.lat).toBe(41.0);
    expect(c.lng).toBe(-75.0);
  });
});
