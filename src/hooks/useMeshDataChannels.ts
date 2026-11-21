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

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const socketRef = useRef<{ send: (data: string) => void } | null>(null);
  const onDataRef = useRef<DataHandler | undefined>(onData);

  const prevBitrateBaselineRef = useRef<Map<string, PeerBitrateBaseline>>(
    new Map(),
  );
  const prevRtpBaselineRef = useRef<Map<string, PeerRtpBaseline>>(new Map());

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

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

      pc.onicecandidate = null;
      pc.ondatachannel = null;
      pc.close();
      peersRef.current.delete(peerId);
      dataChannelsRef.current.delete(peerId);
      updatePeerCount();
    },
    [updatePeerCount],
  );

  const setupDataChannel = useCallback(
    (dc: RTCDataChannel, peerId: string) => {
      dataChannelsRef.current.set(peerId, dc);

      dc.onopen = () => {
        updatePeerCount();
        setIsConnected(true);
      };

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

      dc.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          onDataRef.current?.(peerId, event.data);
        }
      };
    },
    [updatePeerCount],
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
    return () => {
      for (const id of peerIds) {
        cleanupPeer(id);
      }
    };
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
  };
}
