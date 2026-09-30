/**
 * Tests for workspace capacity tracking and occupancy status.
 */

type OccupancyStatus = "empty" | "low" | "moderate" | "high" | "full";

function getOccupancyStatus(current: number, capacity: number): OccupancyStatus {
  if (capacity <= 0) throw new Error("Capacity must be positive");
  const ratio = current / capacity;
  if (ratio === 0)    return "empty";
  if (ratio < 0.25)   return "low";
  if (ratio < 0.6)    return "moderate";
  if (ratio < 1)      return "high";
  return "full";
}

function availableSeats(current: number, capacity: number): number {
  return Math.max(0, capacity - current);
}

function occupancyPercent(current: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.round((current / capacity) * 100);
}

describe("Workspace capacity and occupancy", () => {
  it("empty workspace → 'empty'", () => {
    expect(getOccupancyStatus(0, 20)).toBe("empty");
  });

  it("4/20 → 'low'", () => {
    expect(getOccupancyStatus(4, 20)).toBe("low");
  });

  it("10/20 → 'moderate'", () => {
    expect(getOccupancyStatus(10, 20)).toBe("moderate");
  });

  it("18/20 → 'high'", () => {
    expect(getOccupancyStatus(18, 20)).toBe("high");
  });

  it("20/20 → 'full'", () => {
    expect(getOccupancyStatus(20, 20)).toBe("full");
  });

  it("invalid capacity throws", () => {
    expect(() => getOccupancyStatus(5, 0)).toThrow();
  });

  it("availableSeats basic", () => {
    expect(availableSeats(12, 20)).toBe(8);
  });

  it("availableSeats clamps to zero when over capacity", () => {
    expect(availableSeats(25, 20)).toBe(0);
  });

  it("occupancyPercent rounds correctly", () => {
    expect(occupancyPercent(1, 3)).toBe(33);
  });

  it("occupancyPercent 100%", () => {
    expect(occupancyPercent(20, 20)).toBe(100);
  });
});
