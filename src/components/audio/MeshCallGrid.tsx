"use client";

import { useCallback, useMemo, useState } from "react";
import { useWebRTCMesh } from "@/hooks/useWebRTCMesh";
import { useUser } from "@clerk/nextjs";
import { PeerAvatarTile } from "./PeerAvatarTile";
import { NetworkQualityBadge } from "./NetworkQualityBadge";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MonitorDown,
  PhoneOff,
  Volume2,
  VolumeX,
  Loader2,
} from "lucide-react";

export interface MeshCallGridProps {
  /** Session slug used as PartyKit room ID */
  sessionSlug: string;
  /** Session host userId */
  hostId?: string;
  /** Callback fired when user joins the room */
  onJoin?: () => void;
  /** Callback fired when user leaves the room */
  onLeave?: () => void;
  /** Whether to force a window reload on leave (defaults to false) */
  reloadOnLeave?: boolean;
  /** Custom reload handler invoked when reloadOnLeave is true (defaults to window.location.reload) */
  onReload?: () => void;
}

/**
 * MeshCallGrid renders a responsive grid of peer avatar tiles
 * with audio level indicators for a WebRTC mesh call room.
 */
export function MeshCallGrid({
  sessionSlug,
  hostId,
  onJoin,
  onLeave,
  reloadOnLeave = false,
  onReload,
}: MeshCallGridProps) {
  const { user } = useUser();
  const [isJoined, setIsJoined] = useState(false);
  const [isMuteAll, setIsMuteAll] = useState(false);

  const toggleMuteAll = useCallback(() => {
    setIsMuteAll((prev) => !prev);
  }, []);

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
      avatarUrl?: string | null;
      stream: MediaStream | null;
      isLocal: boolean;
      isHost: boolean;
      audioLevel: number;
      audioEnabled: boolean;
      videoEnabled: boolean;
      isSpeaking: boolean;
    }> = [];

    // Local peer
    if (isJoined) {
      const localLevel = audioLevels?.["local"] ?? 0;
      items.push({
        peerId: "local",
        name:
          `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "You",
        avatarUrl: user?.imageUrl ?? null,
        stream: localStream,
        isLocal: true,
        isHost: Boolean(hostId && user?.id && hostId === user.id),
        audioLevel: localLevel,
        audioEnabled: isAudioEnabled,
        videoEnabled: isVideoEnabled,
        isSpeaking: localLevel > 0.15 && isAudioEnabled,
      });
    }

    // Remote peers
    if (remoteStreams && typeof remoteStreams === "object") {
      for (const [peerId, stream] of Object.entries(remoteStreams)) {
        const level = audioLevels?.[peerId] ?? 0;
        const audioTracks = stream?.getAudioTracks?.() ?? [];
        const remoteAudioEnabled =
          !isMuteAll &&
          (audioTracks.length > 0
            ? audioTracks.some((t) => t.enabled && !t.muted)
            : true);
        items.push({
          peerId,
          name: `Peer ${peerId.slice(0, 6)}`,
          avatarUrl: null,
          stream,
          isLocal: false,
          isHost: Boolean(hostId && peerId === hostId),
          audioLevel: level,
          audioEnabled: remoteAudioEnabled,
          videoEnabled: true,
          isSpeaking: level > 0.15 && remoteAudioEnabled,
        });
      }
    }

    return items;
  }, [
    isJoined,
    localStream,
    remoteStreams,
    audioLevels,
    isAudioEnabled,
    isVideoEnabled,
    isMuteAll,
    user,
    hostId,
  ]);

  const handleJoin = useCallback(() => {
    setIsJoined(true);
    onJoin?.();
  }, [onJoin]);

  const handleLeave = useCallback(() => {
    setIsJoined(false);
    onLeave?.();
    if (reloadOnLeave) {
      if (typeof onReload === "function") {
        onReload();
      } else if (typeof window !== "undefined") {
        window.location.reload();
      }
    }
  }, [onLeave, reloadOnLeave, onReload]);

  // Error banner
  if (error) {
    return (
      <div
        data-testid="mesh-call-error-banner"
        className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300"
      >
        <p className="font-medium">Connection error</p>
        <p className="mt-1 text-rose-400/80">{error}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="mesh-call-grid-container"
      className="rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-950 to-violet-950/30 p-5"
    >
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">Video Room</h2>
          {isJoined && (
            <span
              data-testid="mesh-call-live-badge"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live ({peers.length})
            </span>
          )}
        </div>

        {isJoined && (
          <NetworkQualityBadge
            qualityTier={networkQuality as "good" | "fair" | "poor" | "unknown"}
            ping={typeof rtt === "number" && rtt > 0 ? rtt : undefined}
            className="text-[10px]"
          />
        )}
      </div>

      {!isJoined ? (
        /* Join prompt */
        <div
          data-testid="mesh-call-join-prompt"
          className="flex flex-col items-center gap-4 py-8"
        >
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
            data-testid="mesh-call-join-button"
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
            data-testid="mesh-call-peer-grid"
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
                avatarUrl={peer.avatarUrl}
                stream={peer.stream}
                isLocal={peer.isLocal}
                audioLevel={peer.audioLevel}
                audioEnabled={peer.audioEnabled}
                videoEnabled={peer.videoEnabled}
                isSpeaking={peer.isSpeaking}
              />
            ))}
          </div>

          {/* Waiting for other peers notice when user is alone in the room */}
          {peers.length === 1 && peers[0].isLocal && (
            <div
              data-testid="mesh-call-waiting-peers"
              className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] py-6 text-zinc-500"
            >
              <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
              <p className="text-xs">Waiting for peers to connect...</p>
            </div>
          )}

          {/* Call controls */}
          <div
            data-testid="mesh-call-controls"
            className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-xl bg-white/5 p-3"
          >
            {/* Audio toggle */}
            <button
              onClick={toggleAudio}
              data-testid="mesh-call-audio-toggle"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                isAudioEnabled
                  ? "bg-white/10 text-zinc-200 hover:bg-white/15"
                  : "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
              }`}
              title={isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
              aria-label={isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
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
              data-testid="mesh-call-video-toggle"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                isVideoEnabled
                  ? "bg-white/10 text-zinc-200 hover:bg-white/15"
                  : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
              }`}
              title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
              aria-label={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
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
              data-testid="mesh-call-screen-toggle"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                isScreenSharing
                  ? "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                  : "bg-white/10 text-zinc-200 hover:bg-white/15"
              }`}
              title={
                isScreenSharing ? "Stop sharing screen" : "Share your screen"
              }
              aria-label={
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

            {/* Mute All peers toggle */}
            <button
              onClick={toggleMuteAll}
              data-testid="mesh-call-mute-all-toggle"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                isMuteAll
                  ? "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                  : "bg-white/10 text-zinc-200 hover:bg-white/15"
              }`}
              title={
                isMuteAll ? "Unmute all participants" : "Mute all participants"
              }
              aria-label={isMuteAll ? "Unmute All" : "Mute All"}
            >
              {isMuteAll ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {isMuteAll ? "Unmute All" : "Mute All"}
              </span>
            </button>

            <span className="mx-1 h-6 w-px bg-white/5" />

            {/* Leave call */}
            <button
              onClick={handleLeave}
              data-testid="mesh-call-leave-button"
              className="flex items-center gap-2 rounded-lg bg-rose-500/20 px-3 py-2 text-xs font-medium text-rose-300 transition-all hover:bg-rose-500/30"
              title="Leave video call"
              aria-label="Leave video call"
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

export default MeshCallGrid;
