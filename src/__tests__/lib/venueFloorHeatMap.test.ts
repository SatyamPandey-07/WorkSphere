/**
 * Tests for venue floor activity heat map generation.
 */

interface HeatMapPoint {
  x: number;
  y: number;
  intensity: number; // 0-1 occupancy/activity level
}

function normalizeIntensity(points: HeatMapPoint[]): HeatMapPoint[] {
  if (points.length === 0) return [];
  const maxIntensity = Math.max(...points.map((p) => p.intensity));
  if (maxIntensity === 0) return points.map((p) => ({ ...p, intensity: 0 }));
  return points.map((p) => ({ ...p, intensity: Math.round((p.intensity / maxIntensity) * 100) / 100 }));
}

function highActivityZones(points: HeatMapPoint[], threshold = 0.7): HeatMapPoint[] {
  return points.filter((p) => p.intensity >= threshold);
}

function lowActivityZones(points: HeatMapPoint[], threshold = 0.2): HeatMapPoint[] {
  return points.filter((p) => p.intensity < threshold);
}

function averageIntensity(points: HeatMapPoint[]): number {
  if (points.length === 0) return 0;
  return Math.round((points.reduce((s, p) => s + p.intensity, 0) / points.length) * 100) / 100;
}

function hotspot(points: HeatMapPoint[]): HeatMapPoint | null {
  if (points.length === 0) return null;
  return points.reduce((max, p) => p.intensity > max.intensity ? p : max);
}

const POINTS: HeatMapPoint[] = [
  { x: 1, y: 1, intensity: 0.9 },
  { x: 2, y: 1, intensity: 0.5 },
  { x: 3, y: 1, intensity: 0.1 },
  { x: 4, y: 2, intensity: 0.7 },
  { x: 5, y: 2, intensity: 0.3 },
];

describe("Venue floor heat map", () => {
  it("normalizeIntensity: max becomes 1.0", () => {
    const normalized = normalizeIntensity(POINTS);
    expect(Math.max(...normalized.map((p) => p.intensity))).toBe(1.0);
  });

  it("normalizeIntensity: empty → empty", () => {
    expect(normalizeIntensity([])).toHaveLength(0);
  });

  it("highActivityZones: above 0.7 threshold", () => {
    const high = highActivityZones(POINTS);
    expect(high.every((p) => p.intensity >= 0.7)).toBe(true);
    expect(high).toHaveLength(2); // 0.9 and 0.7
  });

  it("lowActivityZones: below 0.2 threshold", () => {
    const low = lowActivityZones(POINTS);
    expect(low).toHaveLength(1); // only 0.1
  });

  it("averageIntensity: (0.9+0.5+0.1+0.7+0.3)/5 = 0.5", () => {
    expect(averageIntensity(POINTS)).toBe(0.5);
  });

  it("averageIntensity: empty → 0", () => {
    expect(averageIntensity([])).toBe(0);
  });

  it("hotspot: returns highest intensity point", () => {
    expect(hotspot(POINTS)!.intensity).toBe(0.9);
  });

  it("hotspot: empty → null", () => {
    expect(hotspot([])).toBeNull();
  });
});
