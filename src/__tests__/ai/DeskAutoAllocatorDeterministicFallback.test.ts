import {
  DeskAutoAllocator,
  PersonCandidate,
  DeskResource,
} from "@/core/ai/DeskAutoAllocator";

describe("DeskAutoAllocator Deterministic Fallback Allocation (#10445)", () => {
  let allocator: DeskAutoAllocator;

  beforeEach(() => {
    allocator = new DeskAutoAllocator();
  });

  it("1. handles feasible graph allocation without triggering fallback", () => {
    const persons: PersonCandidate[] = [
      { id: "p1", requirements: { standingDesk: true } },
      { id: "p2", requirements: { quietZone: true } },
    ];

    const desks: DeskResource[] = [
      { id: "d1", standingDesk: true, isAvailable: true },
      { id: "d2", quietZone: true, isAvailable: true },
    ];

    const result = allocator.allocateDesks(persons, desks);
    expect(result.feasible).toBe(true);
    expect(result.isFallback).toBe(false);
    expect(result.assignments).toHaveLength(2);
    expect(result.unassignedPersonIds).toHaveLength(0);

    const p1Match = result.assignments.find((a) => a.personId === "p1");
    const p2Match = result.assignments.find((a) => a.personId === "p2");
    expect(p1Match?.deskId).toBe("d1");
    expect(p2Match?.deskId).toBe("d2");
  });

  it("2. detects infeasible graph and applies deterministic fallback with partial allocation", () => {
    // 3 persons requiring standing desks, but only 1 standing desk available
    const persons: PersonCandidate[] = [
      { id: "p1", priority: 1, requirements: { standingDesk: true } },
      { id: "p2", priority: 5, requirements: { standingDesk: true } },
      { id: "p3", priority: 2, requirements: { standingDesk: true } },
    ];

    const desks: DeskResource[] = [
      { id: "d-standing", standingDesk: true, isAvailable: true },
      { id: "d-regular-1", standingDesk: false, isAvailable: true },
      { id: "d-regular-2", standingDesk: false, isAvailable: true },
    ];

    const result = allocator.allocateDesks(persons, desks);

    expect(result.feasible).toBe(false);
    expect(result.isFallback).toBe(true);
    expect(result.totalAllocated).toBe(1);
    expect(result.totalRequested).toBe(3);

    // Highest priority candidate (p2 with priority 5) receives the single standing desk
    const assignment = result.assignments.find((a) => a.personId === "p2");
    expect(assignment?.deskId).toBe("d-standing");

    // Other two candidates cannot be assigned to regular desks because they violate standingDesk requirement
    expect(result.unassignedPersonIds).toEqual(["p1", "p3"]);
  });

  it("3. respects all desk eligibility constraints strictly during fallback", () => {
    const persons: PersonCandidate[] = [
      {
        id: "p-strict",
        requirements: {
          wheelchairAccessible: true,
          dualMonitor: true,
        },
      },
    ];

    const desks: DeskResource[] = [
      { id: "d1", wheelchairAccessible: true, dualMonitor: false },
      { id: "d2", wheelchairAccessible: false, dualMonitor: true },
      { id: "d3", wheelchairAccessible: false, dualMonitor: false },
    ];

    const result = allocator.allocateDesks(persons, desks);

    // Even in fallback, never allocate an ineligible desk
    expect(result.feasible).toBe(false);
    expect(result.isFallback).toBe(true);
    expect(result.assignments).toHaveLength(0);
    expect(result.unassignedPersonIds).toEqual(["p-strict"]);
  });

  it("4. performs deterministic tie-breaking for equal priority candidates", () => {
    // Two people with equal priority, both wanting the single available desk
    const persons: PersonCandidate[] = [
      { id: "person-b", priority: 10 },
      { id: "person-a", priority: 10 },
    ];

    const desks: DeskResource[] = [
      { id: "desk-single", isAvailable: true },
    ];

    const result = allocator.allocateDesks(persons, desks);

    expect(result.feasible).toBe(false);
    expect(result.isFallback).toBe(true);
    expect(result.assignments).toHaveLength(1);

    // Tie-breaking by ID orders "person-a" before "person-b"
    expect(result.assignments[0].personId).toBe("person-a");
    expect(result.assignments[0].deskId).toBe("desk-single");
    expect(result.unassignedPersonIds).toEqual(["person-b"]);
  });

  it("5. produces identical results across repeated runs regardless of input array ordering", () => {
    const persons1: PersonCandidate[] = [
      { id: "u3", priority: 2, requirements: { quietZone: true } },
      { id: "u1", priority: 10, requirements: { quietZone: true } },
      { id: "u2", priority: 5, requirements: { quietZone: true } },
      { id: "u4", priority: 1, requirements: { quietZone: true } },
    ];

    const persons2: PersonCandidate[] = [
      persons1[2],
      persons1[0],
      persons1[3],
      persons1[1],
    ];

    const desks: DeskResource[] = [
      { id: "desk-q2", quietZone: true, wifiQuality: 5 },
      { id: "desk-q1", quietZone: true, wifiQuality: 3 },
    ];

    const result1 = allocator.allocateDesks(persons1, desks);
    const result2 = allocator.allocateDesks(persons2, desks);

    expect(result1.assignments).toEqual(result2.assignments);
    expect(result1.unassignedPersonIds).toEqual(result2.unassignedPersonIds);
    expect(result1.totalAllocated).toBe(2);
    expect(result1.totalRequested).toBe(4);
  });
});
