/**
 * Tests for venue space booking conflict matrix detection.
 */

interface SpaceBooking {
  bookingId: string;
  spaceId: string;
  venueId: string;
  startMs: number;
  endMs: number;
  userId: string;
}

function buildConflictMatrix(bookings: SpaceBooking[]): Record<string, string[]> {
  const matrix: Record<string, string[]> = {};
  for (let i = 0; i < bookings.length; i++) {
    const a = bookings[i];
    if (!matrix[a.bookingId]) matrix[a.bookingId] = [];
    for (let j = 0; j < bookings.length; j++) {
      if (i === j) continue;
      const b = bookings[j];
      if (
        a.spaceId === b.spaceId &&
        a.venueId === b.venueId &&
        a.startMs < b.endMs &&
        a.endMs > b.startMs
      ) {
        matrix[a.bookingId].push(b.bookingId);
      }
    }
  }
  return matrix;
}

function hasAnyConflict(matrix: Record<string, string[]>): boolean {
  return Object.values(matrix).some((conflicts) => conflicts.length > 0);
}

function bookingsWithConflicts(matrix: Record<string, string[]>): string[] {
  return Object.entries(matrix)
    .filter(([, conflicts]) => conflicts.length > 0)
    .map(([id]) => id);
}

const NOW = 1_700_000_000_000;
const BOOKINGS: SpaceBooking[] = [
  { bookingId: "b1", spaceId: "s1", venueId: "v1", startMs: NOW,           endMs: NOW + 3_600_000, userId: "u1" },
  { bookingId: "b2", spaceId: "s1", venueId: "v1", startMs: NOW + 1_800_000, endMs: NOW + 5_400_000, userId: "u2" }, // overlaps b1
  { bookingId: "b3", spaceId: "s2", venueId: "v1", startMs: NOW,           endMs: NOW + 3_600_000, userId: "u3" }, // different space
  { bookingId: "b4", spaceId: "s1", venueId: "v1", startMs: NOW + 7_200_000, endMs: NOW + 10_800_000, userId: "u4" }, // no conflict
];

describe("Venue space booking conflict matrix", () => {
  it("buildConflictMatrix: b1 and b2 conflict", () => {
    const matrix = buildConflictMatrix(BOOKINGS);
    expect(matrix.b1).toContain("b2");
    expect(matrix.b2).toContain("b1");
  });

  it("buildConflictMatrix: b3 no conflicts (different space)", () => {
    const matrix = buildConflictMatrix(BOOKINGS);
    expect(matrix.b3).toHaveLength(0);
  });

  it("buildConflictMatrix: b4 no conflicts (no overlap)", () => {
    const matrix = buildConflictMatrix(BOOKINGS);
    expect(matrix.b4).toHaveLength(0);
  });

  it("hasAnyConflict: true for conflicting bookings", () => {
    const matrix = buildConflictMatrix(BOOKINGS);
    expect(hasAnyConflict(matrix)).toBe(true);
  });

  it("hasAnyConflict: false for no conflicts", () => {
    const noConflict = buildConflictMatrix([BOOKINGS[0], BOOKINGS[2], BOOKINGS[3]]);
    expect(hasAnyConflict(noConflict)).toBe(false);
  });

  it("bookingsWithConflicts: b1 and b2 listed", () => {
    const matrix = buildConflictMatrix(BOOKINGS);
    const conflicted = bookingsWithConflicts(matrix);
    expect(conflicted).toContain("b1");
    expect(conflicted).toContain("b2");
    expect(conflicted).not.toContain("b3");
  });
});
