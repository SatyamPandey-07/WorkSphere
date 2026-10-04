/**
 * Tests for the hasArrivedRef pattern in useArrivalDetection (Issue #2114).
 * Verifies single-fire behavior using the ref-based guard.
 */

// Replicate the hasArrivedRef pattern
class ArrivalDetector {
  private hasArrived = false;
  private callCount = 0;

  check(isInside: boolean, onArrived?: () => void, onLeft?: () => void): void {
    if (isInside && !this.hasArrived) {
      this.hasArrived = true;
      this.callCount++;
      onArrived?.();
    } else if (!isInside && this.hasArrived) {
      this.hasArrived = false;
      onLeft?.();
    }
  }

  getCallCount(): number { return this.callCount; }
  isInsideGeofence(): boolean { return this.hasArrived; }
  reset(): void { this.hasArrived = false; this.callCount = 0; }
}

describe("hasArrivedRef geofence guard", () => {
  it("fires onArrived exactly once on first entry", () => {
    const detector = new ArrivalDetector();
    const onArrived = jest.fn();

    detector.check(true, onArrived);
    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onArrived again on subsequent inside-geofence updates", () => {
    const detector = new ArrivalDetector();
    const onArrived = jest.fn();

    detector.check(true, onArrived); // first entry
    detector.check(true, onArrived); // still inside
    detector.check(true, onArrived); // still inside
    detector.check(true, onArrived); // still inside

    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  it("fires onArrived again after exit + re-entry", () => {
    const detector = new ArrivalDetector();
    const onArrived = jest.fn();

    detector.check(true, onArrived); // enter
    detector.check(false, onArrived); // exit
    detector.check(true, onArrived); // re-enter

    expect(onArrived).toHaveBeenCalledTimes(2);
  });

  it("does NOT fire onArrived when starting outside geofence", () => {
    const detector = new ArrivalDetector();
    const onArrived = jest.fn();

    detector.check(false, onArrived); // outside
    detector.check(false, onArrived); // still outside

    expect(onArrived).not.toHaveBeenCalled();
  });

  it("resets hasArrivedRef on exit", () => {
    const detector = new ArrivalDetector();

    detector.check(true);  // enter
    expect(detector.isInsideGeofence()).toBe(true);

    detector.check(false); // exit
    expect(detector.isInsideGeofence()).toBe(false);
  });

  it("N entries with M exits fires N onArrived calls", () => {
    const detector = new ArrivalDetector();
    const onArrived = jest.fn();

    for (let i = 0; i < 5; i++) {
      detector.check(true, onArrived);  // enter
      detector.check(false, onArrived); // exit
    }

    expect(onArrived).toHaveBeenCalledTimes(5);
  });

  it("callCount increments only on entry transitions", () => {
    const detector = new ArrivalDetector();

    // 10 GPS updates inside (should only count once)
    for (let i = 0; i < 10; i++) detector.check(true);
    expect(detector.getCallCount()).toBe(1);
  });
});
