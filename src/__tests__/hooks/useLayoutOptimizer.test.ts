import { act, renderHook } from "@testing-library/react";
import { useLayoutOptimizer } from "@/hooks/useLayoutOptimizer";
import type {
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "@/workers/layoutOptimizer.worker";

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent<LayoutWorkerResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = jest.fn();
  terminate = jest.fn();

  constructor() {
    MockWorker.instances.push(this);
  }

  emitMessage(data: LayoutWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<LayoutWorkerResponse>);
  }

  emitError() {
    this.onerror?.(new ErrorEvent("error"));
  }
}

describe("useLayoutOptimizer", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    Object.defineProperty(global, "Worker", {
      value: MockWorker,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("creates a module worker and terminates it on unmount", () => {
    const { unmount } = renderHook(() => useLayoutOptimizer());
    const worker = MockWorker.instances[0];

    expect(worker).toBeDefined();

    unmount();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("transfers the floor-plan Float32Array buffer to the worker", () => {
    const { result } = renderHook(() => useLayoutOptimizer());
    const worker = MockWorker.instances[0];

    act(() => {
      result.current.optimize({
        floorPlanGrid: [0, 1, 1, 0],
        width: 2,
        height: 2,
        deskCount: 1,
        powerOutlets: [{ x: 1, y: 1 }],
      });
    });

    expect(result.current.isOptimizing).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    const [message, transferList] = worker.postMessage.mock.calls[0] as [
      LayoutWorkerRequest,
      Transferable[],
    ];

    expect(message.type).toBe("OPTIMIZE");
    expect(message.payload.width).toBe(2);
    expect(message.payload.height).toBe(2);
    expect(message.payload.floorPlanGridBuffer).toBeInstanceOf(ArrayBuffer);
    expect(transferList).toEqual([message.payload.floorPlanGridBuffer]);
  });

  it("deserializes transferable coordinate buffers from the worker", () => {
    const { result } = renderHook(() => useLayoutOptimizer());
    const worker = MockWorker.instances[0];

    act(() => {
      result.current.optimize({
        floorPlanGrid: new Float32Array([0, 0, 0, 0]),
        width: 2,
        height: 2,
        deskCount: 2,
        powerOutlets: [],
      });
    });

    const request = worker.postMessage.mock.calls[0][0] as LayoutWorkerRequest;
    const desks = new Float32Array([1, 2, 0, 3, 4, Math.PI]);
    const quietZones = new Float32Array([5, 6, 2]);

    act(() => {
      worker.emitMessage({
        type: "SUCCESS",
        sequenceId: request.sequenceId,
        payload: {
          deskCoordinatesBuffer: desks.buffer,
          quietZoneCoordinatesBuffer: quietZones.buffer,
          score: 0.91,
        },
      });
    });

    expect(result.current.recommendation).toEqual({
      desks: [
        { x: 1, y: 2, orientation: 0 },
        {
          x: 3,
          y: 4,
          orientation: expect.closeTo(Math.PI),
        },
      ],
      quietZones: [{ x: 5, y: 6, radius: 2 }],
      score: 0.91,
    });
    expect(result.current.isOptimizing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces worker errors and keeps the previous result unchanged", () => {
    const { result } = renderHook(() => useLayoutOptimizer());
    const worker = MockWorker.instances[0];

    act(() => {
      result.current.optimize({
        floorPlanGrid: [0],
        width: 1,
        height: 1,
        deskCount: 1,
        powerOutlets: [],
      });
    });

    const request = worker.postMessage.mock.calls[0][0] as LayoutWorkerRequest;

    act(() => {
      worker.emitMessage({
        type: "ERROR",
        sequenceId: request.sequenceId,
        error: "Invalid floor-plan dimensions.",
      });
    });

    expect(result.current.error).toBe("Invalid floor-plan dimensions.");
    expect(result.current.isOptimizing).toBe(false);
    expect(result.current.recommendation).toBeNull();
  });

  it("ignores stale responses from an older optimization request", () => {
    const { result } = renderHook(() => useLayoutOptimizer());
    const worker = MockWorker.instances[0];

    act(() => {
      result.current.optimize({
        floorPlanGrid: [0],
        width: 1,
        height: 1,
        deskCount: 1,
        powerOutlets: [],
      });

      result.current.optimize({
        floorPlanGrid: [0, 0, 0, 0],
        width: 2,
        height: 2,
        deskCount: 1,
        powerOutlets: [],
      });
    });

    const firstRequest = worker.postMessage.mock
      .calls[0][0] as LayoutWorkerRequest;

    act(() => {
      worker.emitMessage({
        type: "ERROR",
        sequenceId: firstRequest.sequenceId,
        error: "Stale error",
      });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isOptimizing).toBe(true);
  });

  it("ignores out-of-order SUCCESS layout messages", () => {
    const { result } = renderHook(() => useLayoutOptimizer());
    const worker = MockWorker.instances[0];

    act(() => {
      // First request (sequenceId 1)
      result.current.optimize({
        floorPlanGrid: [0],
        width: 1,
        height: 1,
        deskCount: 1,
        powerOutlets: [],
      });

      // Second request (sequenceId 2)
      result.current.optimize({
        floorPlanGrid: [0, 0, 0, 0],
        width: 2,
        height: 2,
        deskCount: 1,
        powerOutlets: [],
      });
    });

    const firstRequest = worker.postMessage.mock
      .calls[0][0] as LayoutWorkerRequest;

    act(() => {
      // Respond to the first request (out-of-order because we already sent request 2)
      const desks = new Float32Array([1, 2, 0]);
      const quietZones = new Float32Array([5, 6, 2]);

      worker.emitMessage({
        type: "SUCCESS",
        sequenceId: firstRequest.sequenceId,
        payload: {
          deskCoordinatesBuffer: desks.buffer,
          quietZoneCoordinatesBuffer: quietZones.buffer,
          score: 0.8,
        },
      });
    });

    // Should ignore the first request's SUCCESS and still be optimizing the second one
    expect(result.current.recommendation).toBeNull();
    expect(result.current.isOptimizing).toBe(true);
  });
});
