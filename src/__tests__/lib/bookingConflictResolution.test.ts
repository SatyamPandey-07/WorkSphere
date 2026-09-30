/**
 * Tests for booking conflict detection and resolution strategies.
 */

interface TimeBlock {
  bookingId: string;
  venueId: string;
  resourceId: string;
  startMs: number;
  endMs: number;
  priority: number; // higher = higher priority
}

function detectConflicts(blocks: TimeBlock[]): [TimeBlock, TimeBlock][] {
  const conflicts: [TimeBlock, TimeBlock][] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (
        a.resourceId === b.resourceId &&
        a.venueId === b.venueId &&
        a.startMs < b.endMs &&
        a.endMs > b.startMs
      ) {
        conflicts.push([a, b]);
      }
    }
  }
  return conflicts;
}

function resolveConflict(
  conflict: [TimeBlock, TimeBlock]
): { winner: TimeBlock; loser: TimeBlock } {
  const [a, b] = conflict;
  if (a.priority > b.priority) return { winner: a, loser: b };
  if (b.priority > a.priority) return { winner: b, loser: a };
  // Same priority: earlier booking wins
  return a.bookingId < b.bookingId ? { winner: a, loser: b } : { winner: b, loser: a };
}

function conflictCount(blocks: TimeBlock[]): number {
  return detectConflicts(blocks).length;
}

const NOW = 1_700_000_000_000;
const BLOCKS: TimeBlock[] = [
  { bookingId: "b1", venueId: "v1", resourceId: "r1", startMs: NOW,           endMs: NOW + 3_600_000, priority: 2 },
  { bookingId: "b2", venueId: "v1", resourceId: "r1", startMs: NOW + 1_800_000, endMs: NOW + 5_400_000, priority: 3 }, // overlaps b1
  { bookingId: "b3", venueId: "v1", resourceId: "r2", startMs: NOW,           endMs: NOW + 3_600_000, priority: 1 }, // different resource
];

describe("Booking conflict resolution", () => {
  it("detectConflicts: b1 and b2 conflict", () => {
    const conflicts = detectConflicts(BLOCKS);
    expect(conflicts).toHaveLength(1);
    const ids = conflicts[0].map((b) => b.bookingId);
    expect(ids).toContain("b1");
    expect(ids).toContain("b2");
  });

  it("detectConflicts: different resources don't conflict", () => {
    // b1 and b3 are at the same time but different resources
    const only13 = [BLOCKS[0], BLOCKS[2]];
    expect(detectConflicts(only13)).toHaveLength(0);
  });

  it("resolveConflict: higher priority wins", () => {
    const conflict: [TimeBlock, TimeBlock] = [BLOCKS[0], BLOCKS[1]];
    const { winner, loser } = resolveConflict(conflict);
    expect(winner.bookingId).toBe("b2"); // priority 3 > 2
    expect(loser.bookingId).toBe("b1");
  });

  it("conflictCount: 1 conflict in BLOCKS", () => {
    expect(conflictCount(BLOCKS)).toBe(1);
  });

  it("conflictCount: no conflicts → 0", () => {
    const noConflict: TimeBlock[] = [
      { bookingId: "x1", venueId: "v1", resourceId: "r1", startMs: NOW, endMs: NOW + 1_000_000, priority: 1 },
      { bookingId: "x2", venueId: "v1", resourceId: "r1", startMs: NOW + 1_000_000, endMs: NOW + 2_000_000, priority: 1 },
    ];
    expect(conflictCount(noConflict)).toBe(0);
  });
});
