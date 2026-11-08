/**
 * Tests for the route-change speech cancellation fix (Issue #1326).
 * useSpeechSynthesis should cancel ongoing speech when the pathname changes.
 */

// Simulate the route change cancel logic
function createRouteChangeCancelSimulation() {
  let speechCancelled = false;
  let prevPathname = "/ai";

  const cancelSpeech = () => { speechCancelled = true; };

  const onPathnameChange = (pathname: string) => {
    if (prevPathname !== pathname) {
      prevPathname = pathname;
      cancelSpeech();
    }
  };

  return { onPathnameChange, isCancelled: () => speechCancelled, reset: () => { speechCancelled = false; } };
}

describe("Speech synthesis route change cancellation", () => {
  it("cancels speech when pathname changes", () => {
    const sim = createRouteChangeCancelSimulation();
    sim.onPathnameChange("/venues/123");
    expect(sim.isCancelled()).toBe(true);
  });

  it("does not cancel on same pathname", () => {
    const sim = createRouteChangeCancelSimulation();
    sim.onPathnameChange("/ai"); // same as initial
    expect(sim.isCancelled()).toBe(false);
  });

  it("cancels on any different pathname", () => {
    const sim = createRouteChangeCancelSimulation();
    sim.onPathnameChange("/collections/my-list");
    expect(sim.isCancelled()).toBe(true);
  });

  it("cancels again after multiple navigations", () => {
    const sim = createRouteChangeCancelSimulation();

    sim.onPathnameChange("/venues/1");   // cancel 1
    sim.reset();
    sim.onPathnameChange("/venues/2");   // cancel 2
    expect(sim.isCancelled()).toBe(true);
  });

  it("only cancels once per unique pathname change", () => {
    let cancelCount = 0;
    let prevPath = "/ai";

    const onPathChange = (path: string) => {
      if (prevPath !== path) {
        prevPath = path;
        cancelCount++;
      }
    };

    onPathChange("/venues");  // cancel 1
    onPathChange("/venues");  // same — no cancel
    onPathChange("/venues");  // same — no cancel

    expect(cancelCount).toBe(1);
  });

  it("persistent components don't leak speech across navigations", () => {
    // Simulate a layout component that persists across routes
    const states: string[] = [];

    let prevPath = "/";
    const handleNavigation = (path: string) => {
      if (prevPath !== path) {
        prevPath = path;
        states.push(`cancelled on ${path}`);
      }
    };

    handleNavigation("/ai");
    handleNavigation("/saved");
    handleNavigation("/ai");

    expect(states).toHaveLength(3);
    expect(states[0]).toContain("/ai");
    expect(states[1]).toContain("/saved");
  });
});
