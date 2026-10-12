import { describe, it, expect } from "vitest";
import {
  IndoorBeaconMapper,
  type BeaconTopology,
} from "@/core/spatial/IndoorBeaconMapper";

describe("IndoorBeaconMapper Altitude & 3D Trilateration (#5605)", () => {
  it("defaults missing beacon altitude fixedZ to 0.0 without producing NaN coordinates", () => {
    const topology: BeaconTopology[] = [
      { beaconId: "b1", fixedX: 0, fixedY: 0 }, // no fixedZ
      { beaconId: "b2", fixedX: 10, fixedY: 0 }, // no fixedZ
      { beaconId: "b3", fixedX: 5, fixedY: 10 }, // no fixedZ
    ];

    const mapper = new IndoorBeaconMapper(topology);

    const location = mapper.calculateLocation([
      { beaconId: "b1", confidence: 1.0 },
      { beaconId: "b2", confidence: 1.0 },
      { beaconId: "b3", confidence: 1.0 },
    ]);

    expect(location).not.toBeNull();
    expect(location?.x).toBeCloseTo(5.0);
    expect(location?.y).toBeCloseTo(3.333, 2);
    expect(location?.z).toBe(0.0);
    expect(Number.isNaN(location?.z)).toBe(false);
  });

  it("calculates 3D Euclidean distance defaulting point and beacon altitude to 0.0", () => {
    const topology: BeaconTopology[] = [
      { beaconId: "b1", fixedX: 3, fixedY: 4 }, // distance from (0,0) is 5
    ];

    const mapper = new IndoorBeaconMapper(topology);

    const dist = mapper.calculateDistance({ x: 0, y: 0 }, topology[0]);
    expect(dist).toBe(5.0);
    expect(Number.isNaN(dist)).toBe(false);
  });

  it("supports floor height multiplier for multi-story venues", () => {
    const topology: BeaconTopology[] = [
      { beaconId: "b1", fixedX: 0, fixedY: 0, floor: 2 }, // 2 * 3.5 = 7.0m
      { beaconId: "b2", fixedX: 10, fixedY: 0, floor: 2 },
    ];

    const mapper = new IndoorBeaconMapper(topology, { floorHeightMeters: 3.5 });

    const location = mapper.calculateLocation([
      { beaconId: "b1", confidence: 1.0 },
      { beaconId: "b2", confidence: 1.0 },
    ]);

    expect(location).not.toBeNull();
    expect(location?.z).toBe(7.0);
    expect(location?.floor).toBe(2);
  });
});
