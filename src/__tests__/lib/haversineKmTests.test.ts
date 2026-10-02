import { calculateHaversineDistance } from "@/lib/utils";

describe("calculateHaversineDistance", () => {
  it("returns 0 for identical coordinates", () => {
    expect(calculateHaversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(
      0,
    );
  });

  it("calculates approximate distance between NYC and London (~5570 km)", () => {
    // New York City: 40.7128° N, 74.0060° W
    // London:        51.5074° N,  0.1278° W
    const dist = calculateHaversineDistance(40.7128, -74.006, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(5500);
    expect(dist).toBeLessThan(5650);
  });

  it("calculates approximate distance for antipodal points (~20015 km)", () => {
    // Antipodal points are diametrically opposite on the globe
    // Half the Earth's circumference ≈ 20015 km
    const dist = calculateHaversineDistance(0, 0, 0, 180);
    expect(dist).toBeGreaterThan(20000);
    expect(dist).toBeLessThan(20030);
  });

  it("handles negative latitudes and longitudes correctly", () => {
    // Sydney, Australia: -33.8688° S, 151.2093° E
    // Buenos Aires, Argentina: -34.6037° S, 58.3816° W
    const dist = calculateHaversineDistance(
      -33.8688,
      151.2093,
      -34.6037,
      -58.3816,
    );
    expect(dist).toBeGreaterThan(11700);
    expect(dist).toBeLessThan(11900);
  });

  it("always returns a non-negative distance", () => {
    const pairs: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [90, 0, -90, 0],
      [-45, -90, 45, 90],
      [10, 10, -10, -10],
    ];
    for (const [lat1, lon1, lat2, lon2] of pairs) {
      expect(
        calculateHaversineDistance(lat1, lon1, lat2, lon2),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("is symmetric: d(A,B) === d(B,A)", () => {
    const ab = calculateHaversineDistance(48.8566, 2.3522, 35.6762, 139.6503);
    const ba = calculateHaversineDistance(35.6762, 139.6503, 48.8566, 2.3522);
    expect(ab).toBeCloseTo(ba, 5);
  });
});
