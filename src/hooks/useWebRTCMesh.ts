"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "partysocket/react";
import { adaptVideoBitrate } from "@/lib/screenShareBitrate";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type SignalKind =
  | "peer-join"
  | "offer"
  | "answer"
  | "ice"
  | "peer-leave";

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
};

function partyHost() {
  if (typeof window === "undefined") return "127.0.0.1:1999";
  return process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
}

export function useWebRTCMesh({ roomId, userId }: Options) {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);

  // States for media
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({});
  
  // Toggles
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for WebRTC state
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketRef = useRef<{ send: (data: string) => void } | null>(null);
  
  // Audio context for monitoring levels
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Map<string, { analyser: AnalyserNode, dataArray: Uint8Array }>>(new Map());

  // Intervals
  const bitrateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioLevelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    [userId]
  );

  const cleanupPeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (!pc) return;
    
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    peersRef.current.delete(peerId);
    
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });

    setAudioLevels((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });

    analysersRef.current.delete(peerId);
  }, []);

  const setupAudioMonitoring = useCallback((peerId: string, stream: MediaStream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    const audioCtx = audioContextRef.current;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    if (stream.getAudioTracks().length === 0) return;

    try {
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      analysersRef.current.set(peerId, { analyser, dataArray });
    } catch (e) {
      console.warn("Could not setup audio monitoring for peer", peerId, e);
    }
  }, []);

  const ensurePeer = useCallback(
    (peerId: string, isInitiator: boolean) => {
      let pc = peersRef.current.get(peerId);
      if (pc) return pc;

      // Limit to 5 remote peers (total 6 participants)
      if (peersRef.current.size >= 5) {
        console.warn("Max peers reached, cannot connect to", peerId);
        return null;
      }

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
        setRemoteStreams((prev) => {
          const existingStream = prev[peerId] || new MediaStream();
          if (!existingStream.getTracks().includes(ev.track)) {
            existingStream.addTrack(ev.track);
          }
          setupAudioMonitoring(peerId, existingStream);
          return {
            ...prev,
            [peerId]: existingStream,
          };
        });
      };

      pc.oniceconnectionstatechange = () => {
        if (pc?.iceConnectionState === "disconnected" || pc?.iceConnectionState === "failed") {
          cleanupPeer(peerId);
        }
      };

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      if (localScreenStreamRef.current) {
        for (const track of localScreenStreamRef.current.getTracks()) {
          pc.addTrack(track, localScreenStreamRef.current);
        }
      }

      pc.onnegotiationneeded = async () => {
        try {
          if (pc?.signalingState !== "stable") return;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({
            kind: "offer",
            to: peerId,
            sdp: pc.localDescription ?? offer,
          });
        } catch (err) {
          console.error("Negotiation error:", err);
        }
      };

      if (isInitiator) {
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
    [sendSignal, cleanupPeer, setupAudioMonitoring]
  );

  const startBitrateLoop = useCallback(() => {
    if (bitrateTimerRef.current) clearInterval(bitrateTimerRef.current);
    bitrateTimerRef.current = setInterval(() => {
      for (const pc of peersRef.current.values()) {
        void adaptVideoBitrate(pc);
      }
    }, 4000);
  }, []);

  const startAudioMonitoringLoop = useCallback(() => {
    if (audioLevelTimerRef.current) clearInterval(audioLevelTimerRef.current);
    audioLevelTimerRef.current = setInterval(() => {
      const newLevels: Record<string, number> = {};
      
      for (const [peerId, { analyser, dataArray }] of analysersRef.current.entries()) {
        analyser.getByteFrequencyData(dataArray as any);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        // Normalize 0-1
        newLevels[peerId] = Math.min(1, average / 128);
      }
      
      setAudioLevels(newLevels);
    }, 100);
  }, []);

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
        } catch {}
      }
    },
    [userId, ensurePeer, cleanupPeer, sendSignal]
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
      } catch {}
    },
  });

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    startBitrateLoop();
    startAudioMonitoringLoop();
    return () => {
      if (bitrateTimerRef.current) clearInterval(bitrateTimerRef.current);
      if (audioLevelTimerRef.current) clearInterval(audioLevelTimerRef.current);
      
      for (const id of [...peersRef.current.keys()]) {
        cleanupPeer(id);
      }
      
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
      
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, [cleanupPeer, startBitrateLoop, startAudioMonitoringLoop]);

  const ensureLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 15 },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      
      stream.getAudioTracks().forEach(t => t.enabled = false);
      stream.getVideoTracks().forEach(t => t.enabled = false);
      
      localStreamRef.current = stream;
      setLocalStream(stream);
      setupAudioMonitoring("local", stream);

      for (const pc of peersRef.current.values()) {
        for (const track of stream.getTracks()) {
          try { pc.addTrack(track, stream); } catch {}
        }
      }
      
      return stream;
    } catch (err) {
      setError("Could not access camera or microphone.");
      return null;
    }
  };

  const toggleAudio = async () => {
    const stream = await ensureLocalStream();
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsAudioEnabled(audioTrack.enabled);
    }
  };

  const toggleVideo = async () => {
    const stream = await ensureLocalStream();
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoEnabled(videoTrack.enabled);
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing && localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach(t => t.stop());
      localScreenStreamRef.current = null;
      setLocalScreenStream(null);
      setIsScreenSharing(false);
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen sharing is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
      });

      localScreenStreamRef.current = stream;
      setLocalScreenStream(stream);
      setIsScreenSharing(true);

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          localScreenStreamRef.current = null;
          setLocalScreenStream(null);
          setIsScreenSharing(false);
        };
      }

      for (const pc of peersRef.current.values()) {
        for (const track of stream.getTracks()) {
          try { pc.addTrack(track, stream); } catch {}
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setError("Could not start screen share.");
      }
    }
  };

  return {
    localStream,
    localScreenStream,
    remoteStreams,
    audioLevels,
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    error,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
  };
}
