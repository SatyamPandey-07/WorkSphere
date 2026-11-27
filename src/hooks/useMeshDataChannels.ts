"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "partysocket/react";
import { resetStateVectorChecksumCache } from "@/lib/crdt/stateVectorChecksum";
import {
  CRDT_FRAME_MAGIC,
  CRDT_FRAME_VERSION,
  CRDT_FRAME_HEADER_SIZE,
  CrdtFrameMessageType,
  CrdtFrameReassembler,
} from "@/lib/crdt/dataChannelFraming";
import { DataChannelChunker } from "@/core/p2p/DataChannelChunker";
import {
  registerDataChannelListener,
  cleanupDataChannelListeners,
  detectCandidatePairRelay,
  DataChannelRateLimiter,
  type TurnRelayStatus,
  type MessagePriority,
  RELAY_OPTIMIZED_AUDIO_BITRATE_BPS,
  DIRECT_RESTORED_AUDIO_BITRATE_BPS,
} from "@/lib/realtime/webrtc/meshConnection";

async function applyAudioMaxBitrate(
  sender: RTCRtpSender,
  maxBitrateBps: number,
): Promise<void> {
  if (
    typeof sender.getParameters !== "function" ||
    typeof sender.setParameters !== "function"
  ) {
    return;
  }
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings = params.encodings.map((enc) => ({
      ...enc,
      maxBitrate: maxBitrateBps,
    }));
    await sender.setParameters(params);
  } catch {
    // Ignore sender parameter errors on transient/closed tracks
  }
}

export type SocketConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTING";

export const VISIBILITY_RECONNECT_DEBOUNCE_MS = 300;

export function createSocketReconnectController(options: {
  debounceMs?: number;
  onPerformReconnect: () => void;
  onCleanupHalfOpen?: () => void;
}) {
  const debounceMs = options.debounceMs ?? VISIBILITY_RECONNECT_DEBOUNCE_MS;
  let state: SocketConnectionState = "DISCONNECTED";
  let isConnecting = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPendingTimer() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  return {
    getState: () => state,
    getIsConnecting: () => isConnecting,
    markConnecting: () => {
      if (isConnecting || state === "CONNECTING" || state === "CONNECTED") return false;
      isConnecting = true;
      state = "CONNECTING";
      return true;
    },
    markConnected: () => {
      clearPendingTimer();
      isConnecting = false;
      state = "CONNECTED";
    },
    markDisconnecting: () => {
      clearPendingTimer();
      isConnecting = false;
      state = "DISCONNECTING";
    },
    markDisconnected: () => {
      isConnecting = false;
      state = "DISCONNECTED";
    },
    triggerReconnectNow: () => {
      if (isConnecting || state === "CONNECTING" || state === "CONNECTED") return false;
      if (state === "DISCONNECTING") options.onCleanupHalfOpen?.();
      isConnecting = true;
      state = "CONNECTING";
      options.onPerformReconnect();
      return true;
    },
    scheduleVisibilityReconnect: (isVisible: boolean) => {
      if (!isVisible) {
        clearPendingTimer();
        if (state === "CONNECTING") {
          isConnecting = false;
          state = "DISCONNECTING";
          options.onCleanupHalfOpen?.();
          state = "DISCONNECTED";
        }
        return;
      }
      if (isConnecting || state === "CONNECTING" || state === "CONNECTED") return;
      clearPendingTimer();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (isConnecting || state === "CONNECTING" || state === "CONNECTED") return;
        isConnecting = true;
        state = "CONNECTING";
        options.onPerformReconnect();
      }, debounceMs);
    },
    dispose: () => {
      clearPendingTimer();
      isConnecting = false;
      state = "DISCONNECTING";
      options.onCleanupHalfOpen?.();
      state = "DISCONNECTED";
    },
  };
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** Binary magic header ('PI') for WebRTC DataChannel ping/pong heartbeats. */
export const MESH_HEARTBEAT_MAGIC = 0x5049;
export const MESH_HEARTBEAT_FRAME_SIZE = 12;
export const MESH_HEARTBEAT_INTERVAL_MS = 10_000;

export const enum MeshHeartbeatType {
  PING = 0x01,
  PONG = 0x02,
}

export interface DecodedHeartbeatFrame {
  type: MeshHeartbeatType;
  sentAt: number;
}

/**
 * Encodes a 12-byte binary ping/pong heartbeat frame (`0x5049` magic + type + float64 timestamp).
 */
export function encodeHeartbeatFrame(
  type: MeshHeartbeatType,
  sentAt: number = Date.now(),
): ArrayBuffer {
  const buffer = new ArrayBuffer(MESH_HEARTBEAT_FRAME_SIZE);
  const view = new DataView(buffer);
  view.setUint16(0, MESH_HEARTBEAT_MAGIC, false);
  view.setUint8(2, type);
  view.setUint8(3, 0);
  view.setFloat64(4, sentAt, false);
  return buffer;
}

/**
 * Decodes a binary heartbeat frame (`0x5049` magic). Returns `null` for non-heartbeat payloads.
 */
export function decodeHeartbeatFrame(
  data: ArrayBuffer,
): DecodedHeartbeatFrame | null {
  if (!(data instanceof ArrayBuffer) || data.byteLength !== MESH_HEARTBEAT_FRAME_SIZE) {
    return null;
  }
  const view = new DataView(data);
  if (view.getUint16(0, false) !== MESH_HEARTBEAT_MAGIC) {
    return null;
  }
  const type = view.getUint8(2);
  if (type !== MeshHeartbeatType.PING && type !== MeshHeartbeatType.PONG) {
    return null;
  }
  const sentAt = view.getFloat64(4, false);
  if (!Number.isFinite(sentAt)) {
    return null;
  }
  return { type, sentAt };
}

export interface CursorPosition {
  x: number;
  y: number;
  peerId?: string;
}

export interface DataChannelLike {
  readyState: RTCDataChannelState | "open" | "connecting" | "closing" | "closed";
  send: (data: string) => void;
}

export function createCursorThrottleController(options: {
  throttleMs?: number;
  nowFn?: () => number;
}) {
  const throttleMs =
    typeof options.throttleMs === "number" &&
    Number.isFinite(options.throttleMs) &&
    options.throttleMs >= 0
      ? options.throttleMs
      : 50;
  const nowFn = options.nowFn ?? Date.now;
  const state = {
    lastUpdateTime: 0,
    lastSentPosition: null as CursorPosition | null,
    forceNextSend: true,
  };

  function resetOnPeerConnect(): void {
    state.lastUpdateTime = 0;
    state.forceNextSend = true;
  }

  function shouldSendCursor(timestampMs = nowFn()): boolean {
    return (
      state.forceNextSend ||
      timestampMs < state.lastUpdateTime ||
      timestampMs - state.lastUpdateTime >= throttleMs
    );
  }

  function trySendCursor(
    channel: DataChannelLike | null | undefined,
    position: CursorPosition,
    timestampMs = nowFn(),
  ): boolean {
    if (!channel || channel.readyState !== "open" || !shouldSendCursor(timestampMs)) {
      return false;
    }
    channel.send(
      JSON.stringify({
        type: "cursor",
        peerId: position.peerId ?? "local",
        x: position.x,
        y: position.y,
        ts: timestampMs,
      }),
    );
    state.lastUpdateTime = timestampMs;
    state.lastSentPosition = { ...position };
    state.forceNextSend = false;
    return true;
  }

  return { state, resetOnPeerConnect, shouldSendCursor, trySendCursor };
}

type SignalKind = "peer-join" | "offer" | "answer" | "ice" | "peer-leave";

type SignalMessage = {
  type: "webrtc-signal";
  kind: SignalKind;
  from: string;
  to?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

type DataHandler = (peerId: string, data: ArrayBuffer) => void;

export interface MeshDataChannelOptions {
  roomId: string;
  userId: string | null | undefined;
  onData?: DataHandler;
  sampleIntervalMs?: number;
  pingIntervalMs?: number;
  nowFn?: () => number;
  onRelayStatusChange?: (isRelayed: boolean, relayStatus: TurnRelayStatus) => void;
}

export interface MeshDataChannelLike {
  readyState?: RTCDataChannelState | string;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
}

export type UseMeshDataChannelsOptions = MeshDataChannelOptions;

type Options = MeshDataChannelOptions;

export type PeerConnectionQuality = "good" | "fair" | "poor" | "unknown";

export interface PeerTelemetry {
  peerId: string;
  rttMs: number | null;
  packetLossPercent: number | null;
  packetLossSource: "inbound-rtp" | "unavailable";
  bitrateBps: {
    sent: number;
    received: number;
  } | null;
  quality: PeerConnectionQuality;
  lastUpdated: number;
  relayStatus?: TurnRelayStatus;
  isRelayed?: boolean;
}

interface PeerBitrateBaseline {
  bytesSent: number;
  bytesReceived: number;
  timestamp: number;
}

interface PeerRtpBaseline {
  packetsLost: number;
  packetsReceived: number;
}

/**
 * Classifies connection quality according to strict thresholds:
 * - Poor: RTT > 250ms or loss > 5%
 * - Fair: 100ms <= RTT <= 250ms or 1% <= loss <= 5%
 * - Good: RTT < 100ms and loss < 1%
 * - Unknown: insufficient valid measurements (neither RTT nor loss is a valid non-negative number)
 */
export function classifyPeerQuality(
  rttMs: number | null | undefined,
  packetLossPercent: number | null | undefined,
): PeerConnectionQuality {
  const hasRtt =
    typeof rttMs === "number" && Number.isFinite(rttMs) && rttMs >= 0;
  const hasLoss =
    typeof packetLossPercent === "number" &&
    Number.isFinite(packetLossPercent) &&
    packetLossPercent >= 0;

  if (!hasRtt && !hasLoss) {
    return "unknown";
  }

  const safeRtt = hasRtt ? (rttMs as number) : null;
  const safeLoss = hasLoss ? (packetLossPercent as number) : null;

  if (
    (safeRtt !== null && safeRtt > 250) ||
    (safeLoss !== null && safeLoss > 5)
  ) {
    return "poor";
  }

  if (
    (safeRtt !== null && safeRtt >= 100 && safeRtt <= 250) ||
    (safeLoss !== null && safeLoss >= 1 && safeLoss <= 5)
  ) {
    return "fair";
  }

  if (
    (safeRtt === null || safeRtt < 100) &&
    (safeLoss === null || safeLoss < 1)
  ) {
    return "good";
  }

  return "unknown";
}

function partyHost() {
  if (typeof window === "undefined") return "127.0.0.1:1999";
  return process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
}

export function useMeshDataChannels({
  roomId,
  userId,
  onData,
  sampleIntervalMs = 3000,
  pingIntervalMs = MESH_HEARTBEAT_INTERVAL_MS,
  nowFn = Date.now,
  onRelayStatusChange,
}: Options) {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [peerTelemetry, setPeerTelemetry] = useState<
    Record<string, PeerTelemetry>
  >({});
  const [peerLatencies, setPeerLatencies] = useState<Record<string, number>>(
    {},
  );
  const [isRelayed, setIsRelayed] = useState(false);
  const [relayStatus, setRelayStatus] = useState<TurnRelayStatus>("unknown");

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const chunkersRef = useRef<Map<string, DataChannelChunker>>(new Map());
  const reassemblersRef = useRef<Map<string, CrdtFrameReassembler>>(new Map());
  const rateLimitersRef = useRef<Map<string, DataChannelRateLimiter>>(new Map());
  const peerRelayStatusRef = useRef<Map<string, TurnRelayStatus>>(new Map());
  const socketRef = useRef<{ send: (data: string) => void } | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const socketStateRef = useRef<SocketConnectionState>("DISCONNECTED");
  const visibilityDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        if (visibilityDebounceTimerRef.current !== null) {
          clearTimeout(visibilityDebounceTimerRef.current);
          visibilityDebounceTimerRef.current = null;
        }
        return;
      }
      if (isConnectingRef.current || socketStateRef.current === "CONNECTING" || socketStateRef.current === "CONNECTED") return;
      if (visibilityDebounceTimerRef.current !== null) clearTimeout(visibilityDebounceTimerRef.current);
      visibilityDebounceTimerRef.current = setTimeout(() => {
        visibilityDebounceTimerRef.current = null;
        if (isConnectingRef.current || socketStateRef.current === "CONNECTING" || socketStateRef.current === "CONNECTED") return;
        const sk = socketRef.current as unknown as { readyState?: number; close?: (c?: number, r?: string) => void; reconnect?: () => void } | null;
        if (sk && sk.readyState === WebSocket.OPEN) {
          socketStateRef.current = "CONNECTED";
          isConnectingRef.current = false;
          return;
        }
        socketStateRef.current = "DISCONNECTING";
        if (sk && typeof sk.close === "function" && sk.readyState !== WebSocket.CLOSED) {
          try { sk.close(1000, "Reconnect cleanup"); } catch {}
        }
        isConnectingRef.current = true;
        socketStateRef.current = "CONNECTING";
        if (sk && typeof sk.reconnect === "function") sk.reconnect();
      }, VISIBILITY_RECONNECT_DEBOUNCE_MS);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (visibilityDebounceTimerRef.current !== null) {
        clearTimeout(visibilityDebounceTimerRef.current);
        visibilityDebounceTimerRef.current = null;
      }
    };
  }, []);

  const onDataRef = useRef<DataHandler | undefined>(onData);
  const onRelayStatusChangeRef = useRef(onRelayStatusChange);
  const nowFnRef = useRef(nowFn);

  const prevBitrateBaselineRef = useRef<Map<string, PeerBitrateBaseline>>(
    new Map(),
  );
  const prevRtpBaselineRef = useRef<Map<string, PeerRtpBaseline>>(new Map());

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onRelayStatusChangeRef.current = onRelayStatusChange;
  }, [onRelayStatusChange]);

  useEffect(() => {
    nowFnRef.current = nowFn;
  }, [nowFn]);

  useEffect(() => {
    if (typeof getToken === "function") {
      getToken()
        .then(setToken)
        .catch(() => setToken(null));
    }
  }, [getToken]);

  const sendSignal = useCallback(
    (msg: Omit<SignalMessage, "type" | "from">) => {
      if (!userId || !socketRef.current) return;
      const payload: SignalMessage = {
        type: "webrtc-signal",
        from: userId,
        ...msg,
      };
      socketRef.current.send(JSON.stringify(payload));
    },
    [userId],
  );

  const updatePeerCount = useCallback(() => {
    setPeerCount(dataChannelsRef.current.size);
  }, []);

  const clearPeerTelemetryState = useCallback((peerId: string) => {
    setPeerTelemetry((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setPeerLatencies((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const cleanupPeer = useCallback(
    (peerId: string) => {
      // Drop cached digests even when the peer's RTCPeerConnection was
      // already removed; reconnect must begin with a fresh checksum exchange.
      resetStateVectorChecksumCache();
      const chunker = chunkersRef.current.get(peerId);
      if (chunker) {
        chunker.dispose();
        chunkersRef.current.delete(peerId);
      }
      reassemblersRef.current.delete(peerId);

      const limiter = rateLimitersRef.current.get(peerId);
      if (limiter) {
        limiter.destroy();
        rateLimitersRef.current.delete(peerId);
      }
      peerRelayStatusRef.current.delete(peerId);

      const existingDc = dataChannelsRef.current.get(peerId);
      if (existingDc) {
        cleanupDataChannelListeners(existingDc);
      }

      const pc = peersRef.current.get(peerId);
      dataChannelsRef.current.delete(peerId);
      prevBitrateBaselineRef.current.delete(peerId);
      prevRtpBaselineRef.current.delete(peerId);
      clearPeerTelemetryState(peerId);

      // Recalculate room-level relay state
      const remainingRelays = Array.from(peerRelayStatusRef.current.values());
      const hasRelay = remainingRelays.some((s) => s === "relay");
      const roomStatus: TurnRelayStatus = hasRelay
        ? "relay"
        : remainingRelays.length > 0 && remainingRelays.every((s) => s === "direct")
          ? "direct"
          : "unknown";
      setIsRelayed(hasRelay);
      setRelayStatus(roomStatus);
      onRelayStatusChangeRef.current?.(hasRelay, roomStatus);

      if (!pc) {
        updatePeerCount();
        if (dataChannelsRef.current.size === 0) setIsConnected(false);
        return;
      }

      pc.onicecandidate = null;
      pc.ondatachannel = null;
      pc.close();
      peersRef.current.delete(peerId);
      dataChannelsRef.current.delete(peerId);
      updatePeerCount();
    },
    [clearPeerTelemetryState, updatePeerCount],
  );

  const handleIncomingData = useCallback(
    (peerId: string, data: ArrayBuffer) => {
      // Handle binary 0x5049 ('PI') heartbeat ping/pong without touching CRDT payload stream
      const heartbeat = decodeHeartbeatFrame(data);
      if (heartbeat) {
        if (heartbeat.type === MeshHeartbeatType.PING) {
          const dc = dataChannelsRef.current.get(peerId);
          if (dc && dc.readyState === "open") {
            try {
              dc.send(encodeHeartbeatFrame(MeshHeartbeatType.PONG, heartbeat.sentAt));
            } catch {
              // Ignore transient channel write errors
            }
          }
          return;
        }

        const now = nowFnRef.current();
        const rttMs = Math.max(0, Math.round(now - heartbeat.sentAt));
        setPeerLatencies((prev) => ({ ...prev, [peerId]: rttMs }));
        setPeerTelemetry((prev) => {
          const existing = prev[peerId];
          const packetLoss = existing?.packetLossPercent ?? null;
          return {
            ...prev,
            [peerId]: {
              peerId,
              rttMs,
              packetLossPercent: packetLoss,
              packetLossSource: existing?.packetLossSource ?? "unavailable",
              bitrateBps: existing?.bitrateBps ?? null,
              quality: classifyPeerQuality(rttMs, packetLoss),
              lastUpdated: now,
              relayStatus: existing?.relayStatus,
              isRelayed: existing?.isRelayed,
            },
          };
        });
        return;
      }

      if (data.byteLength >= CRDT_FRAME_HEADER_SIZE) {
        const view = new DataView(data);
        const magic = view.getUint16(0, false);
        const version = view.getUint8(2);

        if (magic === CRDT_FRAME_MAGIC && version === CRDT_FRAME_VERSION) {
          let reassembler = reassemblersRef.current.get(peerId);
          if (!reassembler) {
            reassembler = new CrdtFrameReassembler();
            reassemblersRef.current.set(peerId, reassembler);
          }

          try {
            const result = reassembler.pushFrame(data);
            if (result) {
              const reconstructed = (
                result.payload.byteOffset === 0 &&
                result.payload.byteLength === result.payload.buffer.byteLength
                  ? result.payload.buffer
                  : result.payload.buffer.slice(
                      result.payload.byteOffset,
                      result.payload.byteOffset + result.payload.byteLength,
                    )
              ) as ArrayBuffer;
              onDataRef.current?.(peerId, reconstructed);
            }
          } catch (frameErr) {
            console.warn(
              "Failed to decode or reassemble CRDT frame from",
              peerId,
              frameErr,
            );
          }
          return;
        }
      }

      // Fallback for legacy unframed messages
      onDataRef.current?.(peerId, data);
    },
    [],
  );

  const setupDataChannel = useCallback(
    (dc: RTCDataChannel, peerId: string) => {
      const previousDc = dataChannelsRef.current.get(peerId);
      if (previousDc && previousDc !== dc) {
        cleanupDataChannelListeners(previousDc);
      }

      const existingChunker = chunkersRef.current.get(peerId);
      if (existingChunker) {
        existingChunker.dispose();
        chunkersRef.current.delete(peerId);
      }
      reassemblersRef.current.set(peerId, new CrdtFrameReassembler());

      try {
        dc.binaryType = "arraybuffer";
      } catch {
        // Ignore in environments where binaryType cannot be modified
      }

      const chunker = new DataChannelChunker(dc);
      chunkersRef.current.set(peerId, chunker);

      let limiter = rateLimitersRef.current.get(peerId);
      if (!limiter) {
        limiter = new DataChannelRateLimiter();
        rateLimitersRef.current.set(peerId, limiter);
      }
      limiter.registerChannel(dc);
      limiter.setEnabled(peerRelayStatusRef.current.get(peerId) === "relay");

      dataChannelsRef.current.set(peerId, dc);

      const onOpenHandler = () => {
        if (dataChannelsRef.current.get(peerId) !== dc) return;
        updatePeerCount();
        setIsConnected(true);
        chunker.drainQueue();
      };

      const onCloseHandler = () => {
        if (dataChannelsRef.current.get(peerId) !== dc) {
          cleanupDataChannelListeners(dc);
          return;
        }

        cleanupDataChannelListeners(dc);
        resetStateVectorChecksumCache();
        const ch = chunkersRef.current.get(peerId);
        if (ch) {
          ch.dispose();
          chunkersRef.current.delete(peerId);
        }
        reassemblersRef.current.delete(peerId);

        const rl = rateLimitersRef.current.get(peerId);
        if (rl) {
          rl.unregisterChannel(dc);
        }

        dataChannelsRef.current.delete(peerId);
        prevBitrateBaselineRef.current.delete(peerId);
        prevRtpBaselineRef.current.delete(peerId);
        clearPeerTelemetryState(peerId);
        updatePeerCount();
        if (dataChannelsRef.current.size === 0) {
          setIsConnected(false);
        }
      };

      const onMessageHandler = (event: Event) => {
        if (dataChannelsRef.current.get(peerId) !== dc) return;
        const msgEvent = event as MessageEvent;
        if (msgEvent.data instanceof ArrayBuffer) {
          handleIncomingData(peerId, msgEvent.data);
        }
      };

      const onErrorHandler = (error: Event) => {
        if (dataChannelsRef.current.get(peerId) !== dc) return;
        console.warn(`RTCDataChannel error with peer ${peerId}:`, error);
      };

      registerDataChannelListener(dc, "open", onOpenHandler);
      registerDataChannelListener(dc, "close", onCloseHandler);
      registerDataChannelListener(dc, "message", onMessageHandler);
      registerDataChannelListener(dc, "error", onErrorHandler);

      dc.onopen = onOpenHandler;
      dc.onclose = onCloseHandler;
      dc.onmessage = (event: MessageEvent) => {
        onMessageHandler(event);
      };
      dc.onerror = onErrorHandler;
    },
    [clearPeerTelemetryState, updatePeerCount, handleIncomingData],
  );

  const ensurePeer = useCallback(
    (peerId: string, isInitiator: boolean) => {
      if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);

      if (peersRef.current.size >= 5) {
        console.warn("Max mesh peers reached, cannot connect to", peerId);
        return null;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(peerId, pc);

      pc.onicecandidate = (ev) => {
        sendSignal({
          kind: "ice",
          to: peerId,
          candidate: ev.candidate ? ev.candidate.toJSON() : null,
        });
      };

      pc.ondatachannel = (ev) => {
        setupDataChannel(ev.channel, peerId);
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc?.iceConnectionState === "disconnected" ||
          pc?.iceConnectionState === "failed"
        ) {
          cleanupPeer(peerId);
        }
      };

      if (isInitiator) {
        const dc = pc.createDataChannel("yjs-sync", { ordered: true });
        setupDataChannel(dc, peerId);

        pc.createOffer()
          .then((offer) => pc?.setLocalDescription(offer).then(() => offer))
          .then((offer) => {
            sendSignal({
              kind: "offer",
              to: peerId,
              sdp: pc!.localDescription ?? offer,
            });
          })
          .catch((err) => {
            console.error("Error creating offer:", err);
            cleanupPeer(peerId);
          });
      }

      return pc;
    },
    [sendSignal, cleanupPeer, setupDataChannel],
  );

  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      if (!userId || msg.from === userId) return;

      if (msg.kind === "peer-join") {
        cleanupPeer(msg.from);
        ensurePeer(msg.from, true);
        return;
      }

      if (msg.kind === "peer-leave") {
        cleanupPeer(msg.from);
        return;
      }

      if (msg.kind === "offer" && msg.to === userId) {
        const pc = ensurePeer(msg.from, false);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(msg.sdp!);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({
            kind: "answer",
            to: msg.from,
            sdp: pc.localDescription ?? answer,
          });
        } catch {
          cleanupPeer(msg.from);
        }
        return;
      }

      if (msg.kind === "answer" && msg.to === userId) {
        const pc = peersRef.current.get(msg.from);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(msg.sdp!);
        } catch {
          cleanupPeer(msg.from);
        }
        return;
      }

      if (msg.kind === "ice" && msg.to === userId && msg.candidate) {
        const pc = peersRef.current.get(msg.from);
        if (!pc) return;
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {
          // Ignore stale candidates
        }
      }
    },
    [userId, ensurePeer, cleanupPeer, sendSignal],
  );

  const socket = usePartySocket({
    host: partyHost(),
    room: roomId,
    query: token ? { token } : undefined,
    onOpen() {
      if (userId) {
        const peerIds = [...peersRef.current.keys()];
        for (const id of peerIds) {
          cleanupPeer(id);
        }
        sendSignal({ kind: "peer-join" });
      }
    },
    onMessage(event) {
      try {
        const data = JSON.parse(event.data) as SignalMessage;
        if (data.type !== "webrtc-signal") return;
        void handleSignal(data);
      } catch {
        // Ignore non-JSON messages (Yjs binary)
      }
    },
  });

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    const peers = peersRef.current;
    const chunkers = chunkersRef.current;
    const reassemblers = reassemblersRef.current;
    const rateLimiters = rateLimitersRef.current;
    const dataChannels = dataChannelsRef.current;
    const peerRelayStatus = peerRelayStatusRef.current;
    return () => {
      for (const id of [...peers.keys()]) {
        cleanupPeer(id);
      }
      for (const dc of dataChannels.values()) {
        cleanupDataChannelListeners(dc);
      }
      for (const chunker of chunkers.values()) {
        chunker.dispose();
      }
      for (const limiter of rateLimiters.values()) {
        limiter.destroy();
      }
      chunkers.clear();
      reassemblers.clear();
      rateLimiters.clear();
      peerRelayStatus.clear();
      dataChannels.clear();
    };
  }, [cleanupPeer]);

  // Periodic WebRTC DataChannel Ping/Pong Heartbeat (0x5049 - 'PI') every 10 seconds
  useEffect(() => {
    if (!Number.isFinite(pingIntervalMs) || pingIntervalMs <= 0) {
      return;
    }

    const sendHeartbeats = () => {
      const sentAt = nowFnRef.current();
      const pingFrame = encodeHeartbeatFrame(MeshHeartbeatType.PING, sentAt);
      for (const dc of dataChannelsRef.current.values()) {
        if (dc.readyState === "open") {
          try {
            dc.send(pingFrame);
          } catch {
            // Ignore transient DataChannel send errors
          }
        }
      }
    };

    const timerId = setInterval(sendHeartbeats, pingIntervalMs);
    return () => {
      clearInterval(timerId);
    };
  }, [pingIntervalMs]);

  // Telemetry & TURN Relay Detection Polling Loop (~3000ms by default)
  useEffect(() => {
    let isCancelled = false;

    const pollStats = async () => {
      if (peersRef.current.size === 0) return;

      const now = Date.now();
      const updates: Record<string, PeerTelemetry> = {};
      let anyRelayed = false;
      let hasDeterminedStatus = false;

      for (const [peerId, pc] of peersRef.current.entries()) {
        if (
          !pc ||
          pc.signalingState === "closed" ||
          pc.connectionState === "closed"
        ) {
          continue;
        }

        try {
          const stats = await pc.getStats();
          if (isCancelled) return;

          let rttMs: number | null = null;
          let totalBytesSent = 0;
          let totalBytesReceived = 0;
          let hasDataChannelStats = false;
          let candidatePairBytesSent = 0;
          let candidatePairBytesReceived = 0;
          let hasCandidatePairBytes = false;

          let rtpPacketsLost: number | null = null;
          let rtpPacketsReceived: number | null = null;

          // Issue #9727: Detect TURN relay candidate pair
          const { status: peerRelayStatus } = detectCandidatePairRelay(stats);
          const previousRelayStatus = peerRelayStatusRef.current.get(peerId);
          peerRelayStatusRef.current.set(peerId, peerRelayStatus);

          const isPeerRelayed = peerRelayStatus === "relay";
          if (isPeerRelayed) {
            anyRelayed = true;
          }
          if (peerRelayStatus !== "unknown") {
            hasDeterminedStatus = true;
          }

          let limiter = rateLimitersRef.current.get(peerId);
          if (!limiter) {
            limiter = new DataChannelRateLimiter();
            rateLimitersRef.current.set(peerId, limiter);
            const dc = dataChannelsRef.current.get(peerId);
            if (dc) limiter.registerChannel(dc);
          }
          limiter.setEnabled(isPeerRelayed);

          if (previousRelayStatus !== peerRelayStatus && typeof pc.getSenders === "function") {
            const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
            if (audioSender) {
              const targetBps = isPeerRelayed
                ? RELAY_OPTIMIZED_AUDIO_BITRATE_BPS
                : DIRECT_RESTORED_AUDIO_BITRATE_BPS;
              void applyAudioMaxBitrate(audioSender, targetBps);
            }
          }

          stats.forEach((stat: any) => {
            if (!stat || typeof stat !== "object" || !("type" in stat)) return;

            if (
              stat.type === "candidate-pair" &&
              (("state" in stat && stat.state === "succeeded") ||
                ("nominated" in stat && stat.nominated === true) ||
                stat.selected === true)
            ) {
              if (
                typeof stat.currentRoundTripTime === "number" &&
                Number.isFinite(stat.currentRoundTripTime) &&
                stat.currentRoundTripTime >= 0
              ) {
                rttMs = Math.round(stat.currentRoundTripTime * 1000 * 10) / 10;
              }

              if (
                typeof stat.bytesSent === "number" &&
                Number.isFinite(stat.bytesSent) &&
                stat.bytesSent >= 0
              ) {
                candidatePairBytesSent = stat.bytesSent;
                hasCandidatePairBytes = true;
              }
              if (
                typeof stat.bytesReceived === "number" &&
                Number.isFinite(stat.bytesReceived) &&
                stat.bytesReceived >= 0
              ) {
                candidatePairBytesReceived = stat.bytesReceived;
                hasCandidatePairBytes = true;
              }
            }

            if (stat.type === "data-channel") {
              hasDataChannelStats = true;
              if (
                typeof stat.bytesSent === "number" &&
                Number.isFinite(stat.bytesSent) &&
                stat.bytesSent >= 0
              ) {
                totalBytesSent += stat.bytesSent;
              }
              if (
                typeof stat.bytesReceived === "number" &&
                Number.isFinite(stat.bytesReceived) &&
                stat.bytesReceived >= 0
              ) {
                totalBytesReceived += stat.bytesReceived;
              }
            }

            if (stat.type === "inbound-rtp") {
              if (
                typeof stat.packetsLost === "number" &&
                Number.isFinite(stat.packetsLost) &&
                stat.packetsLost >= 0
              ) {
                rtpPacketsLost = (rtpPacketsLost ?? 0) + stat.packetsLost;
              }
              if (
                typeof stat.packetsReceived === "number" &&
                Number.isFinite(stat.packetsReceived) &&
                stat.packetsReceived >= 0
              ) {
                rtpPacketsReceived =
                  (rtpPacketsReceived ?? 0) + stat.packetsReceived;
              }
            }
          });

          const currentBytesSent = hasDataChannelStats
            ? totalBytesSent
            : hasCandidatePairBytes
              ? candidatePairBytesSent
              : 0;
          const currentBytesReceived = hasDataChannelStats
            ? totalBytesReceived
            : hasCandidatePairBytes
              ? candidatePairBytesReceived
              : 0;

          let bitrateBps: { sent: number; received: number } | null = null;
          const prevBitrate = prevBitrateBaselineRef.current.get(peerId);

          if (prevBitrate) {
            const elapsedSec = (now - prevBitrate.timestamp) / 1000;
            if (elapsedSec > 0) {
              const bytesSentDelta =
                currentBytesSent >= prevBitrate.bytesSent
                  ? currentBytesSent - prevBitrate.bytesSent
                  : currentBytesSent;
              const bytesRecvDelta =
                currentBytesReceived >= prevBitrate.bytesReceived
                  ? currentBytesReceived - prevBitrate.bytesReceived
                  : currentBytesReceived;

              bitrateBps = {
                sent: Math.round((bytesSentDelta * 8) / elapsedSec),
                received: Math.round((bytesRecvDelta * 8) / elapsedSec),
              };
            }
          }

          prevBitrateBaselineRef.current.set(peerId, {
            bytesSent: currentBytesSent,
            bytesReceived: currentBytesReceived,
            timestamp: now,
          });

          let packetLossPercent: number | null = null;
          let packetLossSource: "inbound-rtp" | "unavailable" = "unavailable";

          if (rtpPacketsLost !== null && rtpPacketsReceived !== null) {
            const prevRtp = prevRtpBaselineRef.current.get(peerId);
            if (prevRtp) {
              const lostDelta =
                rtpPacketsLost >= prevRtp.packetsLost
                  ? rtpPacketsLost - prevRtp.packetsLost
                  : rtpPacketsLost;
              const recvDelta =
                rtpPacketsReceived >= prevRtp.packetsReceived
                  ? rtpPacketsReceived - prevRtp.packetsReceived
                  : rtpPacketsReceived;
              const totalDelta = lostDelta + recvDelta;

              if (totalDelta > 0) {
                packetLossPercent =
                  Math.round((lostDelta / totalDelta) * 100 * 10) / 10;
                packetLossSource = "inbound-rtp";
              } else {
                packetLossPercent = 0;
                packetLossSource = "inbound-rtp";
              }
            } else {
              const totalPackets = rtpPacketsLost + rtpPacketsReceived;
              packetLossPercent =
                totalPackets > 0
                  ? Math.round((rtpPacketsLost / totalPackets) * 100 * 10) / 10
                  : 0;
              packetLossSource = "inbound-rtp";
            }

            prevRtpBaselineRef.current.set(peerId, {
              packetsLost: rtpPacketsLost,
              packetsReceived: rtpPacketsReceived,
            });
          }

          const quality = classifyPeerQuality(rttMs, packetLossPercent);

          updates[peerId] = {
            peerId,
            rttMs,
            packetLossPercent,
            packetLossSource,
            bitrateBps,
            quality,
            lastUpdated: now,
            relayStatus: peerRelayStatus,
            isRelayed: isPeerRelayed,
          };
        } catch {
          // Ignore stats errors for transient peer state
        }
      }

      if (!isCancelled && Object.keys(updates).length > 0) {
        setPeerTelemetry((prev) => ({ ...prev, ...updates }));

        const nextRoomRelayStatus: TurnRelayStatus = anyRelayed
          ? "relay"
          : hasDeterminedStatus
            ? "direct"
            : "unknown";

        setIsRelayed(anyRelayed);
        setRelayStatus(nextRoomRelayStatus);
        onRelayStatusChangeRef.current?.(anyRelayed, nextRoomRelayStatus);
      }
    };

    const intervalId = setInterval(() => {
      void pollStats();
    }, sampleIntervalMs);

    void pollStats();

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [sampleIntervalMs]);

  const enqueuePayloadForPeer = useCallback(
    (
      peerId: string,
      dc: RTCDataChannel,
      data: ArrayBuffer,
      options: { priority?: MessagePriority; coalesceKey?: string } = {},
    ) => {
      const limiter = rateLimitersRef.current.get(peerId);
      if (limiter && limiter.getIsEnabled()) {
        limiter.enqueue(dc, data, options);
        return;
      }

      let chunker = chunkersRef.current.get(peerId);
      if (!chunker) {
        chunker = new DataChannelChunker(dc);
        chunkersRef.current.set(peerId, chunker);
      }
      try {
        chunker.enqueue(data, {
          messageType: CrdtFrameMessageType.DELTA_UPDATE,
          compressed: true,
        });
      } catch (err) {
        console.warn(`Failed to enqueue CRDT update for peer ${peerId}:`, err);
      }
    },
    [],
  );

  const sendToAll = useCallback(
    (
      data: ArrayBuffer,
      options: { priority?: MessagePriority; coalesceKey?: string } = {},
    ) => {
      for (const [peerId, dc] of dataChannelsRef.current.entries()) {
        if (dc.readyState === "open" || dc.readyState === "connecting") {
          enqueuePayloadForPeer(peerId, dc, data, options);
        }
      }
    },
    [enqueuePayloadForPeer],
  );

  const sendToPeer = useCallback(
    (
      peerId: string,
      data: ArrayBuffer,
      options: { priority?: MessagePriority; coalesceKey?: string } = {},
    ) => {
      const dc = dataChannelsRef.current.get(peerId);
      if (!dc || (dc.readyState !== "open" && dc.readyState !== "connecting")) {
        return;
      }
      enqueuePayloadForPeer(peerId, dc, data, options);
    },
    [enqueuePayloadForPeer],
  );

  return {
    sendToAll,
    sendToPeer,
    peerCount,
    isConnected,
    peerTelemetry,
    peerLatencies,
    isRelayed,
    relayStatus,
    rateLimiters: rateLimitersRef.current,
  };
}

export default useMeshDataChannels;
