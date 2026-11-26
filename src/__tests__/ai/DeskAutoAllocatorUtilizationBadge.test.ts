import {
  DeskAutoAllocator,
  computeCapacityUtilizationBadge,
  type DeskResource,
  type PersonCandidate,
} from "@/core/ai/DeskAutoAllocator";

describe("DeskAutoAllocator Capacity Utilization Percentage Badge (#10434)", () => {
  let allocator: DeskAutoAllocator;

  beforeEach(() => {
    allocator = new DeskAutoAllocator();
  });

  it("computes 0% utilization badge when no persons are requested", () => {
    const desks: DeskResource[] = [
      { id: "d1", isAvailable: true },
      { id: "d2", isAvailable: true },
      { id: "d3", isAvailable: false },
    ];

    const result = allocator.allocateDesks([], desks);
    expect(result.totalCapacity).toBe(2);
    expect(result.capacityUtilizationPercent).toBe(0);
    expect(result.utilizationBadge).toEqual({
      percentage: 0,
      label: "0% Utilized",
      level: "low",
      tone: "emerald",
      allocatedSeats: 0,
      totalCapacity: 2,
    });
  });

  it("computes moderate utilization badge for feasible bipartite allocations", () => {
    const persons: PersonCandidate[] = [
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
    ];
    const desks: DeskResource[] = [
      { id: "d1" },
      { id: "d2" },
      { id: "d3" },
      { id: "d4" },
      { id: "d5" },
    ];

    const result = allocator.allocateDesks(persons, desks);
    expect(result.feasible).toBe(true);
    expect(result.totalAllocated).toBe(3);
    expect(result.totalCapacity).toBe(5);
    expect(result.capacityUtilizationPercent).toBe(60);
    expect(result.utilizationBadge).toEqual({
      percentage: 60,
      label: "60% Utilized",
      level: "moderate",
      tone: "amber",
      allocatedSeats: 3,
      totalCapacity: 5,
    });
  });

  it("computes full 100% utilization badge in fallback when demand exceeds capacity", () => {
    const persons: PersonCandidate[] = [
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
    ];
    const desks: DeskResource[] = [
      { id: "d1", capacity: 1 },
      { id: "d2", capacity: 1 },
      { id: "d-unavailable", capacity: 5, isAvailable: false },
    ];

    const result = allocator.allocateDesks(persons, desks);
    expect(result.isFallback).toBe(true);
    expect(result.totalAllocated).toBe(2);
    expect(result.totalCapacity).toBe(2);
    expect(result.capacityUtilizationPercent).toBe(100);
    expect(result.utilizationBadge).toEqual({
      percentage: 100,
      label: "100% Utilized",
      level: "full",
      tone: "rose",
      allocatedSeats: 2,
      totalCapacity: 2,
    });
  });

  it("handles multi-capacity desks and high utilization tier (80%-99%)", () => {
    const persons: PersonCandidate[] = Array.from({ length: 4 }, (_, i) => ({
      id: `p${i + 1}`,
    }));
    const desks: DeskResource[] = [
      { id: "pod-1", capacity: 3 },
      { id: "pod-2", capacity: 2 },
    ];

    const result = allocator.allocateDesks(persons, desks);
    expect(result.totalAllocated).toBe(4);
    expect(result.totalCapacity).toBe(5);
    expect(result.capacityUtilizationPercent).toBe(80);
    expect(result.utilizationBadge).toEqual({
      percentage: 80,
      label: "80% Utilized",
      level: "high",
      tone: "orange",
      allocatedSeats: 4,
      totalCapacity: 5,
    });
  });

  it("handles zero available capacity safely without NaN or division by zero", () => {
    const result = allocator.allocateDesks([{ id: "p1" }], [
      { id: "d1", isAvailable: false },
      { id: "d2", capacity: 0 },
    ]);

    expect(result.totalCapacity).toBe(0);
    expect(result.capacityUtilizationPercent).toBe(0);
    expect(result.utilizationBadge).toEqual({
      percentage: 0,
      label: "0% Utilized",
      level: "low",
      tone: "emerald",
      allocatedSeats: 0,
      totalCapacity: 0,
    });

    expect(computeCapacityUtilizationBadge(10, 0).percentage).toBe(0);
  });
});
