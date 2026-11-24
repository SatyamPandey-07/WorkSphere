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
  AdaptiveAudioBitrateController,
  MAX_AUDIO_BITRATE_BPS,
  type AdaptiveAudioTelemetryEvent,
  detectCandidatePairRelay,
  DataChannelRateLimiter,
  type TurnRelayStatus,
  type MessagePriority,
  RELAY_OPTIMIZED_AUDIO_BITRATE_BPS,
  DIRECT_RESTORED_AUDIO_BITRATE_BPS,
  applyAudioMaxBitrate,
} from "@/lib/realtime/webrtc/meshConnection";
import {
  getPowerOptimizationProfile,
  useBatteryOptimization,
  type BatteryState,
  type PowerOptimizationProfile,
} from "@/hooks/useBatteryOptimization";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

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
  onRelayStatusChange?: (isRelayed: boolean, relayStatus: TurnRelayStatus) => void;
}

export interface AdaptiveAudioBitrateOptions {
  peerId: string;
  peerConnection: (Pick<RTCPeerConnection, 'getStats' | 'getSenders'> & {
    addEventListener?: RTCPeerConnection['addEventListener'];
  }) | null;
  sampleIntervalMs?: number;
  onTelemetry?: (event: AdaptiveAudioTelemetryEvent) => void;
}

export interface MeshDataChannelLike {
  readyState?: RTCDataChannelState | string;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
}

export interface BatteryOptimizationDataChannelOptions {
  channels?: Record<string, MeshDataChannelLike | null | undefined>;
  onFlushBatch?: (
    messages: unknown[],
    profile: PowerOptimizationProfile
  ) => void;
  batteryOverride?: BatteryState;
}

export type UseMeshDataChannelsOptions =
  | MeshDataChannelOptions
  | AdaptiveAudioBitrateOptions
  | BatteryOptimizationDataChannelOptions;

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
  onRelayStatusChange,
}: Options) {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [peerTelemetry, setPeerTelemetry] = useState<
    Record<string, PeerTelemetry>
  >({});
  const [isRelayed, setIsRelayed] = useState(false);
  const [relayStatus, setRelayStatus] = useState<TurnRelayStatus>("unknown");

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const chunkersRef = useRef<Map<string, DataChannelChunker>>(new Map());
  const reassemblersRef = useRef<Map<string, CrdtFrameReassembler>>(new Map());
  const rateLimitersRef = useRef<Map<string, DataChannelRateLimiter>>(new Map());
  const peerRelayStatusRef = useRef<Map<string, TurnRelayStatus>>(new Map());
  const socketRef = useRef<{ send: (data: string) => void } | null>(null);
  const onDataRef = useRef<DataHandler | undefined>(onData);
  const onRelayStatusChangeRef = useRef(onRelayStatusChange);

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
      setPeerTelemetry((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });

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
    [updatePeerCount],
  );

  const handleIncomingData = useCallback(
    (peerId: string, data: ArrayBuffer) => {
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
      // 1. If there's an existing channel for this peer (channel replacement / renegotiation),
      // cleanly remove all its listeners and dispose it first.
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

      // Initialize rate limiter for peer
      let limiter = rateLimitersRef.current.get(peerId);
      if (!limiter) {
        limiter = new DataChannelRateLimiter();
        rateLimitersRef.current.set(peerId, limiter);
      }
      limiter.registerChannel(dc);
      limiter.setEnabled(peerRelayStatusRef.current.get(peerId) === "relay");

      dataChannelsRef.current.set(peerId, dc);

      const onOpenHandler = () => {
        // Guard against stale channel events
        if (dataChannelsRef.current.get(peerId) !== dc) return;
        updatePeerCount();
        setIsConnected(true);
        chunker.drainQueue();
      };

      const onCloseHandler = () => {
        // Guard against stale channel events
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
        setPeerTelemetry((prev) => {
          if (!(peerId in prev)) return prev;
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
        updatePeerCount();
        if (dataChannelsRef.current.size === 0) {
          setIsConnected(false);
        }
      };

      const onMessageHandler = (event: Event) => {
        // Guard against stale / obsolete channel message events
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

      // Register listeners using the centralized listener registry
      registerDataChannelListener(dc, "open", onOpenHandler);
      registerDataChannelListener(dc, "close", onCloseHandler);
      registerDataChannelListener(dc, "message", onMessageHandler);
      registerDataChannelListener(dc, "error", onErrorHandler);

      // Property mirror handlers (for callers checking .onmessage or environments dispatching property callbacks)
      dc.onopen = onOpenHandler;
      dc.onclose = onCloseHandler;
      dc.onmessage = (event: MessageEvent) => {
        onMessageHandler(event);
      };
      dc.onerror = onErrorHandler;
    },
    [updatePeerCount, handleIncomingData],
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
    const peerIds = [...peersRef.current.keys()];
    const chunkers = chunkersRef.current;
    const reassemblers = reassemblersRef.current;
    const rateLimiters = rateLimitersRef.current;
    return () => {
      for (const id of peerIds) {
        cleanupPeer(id);
      }
      for (const dc of dataChannelsRef.current.values()) {
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
      peerRelayStatusRef.current.clear();
      dataChannelsRef.current.clear();
    };
  }, [cleanupPeer]);

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

          // Adapt rate limiter for DataChannels
          let limiter = rateLimitersRef.current.get(peerId);
          if (!limiter) {
            limiter = new DataChannelRateLimiter();
            rateLimitersRef.current.set(peerId, limiter);
            const dc = dataChannelsRef.current.get(peerId);
            if (dc) limiter.registerChannel(dc);
          }
          limiter.setEnabled(isPeerRelayed);

          // Adapt audio sender bitrates if transitioning
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

            // Candidate pair RTT
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

            // DataChannel bytes
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

            // Inbound RTP packet loss (audio/video if present)
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

          // Fallback to candidate pair bytes if data-channel stats are not populated
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

          // Bitrate calculation
          let bitrateBps: { sent: number; received: number } | null = null;
          const prevBitrate = prevBitrateBaselineRef.current.get(peerId);

          if (prevBitrate) {
            const elapsedSec = (now - prevBitrate.timestamp) / 1000;
            if (elapsedSec > 0) {
              const bytesSentDelta =
                currentBytesSent >= prevBitrate.bytesSent
                  ? currentBytesSent - prevBitrate.bytesSent
                  : currentBytesSent; // counter reset
              const bytesRecvDelta =
                currentBytesReceived >= prevBitrate.bytesReceived
                  ? currentBytesReceived - prevBitrate.bytesReceived
                  : currentBytesReceived; // counter reset

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

          // Packet loss calculation
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

    // Initial immediate poll
    void pollStats();

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [sampleIntervalMs]);

  const sendToAll = useCallback(
    (
      data: ArrayBuffer,
      options: { priority?: MessagePriority; coalesceKey?: string } = {}
    ) => {
      for (const [peerId, dc] of dataChannelsRef.current.entries()) {
        if (dc.readyState === "open" || dc.readyState === "connecting") {
          const limiter = rateLimitersRef.current.get(peerId);
          if (limiter && limiter.getIsEnabled()) {
            limiter.enqueue(dc, data, options);
          } else {
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
              console.warn(
                `Failed to enqueue CRDT update for peer ${peerId}:`,
                err,
              );
            }
          }
        }
      }
    },
    [],
  );

  const sendToPeer = useCallback(
    (
      peerId: string,
      data: ArrayBuffer,
      options: { priority?: MessagePriority; coalesceKey?: string } = {}
    ) => {
      const dc = dataChannelsRef.current.get(peerId);
      if (!dc || (dc.readyState !== "open" && dc.readyState !== "connecting")) {
        return;
      }

      const limiter = rateLimitersRef.current.get(peerId);
      if (limiter && limiter.getIsEnabled()) {
        limiter.enqueue(dc, data, options);
      } else {
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
      }
    },
    [],
  );

  return {
    sendToAll,
    sendToPeer,
    peerCount,
    isConnected,
    peerTelemetry,
    isRelayed,
    relayStatus,
    rateLimiters: rateLimitersRef.current,
  };
}
