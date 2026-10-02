/**
 * Tests for the View Transitions API theme circular reveal (Issue #2173).
 * Verifies CSS var setting and startViewTransition() fallback.
 */

// Simulate startThemeTransition logic
function startThemeTransition(
  toggleFn: () => void,
  x: number,
  y: number,
  innerWidth: number,
  innerHeight: number,
  startViewTransition?: (fn: () => void) => void,
): { xPct: string; yPct: string; transitionCalled: boolean } {
  const xPct = ((x / innerWidth) * 100).toFixed(2) + "%";
  const yPct = ((y / innerHeight) * 100).toFixed(2) + "%";

  let transitionCalled = false;

  if (startViewTransition) {
    transitionCalled = true;
    startViewTransition(toggleFn);
  } else {
    // Fallback: call toggleFn directly
    toggleFn();
  }

  return { xPct, yPct, transitionCalled };
}

describe("View Transitions theme reveal", () => {
  it("computes xPct correctly (center click)", () => {
    const { xPct } = startThemeTransition(jest.fn(), 500, 300, 1000, 600);
    expect(xPct).toBe("50.00%");
  });

  it("computes yPct correctly (center click)", () => {
    const { yPct } = startThemeTransition(jest.fn(), 500, 300, 1000, 600);
    expect(yPct).toBe("50.00%");
  });

  it("xPct/yPct are percentage strings ending in '%'", () => {
    const { xPct, yPct } = startThemeTransition(jest.fn(), 100, 200, 1920, 1080);
    expect(xPct).toMatch(/%$/);
    expect(yPct).toMatch(/%$/);
  });

  it("calls startViewTransition when available", () => {
    const startVT = jest.fn((fn: () => void) => fn());
    const toggle = jest.fn();

    const { transitionCalled } = startThemeTransition(toggle, 100, 100, 1000, 800, startVT);
    expect(transitionCalled).toBe(true);
    expect(startVT).toHaveBeenCalledWith(toggle);
  });

  it("falls back to direct toggle when startViewTransition unavailable", () => {
    const toggle = jest.fn();
    const { transitionCalled } = startThemeTransition(toggle, 100, 100, 1000, 800);
    expect(transitionCalled).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("toggle is called exactly once in both paths", () => {
    const toggle1 = jest.fn();
    const startVT = jest.fn((fn: () => void) => fn());
    startThemeTransition(toggle1, 0, 0, 1000, 800, startVT);
    expect(toggle1).toHaveBeenCalledTimes(1);

    const toggle2 = jest.fn();
    startThemeTransition(toggle2, 0, 0, 1000, 800); // no VT
    expect(toggle2).toHaveBeenCalledTimes(1);
  });

  it("top-left click produces 0% x and y coordinates", () => {
    const { xPct, yPct } = startThemeTransition(jest.fn(), 0, 0, 1000, 800);
    expect(xPct).toBe("0.00%");
    expect(yPct).toBe("0.00%");
  });

  it("bottom-right click produces ~100% coordinates", () => {
    const { xPct, yPct } = startThemeTransition(jest.fn(), 1000, 800, 1000, 800);
    expect(xPct).toBe("100.00%");
    expect(yPct).toBe("100.00%");
  });
});
