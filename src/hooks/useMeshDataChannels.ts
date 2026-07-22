"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "partysocket/react";

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

function partyHost() {
  if (typeof window === "undefined") return "127.0.0.1:1999";
  return process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
}

export function useMeshDataChannels({ roomId, userId, onData }: Options) {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const socketRef = useRef<{ send: (data: string) => void } | null>(null);
  const onDataRef = useRef<DataHandler | undefined>(onData);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    getToken()
      .then(setToken)
      .catch(() => setToken(null));
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
      const pc = peersRef.current.get(peerId);
      if (!pc) return;

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
        dataChannelsRef.current.delete(peerId);
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
  };
}
