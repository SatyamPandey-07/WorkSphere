"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff } from "lucide-react";
import { AudioLevelIndicator } from "./AudioLevelIndicator";
import { usePeakDecayLevel } from "@/hooks/usePeakDecayLevel";
type PeerAvatarTileProps = {
  /** Unique peer identifier */
  peerId: string;
  /** Display name */
  name: string;
  /** Avatar image URL or null */
  avatarUrl?: string | null;
  /** MediaStream (remote peer or local) */
  stream?: MediaStream | null;
  /** Whether this tile represents the local user */
  isLocal?: boolean;
  /** Current audio level 0–1 */
  audioLevel?: number;
  /** Whether audio track is enabled */
  audioEnabled?: boolean;
  /** Whether video track is enabled */
  videoEnabled?: boolean;
  /** Whether the user is speaking (for visual indicator) */
  isSpeaking?: boolean;
  /** Extra action buttons to render in the overlay */
  actions?: ReactNode;
};

/**
 * PeerAvatarTile renders a single peer in the mesh call grid.
 * Shows user avatar / video thumbnail wrapped in an animated audio level ring.
 */
export function PeerAvatarTile({
  name,
  avatarUrl,
  stream,
  isLocal = false,
  audioLevel = 0,
  audioEnabled = true,
  videoEnabled = true,
  isSpeaking = false,
  actions,
}: PeerAvatarTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const smoothedAudioLevel = usePeakDecayLevel(audioLevel);

  // Track the audio track's enabled/muted property dynamically
  const [trackEnabled, setTrackEnabled] = useState<boolean>(() => {
    if (!stream) return true;
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return true;
    return tracks.some((t) => t.enabled && !t.muted);
  });

  useEffect(() => {
    if (!stream) {
      setTrackEnabled(true);
      return;
    }

    const updateTrackState = () => {
      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) {
        setTrackEnabled(true);
      } else {
        setTrackEnabled(tracks.some((t) => t.enabled && !t.muted));
      }
    };

    updateTrackState();

    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) {
      setTrackEnabled(true);
      return;
    }

    const handleTrackChange = () => updateTrackState();

    tracks.forEach((track) => {
      track.addEventListener("mute", handleTrackChange);
      track.addEventListener("unmute", handleTrackChange);
      track.addEventListener("ended", handleTrackChange);
    });

    stream.addEventListener("addtrack", handleTrackChange);
    stream.addEventListener("removetrack", handleTrackChange);

    // Poll for track.enabled changes since property mutation does not fire standard DOM events
    const interval = setInterval(updateTrackState, 200);
    if (
      typeof interval === "object" &&
      interval !== null &&
      "unref" in interval
    ) {
      (interval as unknown as { unref: () => void }).unref();
    }

    return () => {
      clearInterval(interval);
      tracks.forEach((track) => {
        track.removeEventListener("mute", handleTrackChange);
        track.removeEventListener("unmute", handleTrackChange);
        track.removeEventListener("ended", handleTrackChange);
      });
      stream.removeEventListener("addtrack", handleTrackChange);
      stream.removeEventListener("removetrack", handleTrackChange);
    };
  }, [stream]);

  const effectiveAudioEnabled = audioEnabled && trackEnabled;
  const effectiveIsSpeaking = effectiveAudioEnabled && isSpeaking;

  // Attach media stream to video element
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && stream.getVideoTracks().length > 0) {
      el.srcObject = stream;
    } else {
      el.srcObject = null;
    }
  }, [stream]);

  const initials = name
    .split(" ")
    .map((s) => s.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const hasVideo = !!(
    stream &&
    stream.getVideoTracks().length > 0 &&
    videoEnabled
  );

  return (
    <div
      className={`group relative flex flex-col items-center gap-2 rounded-2xl border bg-black/40 p-3 transition-all duration-200 ${
        effectiveIsSpeaking
          ? "border-emerald-400/40 shadow-lg shadow-emerald-500/10"
          : "border-white/10 hover:border-white/20"
      }`}
    >
      {/* Peer name badge */}
      <span className="absolute top-2 left-3 z-20 rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] font-medium text-zinc-300 backdrop-blur-sm">
        {isLocal ? "You" : name}
        {isLocal && (
          <span className="ml-1 text-[9px] text-zinc-500">(local)</span>
        )}
      </span>

      {/* Mic status badge */}
      <div
        data-testid="mic-status-badge"
        data-state={
          !effectiveAudioEnabled
            ? "muted"
            : effectiveIsSpeaking
              ? "transmitting"
              : "silent"
        }
        title={
          !effectiveAudioEnabled
            ? "Participant muted"
            : effectiveIsSpeaking
              ? "Speaking"
              : "Microphone silent"
        }
        aria-label={
          !effectiveAudioEnabled
            ? "Participant muted"
            : effectiveIsSpeaking
              ? "Speaking"
              : "Microphone silent"
        }
        className={`absolute top-2 right-3 z-20 flex h-6 w-6 items-center justify-center rounded-full backdrop-blur-sm transition-all duration-200 ${
          !effectiveAudioEnabled
            ? "border border-rose-500/30 bg-rose-500/20 text-rose-400"
            : effectiveIsSpeaking
              ? "border border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
              : "border border-white/10 bg-black/60 text-zinc-400"
        }`}
      >
        {!effectiveAudioEnabled ? (
          <MicOff
            className="h-3 w-3 text-rose-400"
            data-testid="mic-muted-icon"
          />
        ) : effectiveIsSpeaking ? (
          <div className="relative flex items-center justify-center">
            {/* Animated green radiating waves */}
            <span
              data-testid="radiating-waves"
              className="absolute -inset-1 animate-ping rounded-full bg-emerald-400/40 pointer-events-none"
            />
            <span className="absolute -inset-2 animate-pulse rounded-full border border-emerald-400/40 pointer-events-none" />
            <Mic
              className="relative z-10 h-3 w-3 text-emerald-400"
              data-testid="mic-transmitting-icon"
            />
          </div>
        ) : (
          <Mic
            className="h-3 w-3 text-zinc-400"
            data-testid="mic-silent-icon"
          />
        )}
      </div>

      {/* Audio level ring with avatar / video inside */}
      <AudioLevelIndicator
        level={smoothedAudioLevel}
        size={88}
        strokeWidth={3}
        muted={!effectiveAudioEnabled}
      >
        {hasVideo ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className="h-[76px] w-[76px] rounded-full object-cover"
          />
        ) : (
          <div className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-gradient-to-br from-violet-600/30 to-fuchsia-600/20 text-lg font-bold tracking-wide text-violet-200">
            {avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={avatarUrl}
                alt={name}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
        )}
      </AudioLevelIndicator>

      {/* Status badges */}
      <div className="flex items-center gap-2">
        {!effectiveAudioEnabled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[9px] font-medium text-rose-300">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
            Muted
          </span>
        )}
        {!videoEnabled && hasVideo && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-medium text-amber-300">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34" />
              <line x1="23" y1="1" x2="1" y2="23" />
            </svg>
            Video off
          </span>
        )}
        {effectiveIsSpeaking && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium text-emerald-300 animate-pulse">
            Speaking
          </span>
        )}
      </div>

      {/* Actions overlay */}
      {actions && (
        <div className="absolute bottom-2 right-2 z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
