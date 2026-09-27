import {
  haversineKm,
  formatDistanceBadge,
} from "@/lib/distance";

describe("haversineKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineKm(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("returns ~5570 km for New York → London", () => {
    const km = haversineKm(40.7128, -74.006, 51.5074, -0.1278);
    expect(km).toBeGreaterThan(5500);
    expect(km).toBeLessThan(5650);
  });

  it("returns a positive value for any distinct points", () => {
    expect(haversineKm(0, 0, 1, 1)).toBeGreaterThan(0);
  });
});

describe("formatDistanceBadge", () => {
  it("formats distance in miles and estimates walk time", () => {
    // 1.60934 km ≈ 1.0 mi, walking at 5 km/h ≈ 19 min
    const badge = formatDistanceBadge(1.60934, "mi");
    expect(badge).toMatch(/1\.0 mi/);
    expect(badge).toMatch(/min walk/);
  });

  it("formats distance in kilometres", () => {
    const badge = formatDistanceBadge(2.5, "km");
    expect(badge).toMatch(/2\.5 km/);
    expect(badge).toMatch(/min walk/);
  });

  it("shows '< 1 min walk' for very short distances", () => {
    // 0.05 km at 5 km/h = 0.6 min → rounds to 1 min
    const badge = formatDistanceBadge(0.03, "km");
    expect(badge).toMatch(/< 1 min walk/);
  });
});
