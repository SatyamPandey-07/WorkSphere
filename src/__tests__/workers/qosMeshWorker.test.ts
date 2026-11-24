/**
 * Tests for QoS Mesh Web Worker Lifecycle, Idempotent Initialization,
 * and Shutdown Cleanup (#10085).
 */

import {
  analyzer,
  handleWorkerMessage,
  qosEngine,
  getEvaluationInterval,
  resetWorkerState,
  stopEvaluation,
} from "@/workers/qosMeshWorker";

describe("qosMeshWorker Lifecycle & Idempotent Initialization (#10085)", () => {
  const originalPostMessage =
    typeof self !== "undefined" ? self.postMessage : undefined;
  const mockPostMessage = jest.fn();

  beforeAll(() => {
    if (typeof self === "undefined") {
      (global as any).self = global;
    }
    self.postMessage = mockPostMessage;
  });

  afterAll(() => {
    if (originalPostMessage) {
      self.postMessage = originalPostMessage;
    } else {
      delete (self as any).postMessage;
    }
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetWorkerState();
  });

  afterEach(() => {
    resetWorkerState();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("sets an evaluation interval on initial INIT message", () => {
    expect(getEvaluationInterval()).toBeNull();

    handleWorkerMessage({
      data: {
        type: "INIT",
        payload: {
          policy: {
            maxBandwidthBps: 20_000_000,
            voipReserveBps: 2_000_000,
            fairShareFactor: 0.8,
          },
        },
      },
    });

    expect(getEvaluationInterval()).not.toBeNull();
    expect(qosEngine).not.toBeNull();
  });

  it("clears previous interval on repeated INIT messages to prevent duplicate timers", () => {
    const clearIntervalSpy = jest.spyOn(self, "clearInterval");

    // First INIT
    handleWorkerMessage({ data: { type: "INIT" } });
    const firstInterval = getEvaluationInterval();
    expect(firstInterval).not.toBeNull();

    // Second INIT
    handleWorkerMessage({ data: { type: "INIT" } });
    const secondInterval = getEvaluationInterval();
    expect(secondInterval).not.toBeNull();
    expect(clearIntervalSpy).toHaveBeenCalledWith(firstInterval);

    // Third INIT
    handleWorkerMessage({ data: { type: "INIT" } });
    const thirdInterval = getEvaluationInterval();
    expect(thirdInterval).not.toBeNull();
    expect(clearIntervalSpy).toHaveBeenCalledWith(secondInterval);

    clearIntervalSpy.mockRestore();
  });

  it("ensures only one set of throttle notifications is produced per second after multiple INIT calls", () => {
    // Send INIT 5 times in a row
    for (let i = 0; i < 5; i++) {
      handleWorkerMessage({ data: { type: "INIT" } });
    }

    // Register peers and establish a bandwidth hog (need at least 3 peers so hog variance > 2 * avgVariance)
    handleWorkerMessage({
      data: { type: "PEER_JOINED", payload: { peerId: "peer-normal-1" } },
    });
    handleWorkerMessage({
      data: { type: "PEER_JOINED", payload: { peerId: "peer-normal-2" } },
    });
    handleWorkerMessage({
      data: { type: "PEER_JOINED", payload: { peerId: "peer-hog" } },
    });

    // Send telemetry to trigger hog identification (needs >= 5 samples)
    for (let i = 0; i < 10; i++) {
      handleWorkerMessage({
        data: {
          type: "TELEMETRY_UPDATE",
          payload: {
            peerId: "peer-normal-1",
            rtt: 30,
            ackDelay: 10,
            bytesPerSec: 50_000,
          },
        },
      });
      handleWorkerMessage({
        data: {
          type: "TELEMETRY_UPDATE",
          payload: {
            peerId: "peer-normal-2",
            rtt: 35,
            ackDelay: 12,
            bytesPerSec: 50_000,
          },
        },
      });
      handleWorkerMessage({
        data: {
          type: "TELEMETRY_UPDATE",
          payload: {
            peerId: "peer-hog",
            rtt: 150,
            ackDelay: i % 2 === 0 ? 10 : 300, // High variance
            bytesPerSec: 5_000_000,
          },
        },
      });
    }

    // Advance fake timers by 1 second (one interval tick)
    jest.advanceTimersByTime(1000);

    // Exactly 1 THROTTLE_APPLIED message must be posted, NOT 5 duplicate messages
    const throttleCalls = mockPostMessage.mock.calls.filter(
      (call) => call[0]?.type === "THROTTLE_APPLIED",
    );
    expect(throttleCalls).toHaveLength(1);
    expect(throttleCalls[0][0].payload.peerId).toBe("peer-hog");

    // Advance another 1 second
    jest.advanceTimersByTime(1000);
    const subsequentCalls = mockPostMessage.mock.calls.filter(
      (call) => call[0]?.type === "THROTTLE_APPLIED",
    );
    expect(subsequentCalls).toHaveLength(2);
  });

  it("clears evaluation timer and resets runtime state on TERMINATE", () => {
    const clearIntervalSpy = jest.spyOn(self, "clearInterval");

    handleWorkerMessage({ data: { type: "INIT" } });
    handleWorkerMessage({
      data: { type: "PEER_JOINED", payload: { peerId: "peer-1" } },
    });

    expect(getEvaluationInterval()).not.toBeNull();
    expect(analyzer.hasPeer("peer-1")).toBe(true);

    // Send TERMINATE
    handleWorkerMessage({ data: { type: "TERMINATE" } });

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(getEvaluationInterval()).toBeNull();
    expect(qosEngine).toBeNull();
    expect(analyzer.getMetrics()).toEqual([]);
    expect(analyzer.hasPeer("peer-1")).toBe(false);

    // Further timer advancement should not trigger evaluations or notifications
    mockPostMessage.mockClear();
    jest.advanceTimersByTime(5000);
    expect(mockPostMessage).not.toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });

  it("supports SHUTDOWN and CLEANUP message types equivalently", () => {
    handleWorkerMessage({ data: { type: "INIT" } });
    expect(getEvaluationInterval()).not.toBeNull();

    handleWorkerMessage({ data: { type: "SHUTDOWN" } });
    expect(getEvaluationInterval()).toBeNull();
    expect(qosEngine).toBeNull();

    // Re-init and cleanup
    handleWorkerMessage({ data: { type: "INIT" } });
    expect(getEvaluationInterval()).not.toBeNull();

    handleWorkerMessage({ data: { type: "CLEANUP" } });
    expect(getEvaluationInterval()).toBeNull();
    expect(qosEngine).toBeNull();
  });

  it("safely handles stopEvaluation when no interval is active", () => {
    expect(() => stopEvaluation()).not.toThrow();
    expect(getEvaluationInterval()).toBeNull();
  });
});
