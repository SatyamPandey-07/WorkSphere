import { isFiniteVector3 } from "@/types/ar";

describe("isFiniteVector3", () => {
  it("accepts vectors with finite coordinates", () => {
    expect(isFiniteVector3({ x: 1, y: 0, z: -3.5 })).toBe(true);
  });

  it.each([
    { x: Number.NaN, y: 0, z: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
    { x: 0, y: 0, z: Number.NEGATIVE_INFINITY },
    { x: 0, y: 0 },
    null,
  ])("rejects invalid vector coordinates: %p", (value) => {
    expect(isFiniteVector3(value)).toBe(false);
  });
});