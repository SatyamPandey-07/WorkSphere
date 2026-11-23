
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "partysocket/react";
import { resetStateVectorChecksumCache } from "@/lib/crdt/stateVectorChecksum";
import {
  MeshBloomFilter,
  type MeshBloomFilterConfig,
} from "@/lib/p2p/meshBloomFilter";

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
  enableDeduplication?: boolean;
  bloomConfig?: Partial<MeshBloomFilterConfig>;
};

function partyHost() {
  if (typeof window === "undefined") return "127.0.0.1:1999";
  return process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
}

export function useMeshDataChannels({
  roomId,
  userId,
  onData,
  enableDeduplication = true,
  bloomConfig,
}: Options) {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [droppedDuplicates, setDroppedDuplicates] = useState(0);

  const enableDeduplicationRef = useRef(enableDeduplication);
  useEffect(() => {
    enableDeduplicationRef.current = enableDeduplication;
  }, [enableDeduplication]);

  const bloomFilterRef = useRef<MeshBloomFilter | null>(null);
  if (!bloomFilterRef.current && enableDeduplication) {
    bloomFilterRef.current = new MeshBloomFilter({
      capacity: 5000,
      targetFpr: 0.001,
      rotationIntervalMs: 60_000,
      autoRotate: true,
      ...bloomConfig,
    });
  }

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const socketRef = useRef<{ send: (data: string) => void } | null>(null);
  const onDataRef = useRef<DataHandler | undefined>(onData);

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

import { useEffect, useRef, useState } from 'react';
import {
  useBatteryOptimization,
  type BatteryManagerLike,
} from '@/hooks/useBatteryOptimization';
import {
  AdaptiveAudioBitrateController,
  MAX_AUDIO_BITRATE_BPS,
  type AdaptiveAudioTelemetryEvent,
} from '@/lib/realtime/webrtc/meshConnection';

export interface UseMeshDataChannelsOptions {
  peerId: string;
  peerConnection: (Pick<RTCPeerConnection, 'getStats' | 'getSenders'> & {
    addEventListener?: RTCPeerConnection['addEventListener'];
  }) | null;
  sampleIntervalMs?: number;
  onTelemetry?: (event: AdaptiveAudioTelemetryEvent) => void;
  getBatteryFn?: () => Promise<BatteryManagerLike>;
}

export function useMeshDataChannels({
  peerId,
  peerConnection,
  sampleIntervalMs = 1_000,
  onTelemetry,
  getBatteryFn,
}: UseMeshDataChannelsOptions) {
  const [audioBitrateBps, setAudioBitrateBps] = useState<number>(
    MAX_AUDIO_BITRATE_BPS

  );
  const [lastTelemetry, setLastTelemetry] =
    useState<AdaptiveAudioTelemetryEvent | null>(null);
  const controllerRef = useRef<AdaptiveAudioBitrateController | null>(null);


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
        updatePeerCount();
        if (dataChannelsRef.current.size === 0) {
          setIsConnected(false);
        }
      };

      dc.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          if (enableDeduplicationRef.current && bloomFilterRef.current) {
            const msgId = bloomFilterRef.current.extractMessageId(event.data);
            if (bloomFilterRef.current.testAndAdd(msgId)) {
              setDroppedDuplicates((c) => c + 1);
              return;
            }
          }
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

  const batteryOptimization = useBatteryOptimization(getBatteryFn);


  useEffect(() => {
    const controller = new AdaptiveAudioBitrateController(peerId, {
      onTelemetry: (evt) => {
        setLastTelemetry(evt);
        setAudioBitrateBps(evt.nextBitrateBps);
        onTelemetry?.(evt);
      },
    });
    controllerRef.current = controller;

    if (!peerConnection) return;

    let cancelled = false;
    const poll = async () => {
      if (cancelled || !controllerRef.current) return;
      const next = await controllerRef.current.sampleAndAdapt(
        peerConnection,
        Date.now()
      );
      if (!cancelled) {
        setAudioBitrateBps(next);
      }
      bloomFilterRef.current?.destroy();
    };


  const sendToAll = useCallback((data: ArrayBuffer) => {
    if (enableDeduplicationRef.current && bloomFilterRef.current) {
      const msgId = bloomFilterRef.current.extractMessageId(data);
      bloomFilterRef.current.add(msgId);
    }
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
    if (enableDeduplicationRef.current && bloomFilterRef.current) {
      const msgId = bloomFilterRef.current.extractMessageId(data);
      bloomFilterRef.current.add(msgId);
    }
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
    droppedDuplicates,
    bloomFilter: bloomFilterRef.current,

    const timerId = setInterval(() => {
      void poll();
    }, sampleIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, [peerId, peerConnection, sampleIntervalMs, onTelemetry]);

  return {
    audioBitrateBps,
    lastTelemetry,
    isLowPowerMode: batteryOptimization.isLowPowerMode,
    crdtBatchIntervalMs: batteryOptimization.crdtBatchIntervalMs,
    pauseDecorativeAnimations: batteryOptimization.pauseDecorativeAnimations,
    fftSize: batteryOptimization.fftSize,

  };
}