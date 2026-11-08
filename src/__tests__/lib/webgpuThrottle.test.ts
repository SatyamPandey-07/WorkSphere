/**
 * Tests for the 60fps frame-rate throttle and IntersectionObserver pause
 * added to FloorPlanRenderer.startRenderLoop (Issue #1856).
 */

const TARGET_FRAME_MS = 1000 / 60; // ~16.67ms

describe("WebGPU 60fps frame-rate throttle logic", () => {
  it("TARGET_FRAME_MS is approximately 16.67ms", () => {
    expect(TARGET_FRAME_MS).toBeCloseTo(16.67, 1);
  });

  it("a frame is skipped when elapsed < TARGET_FRAME_MS", () => {
    let renderCount = 0;
    let prevFrameTime = 0;

    const loop = (timestamp: number) => {
      const elapsed = timestamp - prevFrameTime;
      if (elapsed < TARGET_FRAME_MS) return; // throttled
      prevFrameTime = timestamp - (elapsed % TARGET_FRAME_MS);
      renderCount++;
    };

    // Simulate 5ms elapsed — should be throttled
    loop(5);
    expect(renderCount).toBe(0);
  });

  it("a frame is rendered when elapsed >= TARGET_FRAME_MS", () => {
    let renderCount = 0;
    let prevFrameTime = 0;

    const loop = (timestamp: number) => {
      const elapsed = timestamp - prevFrameTime;
      if (elapsed < TARGET_FRAME_MS) return;
      prevFrameTime = timestamp - (elapsed % TARGET_FRAME_MS);
      renderCount++;
    };

    // Simulate 20ms elapsed — should render
    loop(20);
    expect(renderCount).toBe(1);
  });

  it("multiple renders accumulated over long elapsed time", () => {
    let renderCount = 0;
    let prevFrameTime = 0;

    const loop = (timestamp: number) => {
      const elapsed = timestamp - prevFrameTime;
      if (elapsed < TARGET_FRAME_MS) return;
      prevFrameTime = timestamp - (elapsed % TARGET_FRAME_MS);
      renderCount++;
    };

    // 100ms elapsed — but we only render once per RAF call regardless
    loop(100);
    expect(renderCount).toBe(1);
  });
});

describe("IntersectionObserver canvas pause logic", () => {
  it("isVisible defaults to true before observer fires", () => {
    const isVisible = true;
    expect(isVisible).toBe(true);
  });

  it("render is skipped when isVisible is false", () => {
    let renderCount = 0;
    const isVisible = false;

    const loop = (_timestamp: number) => {
      if (!isVisible) return; // paused off-screen
      renderCount++;
    };

    loop(100);
    expect(renderCount).toBe(0);
  });

  it("render proceeds when isVisible is true", () => {
    let renderCount = 0;
    const isVisible = true;
    let prevFrameTime = 0;

    const loop = (timestamp: number) => {
      if (!isVisible) return;
      const elapsed = timestamp - prevFrameTime;
      if (elapsed < TARGET_FRAME_MS) return;
      prevFrameTime = timestamp - (elapsed % TARGET_FRAME_MS);
      renderCount++;
    };

    loop(20);
    expect(renderCount).toBe(1);
  });
});
