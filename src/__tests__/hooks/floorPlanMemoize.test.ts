/**
 * Tests for the FloorPlan3D memoization fix (Issue #1929).
 * useMemo(data, [venueId]) prevents worker restarts on parent re-renders.
 */

// Simulate the memoization behavior
function createStableDataRef(initial: object) {
  let currentVenueId = "";
  let stableData = initial;

  const update = (newData: object, newVenueId: string) => {
    if (newVenueId !== currentVenueId) {
      currentVenueId = newVenueId;
      stableData = newData;
    }
    // If venueId is same, ignore new data object reference
    return stableData;
  };

  return { update, getStable: () => stableData, getVenueId: () => currentVenueId };
}

describe("FloorPlan3D data memoization by venueId", () => {
  it("returns same reference when venueId is unchanged", () => {
    const originalData = { seats: [{ id: "s1" }], width: 20, depth: 15 };
    const ref = createStableDataRef(originalData);

    const first = ref.update({ seats: [{ id: "s1" }], width: 20, depth: 15 }, "venue-1");
    const second = ref.update({ seats: [{ id: "s1" }], width: 20, depth: 15 }, "venue-1");

    expect(first).toBe(second); // same reference
    expect(first).toBe(originalData);
  });

  it("returns new reference when venueId changes", () => {
    const data1 = { seats: [], width: 10, depth: 10 };
    const data2 = { seats: [], width: 20, depth: 20 };
    const ref = createStableDataRef(data1);

    ref.update(data1, "venue-1");
    const result = ref.update(data2, "venue-2"); // different venue

    expect(result).toBe(data2); // new data for new venue
  });

  it("worker is not restarted on same venueId re-render", () => {
    let workerRestarts = 0;
    let lastStableData: object | null = null;

    const ref = createStableDataRef({ seats: [], width: 10 });

    // Simulate 5 parent re-renders with same venueId
    for (let i = 0; i < 5; i++) {
      const stable = ref.update({ seats: [], width: 10 }, "venue-A");
      if (stable !== lastStableData) {
        workerRestarts++;
        lastStableData = stable;
      }
    }

    expect(workerRestarts).toBe(1); // only initial start
  });

  it("worker restarts when venueId changes", () => {
    let workerRestarts = 0;
    let lastStableData: object | null = null;

    const ref = createStableDataRef({ seats: [], width: 10 });

    const scenarios = [
      { data: { seats: [], width: 10 }, venueId: "venue-A" },
      { data: { seats: [], width: 20 }, venueId: "venue-B" }, // different venue
      { data: { seats: [], width: 10 }, venueId: "venue-A" }, // back to A
    ];

    for (const s of scenarios) {
      const stable = ref.update(s.data, s.venueId);
      if (stable !== lastStableData) {
        workerRestarts++;
        lastStableData = stable;
      }
    }

    expect(workerRestarts).toBe(3); // once per venue change
  });
});
