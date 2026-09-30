/**
 * Tests for map bounding box calculation from venue coordinates.
 */

interface LatLng {
  lat: number;
  lng: number;
}

interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function computeBounds(points: LatLng[]): BoundingBox | null {
  if (points.length === 0) return null;
  return {
    minLat: Math.min(...points.map((p) => p.lat)),
    maxLat: Math.max(...points.map((p) => p.lat)),
    minLng: Math.min(...points.map((p) => p.lng)),
    maxLng: Math.max(...points.map((p) => p.lng)),
  };
}

function isPointInBounds(point: LatLng, bounds: BoundingBox): boolean {
  return (
    point.lat >= bounds.minLat && point.lat <= bounds.maxLat &&
    point.lng >= bounds.minLng && point.lng <= bounds.maxLng
  );
}

function expandBounds(bounds: BoundingBox, paddingDeg: number): BoundingBox {
  return {
    minLat: bounds.minLat - paddingDeg,
    maxLat: bounds.maxLat + paddingDeg,
    minLng: bounds.minLng - paddingDeg,
    maxLng: bounds.maxLng + paddingDeg,
  };
}

function boundsCenter(bounds: BoundingBox): LatLng {
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };
}

const POINTS: LatLng[] = [
  { lat: 40.0, lng: -74.0 },
  { lat: 41.0, lng: -73.0 },
  { lat: 39.5, lng: -75.0 },
];

describe("Venue map bounding box", () => {
  it("computeBounds returns correct min/max", () => {
    const b = computeBounds(POINTS)!;
    expect(b.minLat).toBe(39.5);
    expect(b.maxLat).toBe(41.0);
    expect(b.minLng).toBe(-75.0);
    expect(b.maxLng).toBe(-73.0);
  });

  it("computeBounds: empty → null", () => {
    expect(computeBounds([])).toBeNull();
  });

  it("computeBounds: single point", () => {
    const b = computeBounds([{ lat: 40.0, lng: -74.0 }])!;
    expect(b.minLat).toBe(b.maxLat);
  });

  it("isPointInBounds: inside → true", () => {
    const b = computeBounds(POINTS)!;
    expect(isPointInBounds({ lat: 40.0, lng: -74.0 }, b)).toBe(true);
  });

  it("isPointInBounds: outside → false", () => {
    const b = computeBounds(POINTS)!;
    expect(isPointInBounds({ lat: 42.0, lng: -74.0 }, b)).toBe(false);
  });

  it("expandBounds adds padding", () => {
    const b = computeBounds(POINTS)!;
    const expanded = expandBounds(b, 0.5);
    expect(expanded.minLat).toBe(b.minLat - 0.5);
    expect(expanded.maxLat).toBe(b.maxLat + 0.5);
  });

  it("boundsCenter is midpoint", () => {
    const b = computeBounds(POINTS)!;
    const center = boundsCenter(b);
    expect(center.lat).toBeCloseTo((39.5 + 41.0) / 2);
    expect(center.lng).toBeCloseTo((-75.0 + -73.0) / 2);
  });
});
