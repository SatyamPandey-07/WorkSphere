/**
 * Tests for venue shared resource pooling between bookings.
 */

interface SharedResource {
  id: string;
  name: string;
  category: string;
  totalUnits: number;
  unitCost: number;
  setupTimeMs: number;
  teardownTimeMs: number;
}

interface ResourceAllocation {
  bookingId: string;
  resourceId: string;
  unitsAllocated: number;
  startMs: number;
  endMs: number;
}

function availableUnits(
  resource: SharedResource,
  allocations: ResourceAllocation[],
  startMs: number,
  endMs: number
): number {
  const conflicting = allocations.filter(
    (a) => a.resourceId === resource.id &&
      a.startMs - resource.teardownTimeMs < endMs &&
      startMs < a.endMs + resource.setupTimeMs
  );
  const used = conflicting.reduce((s, a) => s + a.unitsAllocated, 0);
  return Math.max(0, resource.totalUnits - used);
}

function canAllocate(
  resource: SharedResource,
  allocations: ResourceAllocation[],
  units: number,
  startMs: number,
  endMs: number
): boolean {
  return availableUnits(resource, allocations, startMs, endMs) >= units;
}

function allocationCost(resource: SharedResource, allocation: ResourceAllocation): number {
  const hours = (allocation.endMs - allocation.startMs) / 3_600_000;
  return Math.round(resource.unitCost * allocation.unitsAllocated * hours * 100) / 100;
}

function utilisationRate(
  resource: SharedResource,
  allocations: ResourceAllocation[],
  windowMs: number
): number {
  const relevant = allocations.filter((a) => a.resourceId === resource.id);
  if (relevant.length === 0 || resource.totalUnits === 0) return 0;
  const totalCapacityMs = resource.totalUnits * windowMs;
  const usedMs = relevant.reduce((s, a) => s + (a.endMs - a.startMs) * a.unitsAllocated, 0);
  return Math.round((usedMs / totalCapacityMs) * 100);
}

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;
const RESOURCE: SharedResource = {
  id: "r1", name: "PA System", category: "av",
  totalUnits: 3, unitCost: 50, setupTimeMs: 30 * 60_000, teardownTimeMs: 30 * 60_000,
};
const ALLOCATIONS: ResourceAllocation[] = [
  { bookingId: "b1", resourceId: "r1", unitsAllocated: 2, startMs: NOW, endMs: NOW + 4 * HOUR },
  { bookingId: "b2", resourceId: "r1", unitsAllocated: 1, startMs: NOW + 6 * HOUR, endMs: NOW + 8 * HOUR },
];

describe("Resource pooling management", () => {
  it("availableUnits: 3 - 2 used = 1 during booking b1", () => {
    expect(availableUnits(RESOURCE, ALLOCATIONS, NOW + HOUR, NOW + 2 * HOUR)).toBe(1);
  });

  it("canAllocate: 1 unit available → can allocate 1", () => {
    expect(canAllocate(RESOURCE, ALLOCATIONS, 1, NOW + HOUR, NOW + 2 * HOUR)).toBe(true);
  });

  it("canAllocate: 3 units needed, only 1 available → false", () => {
    expect(canAllocate(RESOURCE, ALLOCATIONS, 3, NOW + HOUR, NOW + 2 * HOUR)).toBe(false);
  });

  it("allocationCost: 2 units × 4h × $50 = $400", () => {
    expect(allocationCost(RESOURCE, ALLOCATIONS[0])).toBe(400);
  });

  it("availableUnits: no conflict at different time = 3", () => {
    expect(availableUnits(RESOURCE, ALLOCATIONS, NOW + 10 * HOUR, NOW + 12 * HOUR)).toBe(3);
  });
});
