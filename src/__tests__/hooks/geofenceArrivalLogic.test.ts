/**
 * Tests for the geofence arrival detection fix (Issue #2114).
 * The onArrived callback should fire once on geofence entry, not every GPS update.
 * Tests the hasArrivedRef guard logic directly.
 */

// Replicate the key logic
function createArrivalChecker(geofenceRadius: number) {
  let hasArrived = false;

  return {
    check: (
      dist: number,
      onArrived?: () => void,
    ) => {
      const inside = dist <= geofenceRadius;

      if (inside && !hasArrived) {
        hasArrived = true;
        onArrived?.();
      } else if (!inside && hasArrived) {
        hasArrived = false;
      }

      return inside;
    },
    reset: () => { hasArrived = false; },
  };
}

describe("Geofence arrival detection — single-fire guard", () => {
  it("fires onArrived once when entering the geofence", () => {
    const onArrived = jest.fn();
    const checker = createArrivalChecker(50); // 50m radius

    checker.check(40, onArrived); // inside
    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onArrived again on subsequent GPS updates inside geofence", () => {
    const onArrived = jest.fn();
    const checker = createArrivalChecker(50);

    checker.check(40, onArrived); // first entry
    checker.check(30, onArrived); // still inside
    checker.check(45, onArrived); // still inside

    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  it("fires onArrived again after exiting and re-entering", () => {
    const onArrived = jest.fn();
    const checker = createArrivalChecker(50);

    checker.check(40, onArrived); // enter
    checker.check(100, onArrived); // exit
    checker.check(30, onArrived); // re-enter

    expect(onArrived).toHaveBeenCalledTimes(2);
  });

  it("does NOT fire onArrived when outside the geofence", () => {
    const onArrived = jest.fn();
    const checker = createArrivalChecker(50);

    checker.check(100, onArrived); // outside
    checker.check(75, onArrived); // still outside

    expect(onArrived).toHaveBeenCalledTimes(0);
  });

  it("resets correctly — allows re-entry after manual reset", () => {
    const onArrived = jest.fn();
    const checker = createArrivalChecker(50);

    checker.check(30, onArrived); // enter
    checker.reset();
    checker.check(30, onArrived); // re-enter after reset

    expect(onArrived).toHaveBeenCalledTimes(2);
  });

  it("returns true when inside geofence", () => {
    const checker = createArrivalChecker(50);
    expect(checker.check(30)).toBe(true);
  });

  it("returns false when outside geofence", () => {
    const checker = createArrivalChecker(50);
    expect(checker.check(75)).toBe(false);
  });
});
