"use client";

import { useCallback, useMemo, useState } from "react";
import { useWebRTCMesh } from "@/hooks/useWebRTCMesh";
import { useUser } from "@clerk/nextjs";
import { PeerAvatarTile } from "./PeerAvatarTile";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MonitorDown,
  PhoneOff,
  Signal,
  Loader2,
} from "lucide-react";

type MeshCallGridProps = {
  /** Session slug used as PartyKit room ID */
  sessionSlug: string;
  /** Session host userId */
  hostId?: string;
};

/**
 * MeshCallGrid renders a responsive grid of peer avatar tiles
 * with audio level indicators for a WebRTC mesh call room.
 */
export function MeshCallGrid({ sessionSlug }: MeshCallGridProps) {
  const { user } = useUser();
  const [isJoined, setIsJoined] = useState(false);

  const {
    localStream,
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
  } = useWebRTCMesh({
    roomId: `session-${sessionSlug}`,
    userId: user?.id,
  });

  // Collect all peers: local + remotes
  const peers = useMemo(() => {
    const items: Array<{
      peerId: string;
      name: string;
      stream: MediaStream | null;
      isLocal: boolean;
      audioLevel: number;
      audioEnabled: boolean;
      videoEnabled: boolean;
      isSpeaking: boolean;
    }> = [];

    // Local peer
    if (isJoined) {
      items.push({
        peerId: "local",
        name:
          `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "You",
        stream: localStream,
        isLocal: true,
        audioLevel: audioLevels["local"] ?? 0,
        audioEnabled: isAudioEnabled,
        videoEnabled: isVideoEnabled,
        isSpeaking: (audioLevels["local"] ?? 0) > 0.15 && isAudioEnabled,
      });
    }

    // Remote peers
    for (const [peerId, stream] of Object.entries(remoteStreams)) {
      const level = audioLevels[peerId] ?? 0;
      items.push({
        peerId,
        name: `Peer ${peerId.slice(0, 6)}`,
        stream,
        isLocal: false,
        audioLevel: level,
        audioEnabled: true,
        videoEnabled: true,
        isSpeaking: level > 0.15,
      });
    }

    return items;
  }, [
    isJoined,
    localStream,
    remoteStreams,
    audioLevels,
    isAudioEnabled,
    isVideoEnabled,
    user,
  ]);

  const handleJoin = useCallback(() => {
    setIsJoined(true);
  }, []);

  const handleLeave = useCallback(() => {
    setIsJoined(false);
    // Refreshing the page will clean up WebRTC state
    window.location.reload();
  }, []);

  const networkColor =
    networkQuality === "good"
      ? "text-emerald-400"
      : networkQuality === "fair"
        ? "text-amber-400"
        : networkQuality === "poor"
          ? "text-rose-400"
          : "text-zinc-500";

  // Error banner
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">
        <p className="font-medium">Connection error</p>
        <p className="mt-1 text-rose-400/80">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-950 to-violet-950/30 p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">Video Room</h2>
          {isJoined && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live ({peers.length})
            </span>
          )}
        </div>

        {isJoined && (
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <Signal className={`h-3 w-3 ${networkColor}`} />
            <span className="capitalize">{networkQuality}</span>
            {rtt > 0 && <span>{rtt.toFixed(0)}ms</span>}
          </div>
        )}
      </div>

      {!isJoined ? (
        /* Join prompt */
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10">
            <Video className="h-7 w-7 text-violet-300" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-200">
              Join the video room
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Connect with others in this session via peer-to-peer video call
            </p>
          </div>
          <button
            onClick={handleJoin}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-violet-500 active:scale-95"
          >
            <Video className="h-4 w-4" />
            Join Video Call
          </button>
        </div>
      ) : (
        <>
          {/* Peer tiles grid */}
          <div
            className={`grid gap-4 ${
              peers.length <= 1
                ? "grid-cols-1"
                : peers.length <= 2
                  ? "grid-cols-2"
                  : peers.length <= 4
                    ? "grid-cols-2"
                    : "grid-cols-2 sm:grid-cols-3"
            }`}
          >
            {peers.map((peer) => (
              <PeerAvatarTile
                key={peer.peerId}
                peerId={peer.peerId}
                name={peer.name}
                stream={peer.stream}
                isLocal={peer.isLocal}
                audioLevel={peer.audioLevel}
                audioEnabled={peer.audioEnabled}
                videoEnabled={peer.videoEnabled}
                isSpeaking={peer.isSpeaking}
              />
            ))}
          </div>

          {/* Empty state */}
          {peers.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-zinc-500">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">Waiting for peers to connect...</p>
            </div>
          )}

          {/* Call controls */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-xl bg-white/5 p-3">
            {/* Audio toggle */}
            <button
              onClick={toggleAudio}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                isAudioEnabled
                  ? "bg-white/10 text-zinc-200 hover:bg-white/15"
                  : "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
              }`}
              title={isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {isAudioEnabled ? (
                <Mic className="h-3.5 w-3.5" />
              ) : (
                <MicOff className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {isAudioEnabled ? "Mute" : "Unmute"}
              </span>
            </button>

            {/* Video toggle */}
            <button
              onClick={toggleVideo}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                isVideoEnabled
                  ? "bg-white/10 text-zinc-200 hover:bg-white/15"
                  : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
              }`}
              title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {isVideoEnabled ? (
                <Video className="h-3.5 w-3.5" />
              ) : (
                <VideoOff className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {isVideoEnabled ? "Video off" : "Video on"}
              </span>
            </button>

            {/* Screen share toggle */}
            <button
              onClick={toggleScreenShare}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                isScreenSharing
                  ? "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                  : "bg-white/10 text-zinc-200 hover:bg-white/15"
              }`}
              title={
                isScreenSharing ? "Stop sharing screen" : "Share your screen"
              }
            >
              {isScreenSharing ? (
                <MonitorDown className="h-3.5 w-3.5" />
              ) : (
                <MonitorUp className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {isScreenSharing ? "Stop share" : "Share screen"}
              </span>
            </button>

            <span className="mx-1 h-6 w-px bg-white/5" />

            {/* Leave call */}
            <button
              onClick={handleLeave}
              className="flex items-center gap-2 rounded-lg bg-rose-500/20 px-3 py-2 text-xs font-medium text-rose-300 transition-all hover:bg-rose-500/30"
              title="Leave video call"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Leave</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
