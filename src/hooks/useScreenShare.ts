"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "partysocket/react";
import { adaptVideoBitrate } from "@/lib/screenShareBitrate";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type SignalKind =
  "share-start" | "share-stop" | "viewer-ready" | "offer" | "answer" | "ice";

type SignalMessage = {
  type: "webrtc-signal";
  kind: SignalKind;
  from: string;
  to?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

type Options = {
  roomId: string;
  userId: string | null | undefined;
  isHost: boolean;
};

function partyHost() {
  if (typeof window === "undefined") return "127.0.0.1:1999";
  return process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
}

export function useScreenShare({ roomId, userId, isHost }: Options) {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pipSupported, setPipSupported] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const bitrateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<{ send: (data: string) => void } | null>(null);

  useEffect(() => {
    getToken()
      .then(setToken)
      .catch(() => setToken(null));
  }, [getToken]);

  useEffect(() => {
    setPipSupported(
      typeof document !== "undefined" &&
        "pictureInPictureEnabled" in document &&
        !!document.pictureInPictureEnabled,
    );
  }, []);

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

  const cleanupPeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (!pc) return;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    peersRef.current.delete(peerId);
  }, []);

  const cleanupAll = useCallback(() => {
    if (bitrateTimerRef.current) {
      clearInterval(bitrateTimerRef.current);
      bitrateTimerRef.current = null;
    }
    for (const id of [...peersRef.current.keys()]) {
      cleanupPeer(id);
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setSharing(false);
  }, [cleanupPeer]);

  const ensurePeer = useCallback(
    (peerId: string, asOfferer: boolean) => {
      let pc = peersRef.current.get(peerId);
      if (pc) return pc;

      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(peerId, pc);

      pc.onicecandidate = (ev) => {
        sendSignal({
          kind: "ice",
          to: peerId,
          candidate: ev.candidate ? ev.candidate.toJSON() : null,
        });
      };

      pc.ontrack = (ev) => {
        const stream = ev.streams[0] ?? new MediaStream([ev.track]);
        setRemoteStream(stream);
      };

      const local = localStreamRef.current;
      if (local && asOfferer) {
        for (const track of local.getTracks()) {
          pc.addTrack(track, local);
        }
      }

      return pc;
    },
    [sendSignal],
  );

  const startBitrateLoop = useCallback(() => {
    if (bitrateTimerRef.current) clearInterval(bitrateTimerRef.current);
    bitrateTimerRef.current = setInterval(() => {
      for (const pc of peersRef.current.values()) {
        void adaptVideoBitrate(pc);
      }
    }, 4000);
  }, []);

  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      if (!userId || msg.from === userId) return;

      if (msg.kind === "share-start" && !isHost) {
        sendSignal({ kind: "viewer-ready", to: msg.from });
        return;
      }

      if (msg.kind === "share-stop") {
        cleanupPeer(msg.from);
        setRemoteStream(null);
        return;
      }

      if (msg.kind === "viewer-ready" && isHost && localStreamRef.current) {
        if (msg.to && msg.to !== userId) return;
        const pc = ensurePeer(msg.from, true);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({
            kind: "offer",
            to: msg.from,
            sdp: pc.localDescription ?? offer,
          });
        } catch {
          cleanupPeer(msg.from);
        }
        return;
      }

      if (msg.kind === "offer" && msg.to === userId) {
        const pc = ensurePeer(msg.from, false);
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
          // Candidate can arrive early; fine to drop.
        }
      }
    },
    [userId, isHost, sendSignal, ensurePeer, cleanupPeer],
  );

  const socket = usePartySocket({
    host: partyHost(),
    room: roomId || "screen-share-room",
    startClosed: !roomId,
    query: token ? { token } : undefined,
    onOpen() {
      // Late joiners: poke the host in case a share is already running.
      if (userId && !isHost) {
        sendSignal({ kind: "viewer-ready" });
      }
    },
    onMessage(event) {
      try {
        const data = JSON.parse(event.data) as SignalMessage;
        if (data.type !== "webrtc-signal") return;
        void handleSignal(data);
      } catch {
        // ignore non-json
      }
    },
  });

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    return () => {
      cleanupAll();
    };
  }, [cleanupAll]);

  const startShare = useCallback(async () => {
    if (!isHost || !userId) {
      setError("Only the session host can share their screen.");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen sharing is not supported in this browser.");
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setSharing(true);

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          sendSignal({ kind: "share-stop" });
          cleanupAll();
        };
      }

      sendSignal({ kind: "share-start" });
      startBitrateLoop();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") {
        setError("Screen capture permission was denied.");
      } else {
        setError("Could not start screen share.");
      }
      cleanupAll();
    }
  }, [isHost, userId, sendSignal, cleanupAll, startBitrateLoop]);

  const stopShare = useCallback(() => {
    sendSignal({ kind: "share-stop" });
    cleanupAll();
  }, [sendSignal, cleanupAll]);

  const requestPip = useCallback(async (video: HTMLVideoElement | null) => {
    if (!video) return false;
    if (!document.pictureInPictureEnabled) return false;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        return false;
      }
      await video.requestPictureInPicture();
      return true;
    } catch {
      setError("Picture-in-picture failed.");
      return false;
    }
  }, []);

  return {
    sharing,
    localStream,
    remoteStream,
    error,
    pipSupported,
    startShare,
    stopShare,
    requestPip,
  };
}
