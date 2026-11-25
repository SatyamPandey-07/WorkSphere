/**
 * Focused unit tests for QoS Mesh Peer Auto-Reconnect with Exponential Backoff (#10112).
 * Verifies:
 * - First retry uses initial delay plus jitter
 * - Subsequent retries increase exponentially
 * - Delay is capped at 30000ms
 * - Jitter stays within the 0-500ms range
 * - Successful ping acknowledgment resets the attempt counter
 * - Different peers maintain independent retry counters
 * - Duplicate failures do not create multiple active reconnect timers
 * - Removing a peer clears its pending reconnect timer
 * - Fake timers and deterministic mocked randomness
 */

import {
  calculateBackoffDelay,
  schedulePeerReconnect,
  getPeerReconnectState,
  handlePingAck,
  resetPeerReconnect,
  handleWorkerMessage,
  resetWorkerState,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  MAX_RECONNECT_JITTER_MS,
} from "@/workers/qosMeshWorker";
import {
  calculateReconnectBackoffDelay,
  scheduleMeshPeerReconnect,
  getMeshPeerReconnectState,
  handleMeshPeerPingAck,
  resetMeshPeerReconnect,
  clearAllMeshPeerReconnects,
  MeshPeerConnection,
} from "@/lib/realtime/webrtc/meshConnection";

describe("QoS Mesh Peer Auto-Reconnect with Exponential Backoff (#10112)", () => {
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
    clearAllMeshPeerReconnects();
  });

  afterEach(() => {
    resetWorkerState();
    clearAllMeshPeerReconnects();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("Backoff Formula and Delay Calculation", () => {
    it("first retry (attempt 0) uses initial delay (1000ms) plus jitter", () => {
      // With mocked jitter = 0
      const delayNoJitter = calculateBackoffDelay(0, { randomJitter: 0 });
      expect(delayNoJitter).toBe(1000);

      // With mocked jitter = 250
      const delayWithJitter = calculateBackoffDelay(0, { randomJitter: 250 });
      expect(delayWithJitter).toBe(1250);

      // Also in meshConnection
      expect(calculateReconnectBackoffDelay(0, { randomJitter: 0 })).toBe(1000);
      expect(calculateReconnectBackoffDelay(0, { randomJitter: 250 })).toBe(1250);
    });

    it("subsequent retries increase exponentially: 1000 * 2^attempts + jitter", () => {
      // attempts: 0 -> 1000, 1 -> 2000, 2 -> 4000, 3 -> 8000, 4 -> 16000
      expect(calculateBackoffDelay(0, { randomJitter: 0 })).toBe(1000);
      expect(calculateBackoffDelay(1, { randomJitter: 0 })).toBe(2000);
      expect(calculateBackoffDelay(2, { randomJitter: 0 })).toBe(4000);
      expect(calculateBackoffDelay(3, { randomJitter: 0 })).toBe(8000);
      expect(calculateBackoffDelay(4, { randomJitter: 0 })).toBe(16000);
      expect(calculateBackoffDelay(5, { randomJitter: 0 })).toBe(30000); // capped at 30000

      // In meshConnection
      expect(calculateReconnectBackoffDelay(1, { randomJitter: 100 })).toBe(2100);
      expect(calculateReconnectBackoffDelay(2, { randomJitter: 100 })).toBe(4100);
      expect(calculateReconnectBackoffDelay(3, { randomJitter: 100 })).toBe(8100);
      expect(calculateReconnectBackoffDelay(4, { randomJitter: 100 })).toBe(16100);
    });

    it("delay is capped at 30000ms maximum regardless of high attempt count or jitter", () => {
      expect(calculateBackoffDelay(5, { randomJitter: 500 })).toBe(30000);
      expect(calculateBackoffDelay(6, { randomJitter: 500 })).toBe(30000);
      expect(calculateBackoffDelay(10, { randomJitter: 500 })).toBe(30000);
      expect(calculateBackoffDelay(20, { randomJitter: 500 })).toBe(30000);

      // In meshConnection
      expect(calculateReconnectBackoffDelay(5, { randomJitter: 500 })).toBe(30000);
      expect(calculateReconnectBackoffDelay(10, { randomJitter: 500 })).toBe(30000);
    });

    it("jitter stays strictly within the 0-500ms range when using Math.random", () => {
      const mockRandom = jest.spyOn(Math, "random");

      // Minimum jitter (random = 0)
      mockRandom.mockReturnValue(0);
      const minDelay = calculateBackoffDelay(0);
      expect(minDelay).toBe(1000);

      // Maximum jitter (random = 0.999999)
      mockRandom.mockReturnValue(1);
      const maxDelay = calculateBackoffDelay(0);
      expect(maxDelay).toBe(1500);

      // Mid-point jitter (random = 0.5)
      mockRandom.mockReturnValue(0.5);
      const midDelay = calculateBackoffDelay(0);
      expect(midDelay).toBe(1250);

      expect(INITIAL_RECONNECT_DELAY_MS).toBe(1000);
      expect(MAX_RECONNECT_DELAY_MS).toBe(30000);
      expect(MAX_RECONNECT_JITTER_MS).toBe(500);
    });
  });

  describe("qosMeshWorker Peer Reconnect Lifecycle", () => {
    it("schedules reconnection with exponential backoff on consecutive failures", () => {
      // First attempt
      const delay1 = schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      expect(delay1).toBe(1000);
      let state = getPeerReconnectState("peer-alpha");
      expect(state.attempts).toBe(1);
      expect(state.hasActiveTimer).toBe(true);

      // Advance timer by delay1
      jest.advanceTimersByTime(delay1!);
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "RECONNECT_PEER",
        payload: {
          peerId: "peer-alpha",
          attempt: 1,
          scheduledDelayMs: 1000,
        },
      });
      state = getPeerReconnectState("peer-alpha");
      expect(state.hasActiveTimer).toBe(false);

      // Second attempt
      const delay2 = schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      expect(delay2).toBe(2000);
      state = getPeerReconnectState("peer-alpha");
      expect(state.attempts).toBe(2);

      jest.advanceTimersByTime(delay2!);
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "RECONNECT_PEER",
        payload: {
          peerId: "peer-alpha",
          attempt: 2,
          scheduledDelayMs: 2000,
        },
      });

      // Third attempt
      const delay3 = schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      expect(delay3).toBe(4000);
      jest.advanceTimersByTime(delay3!);
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "RECONNECT_PEER",
        payload: {
          peerId: "peer-alpha",
          attempt: 3,
          scheduledDelayMs: 4000,
        },
      });
    });

    it("duplicate failures do not create multiple active reconnect timers for the same peer", () => {
      const delay1 = schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      expect(delay1).toBe(1000);

      // Second call while first timer is pending returns null
      const duplicateSchedule = schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      expect(duplicateSchedule).toBeNull();

      // State still reflects 1 attempt
      const state = getPeerReconnectState("peer-alpha");
      expect(state.attempts).toBe(1);
      expect(state.hasActiveTimer).toBe(true);

      // Only one message is sent when timer fires
      jest.advanceTimersByTime(1000);
      expect(mockPostMessage).toHaveBeenCalledTimes(1);
    });

    it("different peers maintain independent retry counters and timers", () => {
      const delayA1 = schedulePeerReconnect("peer-A", { randomJitter: 0 });
      expect(delayA1).toBe(1000);
      jest.advanceTimersByTime(1000);

      const delayA2 = schedulePeerReconnect("peer-A", { randomJitter: 0 });
      expect(delayA2).toBe(2000);

      // Now peer-B fails for the first time
      const delayB1 = schedulePeerReconnect("peer-B", { randomJitter: 0 });
      expect(delayB1).toBe(1000);

      const stateA = getPeerReconnectState("peer-A");
      const stateB = getPeerReconnectState("peer-B");
      expect(stateA.attempts).toBe(2);
      expect(stateB.attempts).toBe(1);
    });

    it("successful ping acknowledgment resets the attempt counter", () => {
      schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      jest.advanceTimersByTime(1000);
      schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      jest.advanceTimersByTime(2000);

      expect(getPeerReconnectState("peer-alpha").attempts).toBe(2);

      // Ping ack received
      handlePingAck("peer-alpha");
      expect(getPeerReconnectState("peer-alpha").attempts).toBe(0);

      // Next reconnect attempt starts at initial delay again
      const nextDelay = schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      expect(nextDelay).toBe(1000);
    });

    it("removing a peer (PEER_LEFT) or permanent disconnect clears its pending reconnect timer", () => {
      schedulePeerReconnect("peer-alpha", { randomJitter: 0 });
      expect(getPeerReconnectState("peer-alpha").hasActiveTimer).toBe(true);

      // Peer leaves
      resetPeerReconnect("peer-alpha");
      expect(getPeerReconnectState("peer-alpha").hasActiveTimer).toBe(false);
      expect(getPeerReconnectState("peer-alpha").attempts).toBe(0);

      // Advancing time should not fire any postMessage
      mockPostMessage.mockClear();
      jest.advanceTimersByTime(5000);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it("worker message protocol: PEER_DISCONNECTED, PING_ACK, PEER_JOINED, and TERMINATE handlers", () => {
      // 1. PEER_DISCONNECTED triggers schedulePeerReconnect
      handleWorkerMessage({
        data: {
          type: "PEER_DISCONNECTED",
          payload: { peerId: "peer-worker-test", options: { randomJitter: 0 } },
        },
      });

      expect(getPeerReconnectState("peer-worker-test").hasActiveTimer).toBe(true);
      expect(getPeerReconnectState("peer-worker-test").attempts).toBe(1);

      jest.advanceTimersByTime(1000);
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "RECONNECT_PEER",
          payload: expect.objectContaining({ peerId: "peer-worker-test", attempt: 1 }),
        })
      );

      // 2. PING_ACK resets attempt counter
      handleWorkerMessage({
        data: {
          type: "PING_ACK",
          payload: { peerId: "peer-worker-test" },
        },
      });
      expect(getPeerReconnectState("peer-worker-test").attempts).toBe(0);

      // 3. PEER_JOINED clears reconnect state
      schedulePeerReconnect("peer-worker-test", { randomJitter: 0 });
      expect(getPeerReconnectState("peer-worker-test").hasActiveTimer).toBe(true);

      handleWorkerMessage({
        data: {
          type: "PEER_JOINED",
          payload: { peerId: "peer-worker-test" },
        },
      });
      expect(getPeerReconnectState("peer-worker-test").hasActiveTimer).toBe(false);

      // 4. SHUTDOWN / TERMINATE / CLEANUP clears all reconnect timers
      schedulePeerReconnect("peer-1", { randomJitter: 0 });
      schedulePeerReconnect("peer-2", { randomJitter: 0 });

      handleWorkerMessage({ data: { type: "TERMINATE" } });
      expect(getPeerReconnectState("peer-1").hasActiveTimer).toBe(false);
      expect(getPeerReconnectState("peer-2").hasActiveTimer).toBe(false);
    });
  });

  describe("meshConnection Peer Reconnect Mechanism", () => {
    it("schedules reconnect callback with backoff and clears on successful connection", () => {
      const reconnectCb = jest.fn();

      const delay1 = scheduleMeshPeerReconnect("peer-rtc-1", reconnectCb, { randomJitter: 0 });
      expect(delay1).toBe(1000);
      expect(getMeshPeerReconnectState("peer-rtc-1").attempts).toBe(1);
      expect(getMeshPeerReconnectState("peer-rtc-1").hasActiveTimer).toBe(true);

      // Duplicate schedule while timer active
      expect(scheduleMeshPeerReconnect("peer-rtc-1", reconnectCb)).toBeNull();

      jest.advanceTimersByTime(1000);
      expect(reconnectCb).toHaveBeenCalledTimes(1);
      expect(getMeshPeerReconnectState("peer-rtc-1").hasActiveTimer).toBe(false);

      // Second retry
      const delay2 = scheduleMeshPeerReconnect("peer-rtc-1", reconnectCb, { randomJitter: 0 });
      expect(delay2).toBe(2000);
      expect(getMeshPeerReconnectState("peer-rtc-1").attempts).toBe(2);

      // Reset upon ping ack
      handleMeshPeerPingAck("peer-rtc-1");
      expect(getMeshPeerReconnectState("peer-rtc-1").attempts).toBe(0);

      // Reset / remove
      resetMeshPeerReconnect("peer-rtc-1");
      expect(getMeshPeerReconnectState("peer-rtc-1").attempts).toBe(0);
      expect(getMeshPeerReconnectState("peer-rtc-1").hasActiveTimer).toBe(false);
    });

    it("MeshPeerConnection closes and resets reconnect state cleanly", () => {
      const mockPc = {
        close: jest.fn(),
        onicecandidate: null,
        oniceconnectionstatechange: null,
      };
      (globalThis as any).RTCPeerConnection = jest.fn().mockImplementation(() => mockPc);

      const peer = new MeshPeerConnection({ peerId: "peer-cleanup-test" });
      scheduleMeshPeerReconnect("peer-cleanup-test", jest.fn(), { randomJitter: 0 });
      expect(getMeshPeerReconnectState("peer-cleanup-test").hasActiveTimer).toBe(true);

      peer.close();
      expect(getMeshPeerReconnectState("peer-cleanup-test").hasActiveTimer).toBe(false);
      expect(getMeshPeerReconnectState("peer-cleanup-test").attempts).toBe(0);
    });
  });
});
