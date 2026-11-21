 feat/webrtc-ice-restart-backoff
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PeerConnectionLike {
  iceConnectionState: RTCIceConnectionState | string;
  oniceconnectionstatechange: ((this: PeerConnectionLike, ev: Event) => unknown) | null;
  restartIce?: () => void;
  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close?(): void;
}

export interface SignalingChannelLike {
  send(data: string | Record<string, unknown>): void;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "partysocket/react";
import { resetStateVectorChecksumCache } from "@/lib/crdt/stateVectorChecksum";

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

type Options = {
  roomId: string;
  userId: string | null | undefined;
  onData?: DataHandler;
};

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

export function useMeshDataChannels({ roomId, userId, onData }: Options) {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [peerTelemetry, setPeerTelemetry] = useState<
    Record<string, PeerTelemetry>
  >({});
 main

export interface UseMeshDataChannelsOptions {
  peerId: string;
  peerConnection: PeerConnectionLike | null | undefined;
  signaling?: SignalingChannelLike | null;
  maxRestarts?: number;
  baseBackoffMs?: number;
  onSignalOffer?: (peerId: string, offer: RTCSessionDescriptionInit) => void;
  onConnectionTerminated?: (peerId: string, attempts: number) => void;
}

 feat/webrtc-ice-restart-backoff
export interface MeshDataChannelState {
  iceState: string;
  restartAttempts: number;
  isTerminated: boolean;
  triggerIceRestart: () => Promise<boolean>;
  resetRestartCount: () => void;
}
  const prevBitrateBaselineRef = useRef<Map<string, PeerBitrateBaseline>>(
    new Map(),
  );
  const prevRtpBaselineRef = useRef<Map<string, PeerRtpBaseline>>(new Map());

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);
 main

export function computeIceBackoffMs(attempt: number, baseBackoffMs = 250): number {
  const safeAttempt = Math.max(1, attempt);
  return baseBackoffMs * Math.pow(2, safeAttempt - 1);
}

export function useMeshDataChannels({
  peerId,
  peerConnection,
  signaling,
  maxRestarts = 3,
  baseBackoffMs = 250,
  onSignalOffer,
  onConnectionTerminated,
}: UseMeshDataChannelsOptions): MeshDataChannelState {
  const [iceState, setIceState] = useState<string>(
    peerConnection?.iceConnectionState ?? 'new'
  );
  const [restartAttempts, setRestartAttempts] = useState<number>(0);
  const [isTerminated, setIsTerminated] = useState<boolean>(false);

  const attemptsRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const onSignalOfferRef = useRef(onSignalOffer);
  onSignalOfferRef.current = onSignalOffer;
  const onTerminatedRef = useRef(onConnectionTerminated);
  onTerminatedRef.current = onConnectionTerminated;

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

 feat/webrtc-ice-restart-backoff
  const resetRestartCount = useCallback(() => {
    clearPendingTimer();
    attemptsRef.current = 0;
    if (isMountedRef.current) {
      setRestartAttempts(0);
      setIsTerminated(false);
    }
  }, [clearPendingTimer]);

  const cleanupPeer = useCallback(
    (peerId: string) => {
      // Drop cached digests even when the peer's RTCPeerConnection was
      // already removed; reconnect must begin with a fresh checksum exchange.
      resetStateVectorChecksumCache();
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

      if (!pc) {
        updatePeerCount();
        if (dataChannelsRef.current.size === 0) setIsConnected(false);
        return;
      }
 main

  const executeIceRestartOffer = useCallback(async (): Promise<boolean> => {
    if (!peerConnection || !isMountedRef.current) {
      return false;
    }

    if (typeof peerConnection.restartIce === 'function') {
      peerConnection.restartIce();
    }

    const offer = await peerConnection.createOffer({ iceRestart: true });
    if (!isMountedRef.current) {
      return false;
    }

 feat/webrtc-ice-restart-backoff
    await peerConnection.setLocalDescription(offer);
    if (!isMountedRef.current) {
      return false;
    }

      dc.onclose = () => {
        resetStateVectorChecksumCache();
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
 main

    if (signaling) {
      signaling.send(
        JSON.stringify({
          type: 'ICE_RESTART_OFFER',
          targetPeerId: peerId,
          sdp: offer,
        })
      );
    }

    onSignalOfferRef.current?.(peerId, offer);
    return true;
  }, [peerConnection, peerId, signaling]);

  const triggerIceRestart = useCallback(async (): Promise<boolean> => {
    if (!peerConnection || !isMountedRef.current) {
      return false;
    }

    if (attemptsRef.current >= maxRestarts) {
      setIsTerminated(true);
      onTerminatedRef.current?.(peerId, attemptsRef.current);
      return false;
    }

    const nextAttempt = attemptsRef.current + 1;
    attemptsRef.current = nextAttempt;
    setRestartAttempts(nextAttempt);

    const delayMs = computeIceBackoffMs(nextAttempt, baseBackoffMs);

    return new Promise<boolean>((resolve) => {
      clearPendingTimer();
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        if (!isMountedRef.current) {
          resolve(false);
          return;
        }
        try {
          const sent = await executeIceRestartOffer();
          resolve(sent);
        } catch {
          if (attemptsRef.current >= maxRestarts && isMountedRef.current) {
            setIsTerminated(true);
            onTerminatedRef.current?.(peerId, attemptsRef.current);
          }
          resolve(false);
        }
      }, delayMs);
    });
  }, [
    baseBackoffMs,
    clearPendingTimer,
    executeIceRestartOffer,
    maxRestarts,
    peerConnection,
    peerId,
  ]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearPendingTimer();
    };
  }, [clearPendingTimer]);

  useEffect(() => {
    if (!peerConnection) {
      setIceState('closed');
      return;
    }

    setIceState(peerConnection.iceConnectionState);

    const handleStateChange = () => {
      if (!isMountedRef.current) return;
      const currentState = peerConnection.iceConnectionState;
      setIceState(currentState);

      if (currentState === 'connected' || currentState === 'completed') {
        resetRestartCount();
        return;
      }

      if (currentState === 'failed') {
        void triggerIceRestart();
      }
    };

    peerConnection.oniceconnectionstatechange = handleStateChange;

    return () => {
      if (peerConnection.oniceconnectionstatechange === handleStateChange) {
        peerConnection.oniceconnectionstatechange = null;
      }
      clearPendingTimer();
    };
 feat/webrtc-ice-restart-backoff
  }, [peerConnection, resetRestartCount, triggerIceRestart, clearPendingTimer]);

  return {
    iceState,
    restartAttempts,
    isTerminated,
    triggerIceRestart,
    resetRestartCount,

  }, [cleanupPeer]);

  // Telemetry Polling Loop (~3000ms)
  useEffect(() => {
    let isCancelled = false;

    const pollStats = async () => {
      if (peersRef.current.size === 0) return;

      const now = Date.now();
      const updates: Record<string, PeerTelemetry> = {};

      for (const [peerId, pc] of peersRef.current.entries()) {
        if (!pc || pc.signalingState === "closed" || pc.connectionState === "closed") {
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
                rtpPacketsReceived = (rtpPacketsReceived ?? 0) + stat.packetsReceived;
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
          };
        } catch {
          // Ignore stats errors for transient peer state
        }
      }

      if (!isCancelled && Object.keys(updates).length > 0) {
        setPeerTelemetry((prev) => ({ ...prev, ...updates }));
      }
    };

    const intervalId = setInterval(() => {
      void pollStats();
    }, 3000);

    // Initial immediate poll
    void pollStats();

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const sendToAll = useCallback((data: ArrayBuffer) => {
    for (const dc of dataChannelsRef.current.values()) {
      if (dc.readyState === "open") {
        try {
          dc.send(data);
        } catch {
          // Peer may have disconnected
        }
      }
    }
  }, []);

  const sendToPeer = useCallback((peerId: string, data: ArrayBuffer) => {
    const dc = dataChannelsRef.current.get(peerId);
    if (dc?.readyState === "open") {
      try {
        dc.send(data);
      } catch {
        // Peer may have disconnected
      }
    }
  }, []);

  return {
    sendToAll,
    sendToPeer,
    peerCount,
    isConnected,
    peerTelemetry,
 main
  };
}