/**
 * Tests for venue capacity buffer management for safety compliance.
 */

interface CapacityBuffer {
  venueId: string;
  maxOccupancy: number;
  safetyBufferPct: number;   // % below max to maintain safety
  emergencyExitCapacity: number; // max safe during fire evacuation
  currentOccupancy: number;
}

function effectiveCapacity(buffer: CapacityBuffer): number {
  return Math.floor(buffer.maxOccupancy * (1 - buffer.safetyBufferPct / 100));
}

function isOccupancySafe(buffer: CapacityBuffer): boolean {
  return buffer.currentOccupancy <= effectiveCapacity(buffer);
}

function isEvacuationCapacitySafe(buffer: CapacityBuffer): boolean {
  return buffer.currentOccupancy <= buffer.emergencyExitCapacity;
}

function occupancyWarningLevel(buffer: CapacityBuffer): "safe" | "caution" | "critical" | "exceeded" {
  const effective = effectiveCapacity(buffer);
  const ratio = buffer.currentOccupancy / effective;
  if (buffer.currentOccupancy > buffer.maxOccupancy) return "exceeded";
  if (ratio >= 1.0) return "critical";
  if (ratio >= 0.85) return "caution";
  return "safe";
}

function remainingSafeCapacity(buffer: CapacityBuffer): number {
  return Math.max(0, effectiveCapacity(buffer) - buffer.currentOccupancy);
}

const BUFFER: CapacityBuffer = {
  venueId: "v1",
  maxOccupancy: 100,
  safetyBufferPct: 10,
  emergencyExitCapacity: 80,
  currentOccupancy: 85,
};

describe("Venue capacity buffer management", () => {
  it("effectiveCapacity: 100 × 90% = 90", () => {
    expect(effectiveCapacity(BUFFER)).toBe(90);
  });

  it("isOccupancySafe: 85 <= 90 → true", () => {
    expect(isOccupancySafe(BUFFER)).toBe(true);
  });

  it("isOccupancySafe: over effective capacity → false", () => {
    expect(isOccupancySafe({ ...BUFFER, currentOccupancy: 95 })).toBe(false);
  });

  it("isEvacuationCapacitySafe: 85 <= 80 → false", () => {
    expect(isEvacuationCapacitySafe(BUFFER)).toBe(false);
  });

  it("occupancyWarningLevel: 85/90 ≈ 94% → caution", () => {
    expect(occupancyWarningLevel(BUFFER)).toBe("caution");
  });

  it("occupancyWarningLevel: exceeded → exceeded", () => {
    expect(occupancyWarningLevel({ ...BUFFER, currentOccupancy: 105 })).toBe("exceeded");
  });

  it("occupancyWarningLevel: 90/90 = 100% → critical", () => {
    expect(occupancyWarningLevel({ ...BUFFER, currentOccupancy: 90 })).toBe("critical");
  });

  it("occupancyWarningLevel: 70/90 ≈ 78% → safe", () => {
    expect(occupancyWarningLevel({ ...BUFFER, currentOccupancy: 70 })).toBe("safe");
  });

  it("remainingSafeCapacity: 90-85 = 5", () => {
    expect(remainingSafeCapacity(BUFFER)).toBe(5);
  });
});
