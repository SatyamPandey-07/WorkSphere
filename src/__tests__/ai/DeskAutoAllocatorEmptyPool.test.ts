import {
  DeskAutoAllocator,
  PersonCandidate,
  DeskResource,
  defaultDeskAutoAllocator,
} from '@/core/ai/DeskAutoAllocator';

describe('DeskAutoAllocator - Empty Desk Pool & Boundary Handling (#10450)', () => {
  let allocator: DeskAutoAllocator;

  beforeEach(() => {
    allocator = new DeskAutoAllocator();
  });

  describe('1. Empty Desk Pool Handling', () => {
    it('returns a graceful infeasible fallback result without throwing when desk pool is empty', () => {
      const persons: PersonCandidate[] = [
        { id: 'person-2', name: 'Bob', priority: 1 },
        { id: 'person-1', name: 'Alice', priority: 2 },
      ];
      const desks: DeskResource[] = [];

      const result = allocator.allocateDesks(persons, desks);

      expect(result.feasible).toBe(false);
      expect(result.isFallback).toBe(true);
      expect(result.assignments).toEqual([]);
      expect(result.totalAllocated).toBe(0);
      expect(result.totalRequested).toBe(2);
      expect(result.totalCost).toBe(0);
      expect(Number.isFinite(result.totalCost)).toBe(true);
      // Deterministically sorted by personId
      expect(result.unassignedPersonIds).toEqual(['person-1', 'person-2']);
    });

    it('treats desk pool with only unavailable or 0-capacity desks as empty', () => {
      const persons: PersonCandidate[] = [
        { id: 'person-1', name: 'Alice' },
      ];
      const desks: DeskResource[] = [
        { id: 'desk-1', isAvailable: false },
        { id: 'desk-2', capacity: 0 },
      ];

      const result = allocator.allocateDesks(persons, desks);

      expect(result.feasible).toBe(false);
      expect(result.isFallback).toBe(true);
      expect(result.assignments).toEqual([]);
      expect(result.unassignedPersonIds).toEqual(['person-1']);
      expect(result.totalCost).toBe(0);
    });

    it('never returns Infinity or NaN for totalCost when desk pool is empty or infeasible', () => {
      const persons: PersonCandidate[] = [
        { id: 'p1' },
        { id: 'p2' },
      ];

      const resultEmptyDesks = allocator.allocateDesks(persons, []);
      expect(resultEmptyDesks.totalCost).toBe(0);
      expect(resultEmptyDesks.totalCost).not.toBe(Infinity);
      expect(resultEmptyDesks.totalCost).not.toBe(-Infinity);
      expect(Number.isNaN(resultEmptyDesks.totalCost)).toBe(false);

      const fallbackResult = allocator.allocateDeterministicFallback(persons, []);
      expect(fallbackResult.totalCost).toBe(0);
      expect(Number.isFinite(fallbackResult.totalCost)).toBe(true);
    });
  });

  describe('2. Empty People List & Dual Empty Pools', () => {
    it('returns feasible result with empty assignments when persons array is empty', () => {
      const desks: DeskResource[] = [
        { id: 'desk-1', capacity: 1 },
        { id: 'desk-2', capacity: 1 },
      ];

      const result = allocator.allocateDesks([], desks);

      expect(result.feasible).toBe(true);
      expect(result.isFallback).toBe(false);
      expect(result.assignments).toEqual([]);
      expect(result.unassignedPersonIds).toEqual([]);
      expect(result.totalAllocated).toBe(0);
      expect(result.totalRequested).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it('handles both persons and desks empty safely and gracefully', () => {
      const result = allocator.allocateDesks([], []);

      expect(result.feasible).toBe(true);
      expect(result.isFallback).toBe(false);
      expect(result.assignments).toEqual([]);
      expect(result.unassignedPersonIds).toEqual([]);
      expect(result.totalCost).toBe(0);
      expect(Number.isFinite(result.totalCost)).toBe(true);
    });

    it('handles null / undefined persons and desks defensively', () => {
      // @ts-expect-error test invalid inputs
      const result = allocator.allocateDesks(null, null);

      expect(result.feasible).toBe(true);
      expect(result.assignments).toEqual([]);
      expect(result.totalCost).toBe(0);
    });
  });

  describe('3. Normal Allocation Regression & Deterministic Ordering', () => {
    it('successfully produces optimal bipartite matching when desks are available', () => {
      const persons: PersonCandidate[] = [
        { id: 'person-1', priority: 1 },
        { id: 'person-2', priority: 2 },
      ];
      const desks: DeskResource[] = [
        { id: 'desk-a', isAvailable: true, capacity: 1 },
        { id: 'desk-b', isAvailable: true, capacity: 1 },
      ];

      const result = allocator.allocateDesks(persons, desks);

      expect(result.feasible).toBe(true);
      expect(result.isFallback).toBe(false);
      expect(result.assignments).toHaveLength(2);
      expect(result.unassignedPersonIds).toEqual([]);
      expect(result.totalAllocated).toBe(2);
      expect(result.totalRequested).toBe(2);
      expect(typeof result.totalCost).toBe('number');
      expect(Number.isFinite(result.totalCost)).toBe(true);
    });

    it('maintains deterministic unassigned ordering across multiple runs with empty desks', () => {
      const persons: PersonCandidate[] = [
        { id: 'charlie' },
        { id: 'alice' },
        { id: 'bob' },
      ];

      const run1 = allocator.allocateDesks(persons, []);
      const run2 = allocator.allocateDesks(persons, []);

      expect(run1.unassignedPersonIds).toEqual(['alice', 'bob', 'charlie']);
      expect(run2.unassignedPersonIds).toEqual(['alice', 'bob', 'charlie']);
      expect(run1).toEqual(run2);
    });

    it('exports defaultDeskAutoAllocator singleton', () => {
      expect(defaultDeskAutoAllocator).toBeInstanceOf(DeskAutoAllocator);
    });
  });
});
