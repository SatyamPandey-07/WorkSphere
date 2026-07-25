import { calculateSpatialAttenuation } from "../../../lib/spatial/RemoteListenerInterpolator";

describe("Dynamic Sound Effect Spatial Attenuation", () => {
  it("should return full gain (1.0) when distance is exactly at refDistance (1m)", () => {
    const gain = calculateSpatialAttenuation(1);
    expect(gain).toBe(1.0);
  });

  it("should return full gain (1.0) when distance is inside refDistance (< 1m)", () => {
    const gain = calculateSpatialAttenuation(0.5);
    expect(gain).toBe(1.0);
  });

  it("should return 0.0 gain when distance is exactly at maxDistance (30m)", () => {
    const gain = calculateSpatialAttenuation(30);
    expect(gain).toBe(0.0);
  });

  it("should return 0.0 gain when distance exceeds maxDistance (> 30m)", () => {
    const gain = calculateSpatialAttenuation(45);
    expect(gain).toBe(0.0);
  });

  it("should correctly apply logarithmic inverse distance roll-off between boundaries", () => {
    // At 2 meters: 1 / (1 + 1 * (2 - 1)) = 1/2 = 0.5
    expect(calculateSpatialAttenuation(2)).toBe(0.5);

    // At 5 meters: 1 / (1 + 1 * (5 - 1)) = 1/5 = 0.2
    expect(calculateSpatialAttenuation(5)).toBe(0.2);

    // At 11 meters: 1 / (1 + 1 * (11 - 1)) = 1/11 ≈ 0.0909
    expect(calculateSpatialAttenuation(11)).toBe(0.0909);
  });
});
