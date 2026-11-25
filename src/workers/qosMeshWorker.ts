/**
 * Web Worker that intercepts network telemetry, calculates QoS penalties,
 * and broadcasts throttle commands to offending peers.
 */

import { PacketTimingAnalyzer } from "../core/network/PacketTimingAnalyzer";
import {
  CooperativeQoSEngine,
  QoSPolicy,
} from "../core/network/CooperativeQoSEngine";

export const analyzer = new PacketTimingAnalyzer();
export let qosEngine: CooperativeQoSEngine | null = null;
let evaluationInterval: ReturnType<typeof setInterval> | number | null = null;

export function getEvaluationInterval():
  ReturnType<typeof setInterval> | number | null {
  return evaluationInterval;
}

export function stopEvaluation(): void {
  if (evaluationInterval !== null) {
    if (
      typeof self !== "undefined" &&
      typeof self.clearInterval === "function"
    ) {
      self.clearInterval(evaluationInterval as any);
    } else if (typeof clearInterval === "function") {
      clearInterval(evaluationInterval as any);
    }
    evaluationInterval = null;
  }
}

export const INITIAL_RECONNECT_DELAY_MS = 1000;
export const MAX_RECONNECT_DELAY_MS = 30000;
export const MAX_RECONNECT_JITTER_MS = 500;

export function calculateBackoffDelay(
  attempts: number,
  options?: {
    initialDelay?: number;
    maxDelay?: number;
    randomJitter?: number;
  }
): number {
  const safeAttempts =
    typeof attempts === "number" && Number.isFinite(attempts) && attempts >= 0
      ? attempts
      : 0;
  const initialDelay =
    typeof options?.initialDelay === "number" &&
    Number.isFinite(options.initialDelay) &&
    options.initialDelay >= 0
      ? options.initialDelay
      : INITIAL_RECONNECT_DELAY_MS;
  const maxDelay =
    typeof options?.maxDelay === "number" &&
    Number.isFinite(options.maxDelay) &&
    options.maxDelay >= 0
      ? options.maxDelay
      : MAX_RECONNECT_DELAY_MS;
  const jitter =
    typeof options?.randomJitter === "number" &&
    Number.isFinite(options.randomJitter) &&
    options.randomJitter >= 0
      ? options.randomJitter
      : Math.random() * MAX_RECONNECT_JITTER_MS;

  const exponential = initialDelay * Math.pow(2, Math.max(0, safeAttempts));
  const rawDelay = exponential + jitter;

  if (!Number.isFinite(rawDelay) || rawDelay < 0) {
    return maxDelay;
  }

  return Math.min(rawDelay, maxDelay);
}

interface PeerReconnectState {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | number | null;
}

export const peerReconnectStates = new Map<string, PeerReconnectState>();

export function getPeerReconnectState(peerId: string): {
  attempts: number;
  hasActiveTimer: boolean;
} {
  const state = peerReconnectStates.get(peerId);
  return {
    attempts: state ? state.attempts : 0,
    hasActiveTimer: !!(state && state.timer !== null),
  };
}

export function clearPeerReconnectTimer(peerId: string): void {
  const state = peerReconnectStates.get(peerId);
  if (state && state.timer !== null) {
    if (typeof self !== "undefined" && typeof self.clearTimeout === "function") {
      self.clearTimeout(state.timer as any);
    } else if (typeof clearTimeout === "function") {
      clearTimeout(state.timer as any);
    }
    state.timer = null;
  }
}

export function resetPeerReconnect(peerId: string): void {
  clearPeerReconnectTimer(peerId);
  peerReconnectStates.delete(peerId);
}

export function clearAllPeerReconnects(): void {
  for (const state of peerReconnectStates.values()) {
    if (state.timer !== null) {
      if (typeof self !== "undefined" && typeof self.clearTimeout === "function") {
        self.clearTimeout(state.timer as any);
      } else if (typeof clearTimeout === "function") {
        clearTimeout(state.timer as any);
      }
      state.timer = null;
    }
  }
  peerReconnectStates.clear();
}

export function handlePingAck(peerId: string): void {
  const state = peerReconnectStates.get(peerId);
  if (state) {
    state.attempts = 0;
  }
}

export function schedulePeerReconnect(
  peerId: string,
  options?: {
    initialDelay?: number;
    maxDelay?: number;
    randomJitter?: number;
  }
): number | null {
  if (!peerId) return null;

  let state = peerReconnectStates.get(peerId);
  if (!state) {
    state = { attempts: 0, timer: null };
    peerReconnectStates.set(peerId, state);
  }

  // Prevent multiple simultaneous reconnect timers for the same peer
  if (state.timer !== null) {
    return null;
  }

  const delay = calculateBackoffDelay(state.attempts, options);
  state.attempts++;

  const onTimeout = () => {
    if (state) {
      state.timer = null;
    }
    if (typeof self !== "undefined" && typeof self.postMessage === "function") {
      self.postMessage({
        type: "RECONNECT_PEER",
        payload: {
          peerId,
          attempt: state ? state.attempts : 1,
          scheduledDelayMs: delay,
        },
      });
    }
  };

  if (typeof self !== "undefined" && typeof self.setTimeout === "function") {
    state.timer = self.setTimeout(onTimeout, delay) as unknown as number;
  } else if (typeof setTimeout === "function") {
    state.timer = setTimeout(onTimeout, delay) as unknown as number;
  }

  return delay;
}

export function resetWorkerState(): void {
  stopEvaluation();
  clearAllPeerReconnects();
  qosEngine = null;
  analyzer.reset();
}

export function handleWorkerMessage(event: {
  data: { type: string; payload?: any };
}) {
  const { type, payload } = event.data || {};

  switch (type) {
    case "INIT": {
      stopEvaluation();

      const policy: QoSPolicy = payload?.policy || {
        maxBandwidthBps: 50000000, // 50 Mbps
        voipReserveBps: 5000000, // 5 Mbps
        fairShareFactor: 0.8,
      };
      qosEngine = new CooperativeQoSEngine(policy);

      // Run QoS evaluation every 1 second
      if (
        typeof self !== "undefined" &&
        typeof self.setInterval === "function"
      ) {
        evaluationInterval = self.setInterval(
          evaluateMesh,
          1000,
        ) as unknown as number;
      } else if (typeof setInterval === "function") {
        evaluationInterval = setInterval(
          evaluateMesh,
          1000,
        ) as unknown as number;
      }
      break;
    }

    case "TERMINATE":
    case "SHUTDOWN":
    case "CLEANUP": {
      resetWorkerState();
      break;
    }

    case "PEER_JOINED":
      if (payload?.peerId) {
        resetPeerReconnect(payload.peerId);
        analyzer.registerPeer(payload.peerId);
        qosEngine?.addPeer(payload.peerId);
      }
      break;

    case "PEER_LEFT":
      if (payload?.peerId) {
        resetPeerReconnect(payload.peerId);
        analyzer.removePeer(payload.peerId);
        qosEngine?.removePeer(payload.peerId);
      }
      break;

    case "PEER_DISCONNECTED":
    case "SCHEDULE_RECONNECT":
      if (payload?.peerId) {
        schedulePeerReconnect(payload.peerId, payload?.options);
      }
      break;

    case "PING_ACK":
      if (payload?.peerId) {
        handlePingAck(payload.peerId);
      }
      break;

    case "CANCEL_RECONNECT":
      if (payload?.peerId) {
        clearPeerReconnectTimer(payload.peerId);
      }
      break;

    case "TELEMETRY_UPDATE": {
      const { peerId, rtt, ackDelay, bytesPerSec } = payload || {};
      if (!peerId || typeof peerId !== "string" || !analyzer.hasPeer(peerId)) {
        break;
      }
      if (
        typeof rtt === "number" &&
        Number.isFinite(rtt) &&
        rtt >= 0
      ) {
        analyzer.recordRTT(peerId, rtt);
      }
      if (
        typeof ackDelay === "number" &&
        Number.isFinite(ackDelay) &&
        ackDelay >= 0
      ) {
        analyzer.recordACKDelay(peerId, ackDelay);
      }
      if (
        typeof bytesPerSec === "number" &&
        Number.isFinite(bytesPerSec) &&
        bytesPerSec >= 0
      ) {
        analyzer.updateBandwidth(peerId, bytesPerSec);
      }
      break;
    }
  }
}

export function evaluateMesh() {
  if (!qosEngine) return;

  const hogId = analyzer.identifyHog();

  if (hogId && analyzer.hasPeer(hogId)) {
    // Apply a 50% throttle to the offending peer
    qosEngine.penalizePeer(hogId, 0.5);

    if (typeof self !== "undefined" && typeof self.postMessage === "function") {
      self.postMessage({
        type: "THROTTLE_APPLIED",
        payload: { peerId: hogId, metrics: analyzer.getMetrics() },
      });
    }
  } else {
    // Restore all peers to fair share if no hog is detected
    const metrics = analyzer.getMetrics();
    metrics.forEach((m) => {
      if (m.isHog && analyzer.hasPeer(m.peerId)) {
        // Was previously a hog
        qosEngine!.restorePeer(m.peerId);
      }
    });
  }
}

if (typeof self !== "undefined") {
  self.onmessage = handleWorkerMessage as any;
}
