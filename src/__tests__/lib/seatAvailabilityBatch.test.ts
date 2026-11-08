/**
 * Tests for batch venue seat availability updates.
 */

interface SeatUpdate {
  venueId: string;
  count: number;
  capacity: number;
}

function processBatchUpdates(updates: SeatUpdate[]): Record<string, { count: number; capacity: number; pct: number }> {
  const result: Record<string, { count: number; capacity: number; pct: number }> = {};
  for (const u of updates) {
    result[u.venueId] = {
      count: u.count,
      capacity: u.capacity,
      pct: u.capacity > 0 ? Math.round((u.count / u.capacity) * 100) : 0,
    };
  }
  return result;
}

describe("Seat availability batch processing", () => {
  it("processes empty batch", () => {
    expect(processBatchUpdates([])).toEqual({});
  });

  it("processes single update", () => {
    const result = processBatchUpdates([{ venueId: "v1", count: 3, capacity: 8 }]);
    expect(result["v1"].count).toBe(3);
    expect(result["v1"].pct).toBe(38);
  });

  it("processes multiple venues", () => {
    const result = processBatchUpdates([
      { venueId: "v1", count: 4, capacity: 8 },
      { venueId: "v2", count: 6, capacity: 8 },
    ]);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["v1"].pct).toBe(50);
    expect(result["v2"].pct).toBe(75);
  });

  it("last update wins for duplicate venueId", () => {
    const result = processBatchUpdates([
      { venueId: "v1", count: 3, capacity: 8 },
      { venueId: "v1", count: 5, capacity: 8 },
    ]);
    expect(result["v1"].count).toBe(5);
  });

  it("zero capacity returns 0% (no division by zero)", () => {
    const result = processBatchUpdates([{ venueId: "v1", count: 3, capacity: 0 }]);
    expect(result["v1"].pct).toBe(0);
  });
});
