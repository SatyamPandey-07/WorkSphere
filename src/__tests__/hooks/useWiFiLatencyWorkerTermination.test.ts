import { renderHook } from "@testing-library/react";
import { useWiFiLatency } from "@/hooks/useWiFiLatency";
import { clearAllPingTimers } from "@/workers/wifiLatencyWorker";

describe("useWiFiLatency worker termination", () => {
  let mockWorkerInstances: any[] = [];
  const OriginalWorker = global.Worker;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkerInstances = [];

    global.Worker = jest.fn().mockImplementation(() => {
      const instance = {
        postMessage: jest.fn(),
        terminate: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        onmessage: null as ((e: MessageEvent) => void) | null,
        onerror: null as ((e: any) => void) | null,
      };
      mockWorkerInstances.push(instance);
      return instance;
    }) as unknown as typeof Worker;
  });

  afterEach(() => {
    global.Worker = OriginalWorker;
  });

  it("creates a worker on mount and posts TERMINATE & terminates on unmount", () => {
    const { unmount } = renderHook(() =>
      useWiFiLatency({ venueId: "venue-123" }),
    );

    expect(mockWorkerInstances.length).toBe(1);
    const worker = mockWorkerInstances[0];

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        venueId: "venue-123",
        telemetry: expect.any(Object),
      }),
    );

    unmount();

    expect(worker.postMessage).toHaveBeenCalledWith({ type: "TERMINATE" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("handles errors gracefully if worker.postMessage throws on unmount", () => {
    const { unmount } = renderHook(() =>
      useWiFiLatency({ venueId: "venue-456" }),
    );

    const worker = mockWorkerInstances[0];
    worker.postMessage = jest.fn().mockImplementation((data: any) => {
      if (data?.type === "TERMINATE") {
        throw new Error("Worker is already closed");
      }
    });

    expect(() => unmount()).not.toThrow();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("clearAllPingTimers clears all active ping timers without error", () => {
    expect(() => clearAllPingTimers()).not.toThrow();
  });
});
