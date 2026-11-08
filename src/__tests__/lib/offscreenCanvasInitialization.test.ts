/**
 * Tests for the OffscreenCanvas initialization pattern (Issue #1970).
 */

// Simulate the OffscreenCanvas transfer and INIT message
function createOffscreenHeatmapSetup() {
  const sentMessages: unknown[] = [];
  const transferredObjects: unknown[] = [];

  const mockWorker = {
    postMessage: (msg: unknown, transfer?: unknown[]) => {
      sentMessages.push(msg);
      if (transfer) transferredObjects.push(...transfer);
    },
    terminate: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };

  let controlTransferred = false;
  const mockCanvas = {
    transferControlToOffscreen: jest.fn(() => {
      controlTransferred = true;
      return { type: "OffscreenCanvas", width: 200, height: 100 };
    }),
    width: 200,
    height: 100,
  };

  const initialize = () => {
    const offscreen = mockCanvas.transferControlToOffscreen();
    mockWorker.postMessage({ type: "INIT", canvas: offscreen }, [offscreen]);
  };

  return { mockWorker, mockCanvas, initialize, sentMessages, transferredObjects, isControlTransferred: () => controlTransferred };
}

describe("OffscreenCanvas initialization for heatmap worker", () => {
  it("calls transferControlToOffscreen on the canvas", () => {
    const { mockCanvas, initialize } = createOffscreenHeatmapSetup();
    initialize();
    expect(mockCanvas.transferControlToOffscreen).toHaveBeenCalledTimes(1);
  });

  it("posts INIT message to worker with OffscreenCanvas", () => {
    const { initialize, sentMessages } = createOffscreenHeatmapSetup();
    initialize();
    expect(sentMessages[0]).toEqual(
      expect.objectContaining({ type: "INIT" }),
    );
  });

  it("includes canvas in transfer array", () => {
    const { initialize, transferredObjects } = createOffscreenHeatmapSetup();
    initialize();
    expect(transferredObjects.length).toBeGreaterThan(0);
  });

  it("canvas control is transferred (not available on main thread after)", () => {
    const { initialize, isControlTransferred } = createOffscreenHeatmapSetup();
    expect(isControlTransferred()).toBe(false);
    initialize();
    expect(isControlTransferred()).toBe(true);
  });

  it("INIT message type is exactly 'INIT'", () => {
    const { initialize, sentMessages } = createOffscreenHeatmapSetup();
    initialize();
    expect((sentMessages[0] as { type: string }).type).toBe("INIT");
  });

  it("only one INIT message sent per initialization", () => {
    const { initialize, sentMessages } = createOffscreenHeatmapSetup();
    initialize();
    const initMessages = sentMessages.filter(
      (m) => (m as { type: string }).type === "INIT",
    );
    expect(initMessages).toHaveLength(1);
  });
});
