/**
 * # WebRTC Peer-to-Peer Mesh Networking Architecture
 *
 * ## 1. Executive Summary
 *
 * The `useWebRTCMesh.ts` hook implements a robust, client-side peer-to-peer (P2P) mesh networking topology. It is designed to support real-time audio, video, and screen-sharing streams for up to 6 concurrent participants (1 local + 5 remote).
 *
 * Instead of relying on an expensive centralized Selective Forwarding Unit (SFU) or Multipoint Control Unit (MCU), this architecture utilizes a decentralized **Mesh Topology**. Every participant establishes a direct `RTCPeerConnection` with every other participant in the room.
 *
 * To establish these direct connections, the clients use a centralized WebSocket signaling server (powered by PartyKit) exclusively for the initial exchange of Session Description Protocol (SDP) offers, answers, and Interactive Connectivity Establishment (ICE) candidates.
 *
 * ---
 *
 * ## 2. Perfect Negotiation & Signaling Flow
 *
 * The architecture implements the **Perfect Negotiation** pattern to prevent state collisions when two peers attempt to connect or upgrade streams simultaneously. It assigns roles:
 * *   **Initiator (Polite Peer):** The peer who receives the `peer-join` event and initiates the connection. Will yield (rollback) if a collision occurs.
 * *   **Receiver (Impolite Peer):** The peer who just joined. Will ignore conflicting offers and prioritize its own state.
 *
 * ### 2.1 WebRTC Connection Sequence Diagram
 *
 * ```mermaid
 * sequenceDiagram
 *     autonumber
 *     participant P1 as Peer 1 (Local/Initiator)
 *     participant Sig as Signaling Server (PartyKit)
 *     participant P2 as Peer 2 (Remote/Receiver)
 *     participant STUN as Google STUN Server
 *
 *     Note over P1, P2: 1. Peer Discovery
 *     P2->>Sig: { type: "webrtc-signal", kind: "peer-join" }
 *     Sig->>P1: Forwards "peer-join" to all room members
 *
 *     Note over P1: P1 marks self as "Polite" (Initiator)
 *     P1->>P1: createOffer() & setLocalDescription()
 *     P1->>Sig: { kind: "offer", sdp: RTCSessionDescription }
 *     Sig->>P2: Forwards Offer
 *
 *     Note over P2: P2 marks self as "Impolite"
 *     P2->>P2: setRemoteDescription(Offer)
 *     P2->>P2: createAnswer() & setLocalDescription()
 *     P2->>Sig: { kind: "answer", sdp: RTCSessionDescription }
 *     Sig->>P1: Forwards Answer
 *     P1->>P1: setRemoteDescription(Answer)
 *
 *     Note over P1, P2: 2. ICE Candidate Gathering & Exchange
 *     par ICE Gathering
 *         P1->>STUN: Request Public IP/Port
 *         STUN-->>P1: Returns Server Reflexive Candidate
 *         P1->>Sig: { kind: "ice", candidate: RTCIceCandidate }
 *         Sig->>P2: Forwards ICE Candidate
 *         P2->>P2: addIceCandidate()
 *     and
 *         P2->>STUN: Request Public IP/Port
 *         STUN-->>P2: Returns Server Reflexive Candidate
 *         P2->>Sig: { kind: "ice", candidate: RTCIceCandidate }
 *         Sig->>P1: Forwards ICE Candidate
 *         P1->>P1: addIceCandidate()
 *     end
 *
 *     Note over P1, P2: 3. Direct P2P Connection Established
 *     P1<-->>P2: Encrypted Media Tracks (SRTP) & Data flowing
 * ```
 *
 * ---
 *
 * ## 3. Data Channel Fallback & Recovery Protocol
 *
 * Because P2P connections are subject to unpredictable NAT strictness, aggressive corporate firewalls, and network changes (e.g., switching from Wi-Fi to Cellular), the architecture employs strict lifecycle monitoring and fallback mechanisms.
 *
 * ### 3.1 Connection State Monitoring
 * The `useWebRTCMesh` hook constantly listens to the `oniceconnectionstatechange` event. If a peer's connection state transitions to `"disconnected"` or `"failed"`, the `cleanupPeer()` routine is immediately triggered to prevent memory leaks and ghost audio.
 *
 * ### 3.2 Signaling Relay Fallback (The WebRTC Fallback Protocol)
 * When direct P2P connections fail, the architecture relies on the following fallback tiers:
 *
 * 1.  **STUN Fallback:** The primary resolution uses `stun:stun.l.google.com:19302` to traverse standard NATs by discovering the public IP.
 * 2.  **TURN Fallback (Future Expansion):** For symmetric NATs where STUN fails, the `RTCPeerConnection` configuration can be injected with TURN (Traversal Using Relays around NAT) credentials. This routes the media through a secure external server.
 * 3.  **Application State Fallback (PartyKit WebSocket):** While media tracks require WebRTC, critical application state (like text chat, mute toggles, and participant presence) does not rely on `RTCDataChannel`. Instead, the architecture safely falls back to using the persistent WebSocket connection (`socketRef.current.send()`). This ensures that even if a strict firewall blocks UDP media traffic, users remain visible and can communicate via text.
 *
 * ---
 *
 * ## 4. Security & Encryption Practices (DTLS/SRTP)
 *
 * Security is not an afterthought in this mesh architecture; it is strictly enforced by WebRTC specifications and browser constraints.
 *
 * ### 4.1 Datagram Transport Layer Security (DTLS)
 * All data exchanged between peers is end-to-end encrypted. WebRTC absolutely prohibits unencrypted connections.
 * *   During the SDP Offer/Answer phase, peers exchange **DTLS fingerprints**.
 * *   Once ICE candidates establish a network path, a DTLS handshake is performed directly between the peers.
 * *   This ensures that even though the signaling server (PartyKit) facilitates the connection, it **cannot** decrypt the media or data flowing between peers.
 *
 * ### 4.2 Secure Real-time Transport Protocol (SRTP)
 * Once the DTLS handshake is complete, the encryption keys are extracted to set up SRTP.
 * *   **Media Privacy:** All audio (`localStream`), video, and screen-sharing (`localScreenStream`) tracks are routed through SRTP.
 * *   **Integrity Verification:** SRTP provides message authentication, ensuring that an attacker cannot inject or modify video/audio packets in transit without immediately invalidating the connection.
 *
 * ### 4.3 Signaling Security
 * *   The PartyKit signaling WebSocket operates exclusively over **WSS (WebSocket Secure)**, protected by TLS.
 * *   Connections to the signaling room require a Clerk authentication token (`query: token ? { token } : undefined`). The server rejects unauthorized sockets, preventing unauthorized users from joining the mesh or observing SDP traffic.
 *
 * ---
 *
 * ## 5. Network Telemetry & Quality Adaptation
 *
 * The architecture does not blindly stream data. It constantly profiles the connection health:
 *
 * 1.  **Round Trip Time (RTT) EMA:** The hook fires a signaling ping every 2000ms. It calculates an Exponential Moving Average (EMA) of the RTT to determine network quality (`good`, `fair`, `poor`).
 * 2.  **Audio Downsampling:** If the network is classified as `"poor"` (RTT > 300ms), the local audio track constraints are dynamically degraded to a 16kHz sample rate to conserve bandwidth, restoring to 48kHz when the connection stabilizes.
 * 3.  **Video Bitrate Adaptation:** A background loop (`adaptVideoBitrate`) cycles every 4000ms, commanding the RTCPeerConnections to dynamically adjust video encoding parameters based on available bandwidth.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "partysocket/react";
import { adaptVideoBitrate } from "@/lib/screenShareBitrate";

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
  const [localScreenStream, setLocalScreenStream] =
    useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({});

  // Toggles
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Network Telemetry
  const [rtt, setRtt] = useState<number>(0);
  const [networkQuality, setNetworkQuality] = useState<
    "good" | "fair" | "poor" | "unknown"
  >("unknown");

  // Refs for WebRTC state
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  type PeerState = {
    makingOffer: boolean;
    ignoreOffer: boolean;
    polite: boolean;
    isSettingRemoteAnswerPending: boolean;
  };
  const peerStatesRef = useRef<Map<string, PeerState>>(new Map());

  const socketRef = useRef<{ send: (data: string) => void } | null>(null);

  // Audio context for monitoring levels
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<
    Map<string, { analyser: AnalyserNode; dataArray: Uint8Array }>
  >(new Map());

  // Intervals
  const bitrateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioLevelTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rttEmaRef = useRef<number>(0);

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

  const cleanupPeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (!pc) return;

    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    peersRef.current.delete(peerId);
    peerStatesRef.current.delete(peerId);

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

  const setupAudioMonitoring = useCallback(
    (peerId: string, stream: MediaStream) => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (
          window.AudioContext || (window as any).webkitAudioContext
        )();
      }

      const audioCtx = audioContextRef.current;
      if (audioCtx.state === "suspended") {
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
    },
    [],
  );

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
      const polite = isInitiator;
      peerStatesRef.current.set(peerId, {
        makingOffer: false,
        ignoreOffer: false,
        polite,
        isSettingRemoteAnswerPending: false,
      });

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
        if (
          pc?.iceConnectionState === "disconnected" ||
          pc?.iceConnectionState === "failed"
        ) {
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
        const state = peerStatesRef.current.get(peerId);
        if (!state) return;

        try {
          state.makingOffer = true;
          await pc!.setLocalDescription();
          sendSignal({
            kind: "offer",
            to: peerId,
            sdp: pc!.localDescription!,
          });
        } catch (err) {
          console.error("Negotiation error:", err);
        } finally {
          state.makingOffer = false;
        }
      };

      return pc;
    },
    [sendSignal, cleanupPeer, setupAudioMonitoring],
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

      for (const [
        peerId,
        { analyser, dataArray },
      ] of analysersRef.current.entries()) {
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

  const startPingLoop = useCallback(() => {
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = setInterval(() => {
      if (socketRef.current) {
        socketRef.current.send(
          JSON.stringify({ type: "ping", timestamp: Date.now() }),
        );
      }
    }, 2000);
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

      if (msg.kind === "offer" || msg.kind === "answer") {
        const pc =
          peersRef.current.get(msg.from) || ensurePeer(msg.from, false);
        if (!pc) return;
        const state = peerStatesRef.current.get(msg.from);
        if (!state) return;

        const description = msg.sdp as RTCSessionDescriptionInit;
        const offerCollision =
          description.type === "offer" &&
          (state.makingOffer || pc.signalingState !== "stable");

        state.ignoreOffer = !state.polite && offerCollision;
        if (state.ignoreOffer) {
          return;
        }

        try {
          if (offerCollision) {
            await pc.setLocalDescription({ type: "rollback" });
          }
          await pc.setRemoteDescription(description);
          if (description.type === "offer") {
            await pc.setLocalDescription();
            sendSignal({
              kind: "answer",
              to: msg.from,
              sdp: pc.localDescription!,
            });
          }
        } catch (err) {
          console.error("Signal handling error", err);
          cleanupPeer(msg.from);
        }
        return;
      }

      if (msg.kind === "ice" && msg.candidate) {
        const pc = peersRef.current.get(msg.from);
        if (!pc) return;
        const state = peerStatesRef.current.get(msg.from);

        try {
          if (state && state.ignoreOffer) return;
          await pc.addIceCandidate(msg.candidate);
        } catch (err) {
          console.error("Error adding ice candidate", err);
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
        const data = JSON.parse(event.data);
        if (data.type === "pong" && data.timestamp) {
          const currentRtt = Date.now() - data.timestamp;
          if (rttEmaRef.current === 0) {
            rttEmaRef.current = currentRtt;
          } else {
            rttEmaRef.current = rttEmaRef.current * 0.7 + currentRtt * 0.3;
          }
          setRtt(rttEmaRef.current);

          if (rttEmaRef.current > 300) setNetworkQuality("poor");
          else if (rttEmaRef.current > 100) setNetworkQuality("fair");
          else setNetworkQuality("good");

          return;
        }
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
    startPingLoop();
    const peersMap = peersRef.current;

    return () => {
      if (bitrateTimerRef.current) clearInterval(bitrateTimerRef.current);
      if (audioLevelTimerRef.current) clearInterval(audioLevelTimerRef.current);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);

      const currentPeers = Array.from(peersMap.keys());
      for (const id of currentPeers) {
        cleanupPeer(id);
      }

      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());

      if (audioContextRef.current?.state !== "closed") {
        audioContextRef.current?.close();
      }
    };
  }, [cleanupPeer, startBitrateLoop, startAudioMonitoringLoop, startPingLoop]);

  useEffect(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (!audioTrack) return;

    if (networkQuality === "poor") {
      audioTrack.applyConstraints({ sampleRate: 16000 }).catch((err) => {
        console.warn("Failed to downsample audio:", err);
      });
    } else if (networkQuality === "good") {
      audioTrack.applyConstraints({ sampleRate: 48000 }).catch((err) => {
        console.warn("Failed to restore audio sample rate:", err);
      });
    }
  }, [networkQuality]);

  const ensureLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 15 },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      stream.getAudioTracks().forEach((t) => (t.enabled = false));
      stream.getVideoTracks().forEach((t) => (t.enabled = false));

      localStreamRef.current = stream;
      setLocalStream(stream);
      setupAudioMonitoring("local", stream);

      for (const pc of peersRef.current.values()) {
        for (const track of stream.getTracks()) {
          try {
            pc.addTrack(track, stream);
          } catch {}
        }
      }

      return stream;
    } catch {
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
      localScreenStreamRef.current.getTracks().forEach((t) => t.stop());
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
          try {
            pc.addTrack(track, stream);
          } catch {}
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
    rtt,
    networkQuality,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
  };
}
